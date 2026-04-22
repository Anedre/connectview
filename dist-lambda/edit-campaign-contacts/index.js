"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// amplify/functions/edit-campaign-contacts/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var import_client_connectcampaignsv2 = require("@aws-sdk/client-connectcampaignsv2");
var import_node_crypto = require("node:crypto");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var campaignsV2 = new import_client_connectcampaignsv2.ConnectCampaignsV2Client({ maxAttempts: 2 });
var CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
var CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
var STATUS_TO_COUNTER = {
  pending: "pendingCount",
  dialing: "dialingCount",
  connected: "connectedCount",
  done: "doneCount",
  no_answer: "noAnswerCount",
  failed: "failedCount"
};
async function bumpCampaignCounters(campaignId, deltas) {
  const adds = [];
  const vals = {};
  let i = 0;
  for (const [key, delta] of Object.entries(deltas)) {
    if (delta === 0) continue;
    const placeholder = `:v${i++}`;
    adds.push(`${key} ${placeholder}`);
    vals[placeholder] = { N: String(delta) };
  }
  if (adds.length === 0) return;
  try {
    await dynamo.send(
      new import_client_dynamodb.UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
        UpdateExpression: "ADD " + adds.join(", "),
        ExpressionAttributeValues: vals
      })
    );
  } catch (err) {
    console.warn("counter update failed:", err);
  }
}
async function pushToAws(awsCampaignId, rows) {
  let queued = 0;
  for (const batch of chunk(rows, 25)) {
    try {
      await campaignsV2.send(
        new import_client_connectcampaignsv2.PutOutboundRequestBatchCommand({
          id: awsCampaignId,
          outboundRequests: batch.map((c) => ({
            clientToken: `${c.rowId}-${Date.now()}`.slice(0, 500),
            // AWS Campaigns v2 enforces max 15 minutes. Use 10 min with a safety margin.
            expirationTime: new Date(Date.now() + 10 * 60 * 1e3),
            channelSubtypeParameters: {
              telephony: {
                destinationPhoneNumber: c.phone,
                // AWS requires keys be alphanumeric, dash, or underscore only.
                attributes: {
                  campaignRowId: c.rowId,
                  customerName: c.customerName || "",
                  ...Object.fromEntries(
                    Object.entries(c.attributes).slice(0, 25).map(([k, v]) => [
                      k.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 127),
                      String(v).slice(0, 256)
                    ]).filter(([k]) => k.length > 0)
                  )
                }
              }
            }
          }))
        })
      );
      for (const c of batch) {
        await dynamo.send(
          new import_client_dynamodb.UpdateItemCommand({
            TableName: CONTACTS_TABLE,
            Key: {
              campaignId: { S: c.campaignId },
              rowId: { S: c.rowId }
            },
            UpdateExpression: "SET #st = :dialing, lastAttemptAt = :now, attempts = if_not_exists(attempts, :zero) + :one",
            ExpressionAttributeNames: { "#st": "status" },
            ExpressionAttributeValues: {
              ":dialing": { S: "dialing" },
              ":now": { S: (/* @__PURE__ */ new Date()).toISOString() },
              ":zero": { N: "0" },
              ":one": { N: "1" }
            }
          })
        ).catch(() => {
        });
        queued++;
      }
    } catch (err) {
      console.warn("pushToAws batch failed:", err);
    }
  }
  return queued;
}
async function handleAdd(body) {
  if (!Array.isArray(body.contacts) || body.contacts.length === 0) {
    return { statusCode: 400, body: { error: "contacts must be non-empty" } };
  }
  const validContacts = body.contacts.filter(
    (c) => /^\+\d{8,15}$/.test((c.phone || "").trim())
  );
  const skipped = body.contacts.length - validContacts.length;
  if (validContacts.length === 0) {
    return {
      statusCode: 400,
      body: { error: "No valid phone numbers", skipped }
    };
  }
  const campRes = await dynamo.send(
    new import_client_dynamodb.GetItemCommand({
      TableName: CAMPAIGNS_TABLE,
      Key: { campaignId: { S: body.campaignId } }
    })
  );
  const campaign = campRes.Item ? (0, import_util_dynamodb.unmarshall)(campRes.Item) : null;
  const awsCampaignId = campaign?.awsCampaignId;
  const isRunning = campaign?.status === "RUNNING";
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let inserted = 0;
  const insertedRows = [];
  for (const batch of chunk(validContacts, 25)) {
    await dynamo.send(
      new import_client_dynamodb.BatchWriteItemCommand({
        RequestItems: {
          [CONTACTS_TABLE]: batch.map((c) => {
            const rowId = (0, import_node_crypto.randomUUID)();
            insertedRows.push({
              campaignId: body.campaignId,
              rowId,
              phone: c.phone,
              customerName: c.customerName || "",
              attributes: c.attributes || {}
            });
            return {
              PutRequest: {
                Item: {
                  campaignId: { S: body.campaignId },
                  rowId: { S: rowId },
                  phone: { S: c.phone },
                  customerName: { S: c.customerName || "" },
                  customAttributes: {
                    S: JSON.stringify(c.attributes || {})
                  },
                  status: { S: "pending" },
                  attempts: { N: "0" },
                  createdAt: { S: now },
                  nextRetryAt: { S: now }
                }
              }
            };
          })
        }
      })
    );
    inserted += batch.length;
  }
  await bumpCampaignCounters(body.campaignId, {
    totalContacts: inserted,
    pendingCount: inserted
  });
  let pushed = 0;
  if (isRunning && awsCampaignId) {
    pushed = await pushToAws(awsCampaignId, insertedRows);
  }
  return {
    statusCode: 200,
    body: {
      action: "add",
      inserted,
      skipped,
      pushedToAws: pushed
    }
  };
}
async function handleDelete(body) {
  if (!Array.isArray(body.rowIds) || body.rowIds.length === 0) {
    return { statusCode: 400, body: { error: "rowIds must be non-empty" } };
  }
  const statusDeltas = {
    totalContacts: 0,
    pendingCount: 0,
    dialingCount: 0,
    connectedCount: 0,
    doneCount: 0,
    noAnswerCount: 0,
    failedCount: 0
  };
  let removed = 0;
  const errors = [];
  for (const rowId of body.rowIds) {
    try {
      const res = await dynamo.send(
        new import_client_dynamodb.GetItemCommand({
          TableName: CONTACTS_TABLE,
          Key: {
            campaignId: { S: body.campaignId },
            rowId: { S: rowId }
          }
        })
      );
      if (!res.Item) {
        errors.push(`row ${rowId} not found`);
        continue;
      }
      const status = res.Item.status?.S || "";
      if (status === "dialing" || status === "connected") {
        errors.push(`row ${rowId} is ${status} \u2014 cannot delete mid-call`);
        continue;
      }
      await dynamo.send(
        new import_client_dynamodb.DeleteItemCommand({
          TableName: CONTACTS_TABLE,
          Key: {
            campaignId: { S: body.campaignId },
            rowId: { S: rowId }
          }
        })
      );
      removed++;
      statusDeltas.totalContacts -= 1;
      const counter = STATUS_TO_COUNTER[status];
      if (counter) statusDeltas[counter] -= 1;
    } catch (err) {
      errors.push(
        `row ${rowId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  await bumpCampaignCounters(body.campaignId, statusDeltas);
  return {
    statusCode: 200,
    body: { action: "delete", removed, errors }
  };
}
async function handleUpdate(body) {
  const { campaignId, rowId } = body;
  if (!rowId) {
    return { statusCode: 400, body: { error: "rowId required" } };
  }
  const current = await dynamo.send(
    new import_client_dynamodb.GetItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: campaignId },
        rowId: { S: rowId }
      }
    })
  );
  if (!current.Item) {
    return { statusCode: 404, body: { error: "Contact row not found" } };
  }
  const currentStatus = current.Item.status?.S || "";
  if (currentStatus === "dialing" || currentStatus === "connected") {
    return {
      statusCode: 409,
      body: {
        error: `Row is ${currentStatus} \u2014 cannot edit while the call is live.`
      }
    };
  }
  const sets = [];
  const vals = {};
  if (body.phone !== void 0) {
    if (!/^\+\d{8,15}$/.test(body.phone.trim())) {
      return {
        statusCode: 400,
        body: { error: "phone must be E.164 (+<digits>, 8-15 digits)" }
      };
    }
    sets.push("phone = :phone");
    vals[":phone"] = { S: body.phone.trim() };
  }
  if (body.customerName !== void 0) {
    sets.push("customerName = :name");
    vals[":name"] = { S: body.customerName };
  }
  if (body.attributes !== void 0) {
    sets.push("customAttributes = :attrs");
    vals[":attrs"] = { S: JSON.stringify(body.attributes || {}) };
  }
  if (sets.length === 0) {
    return { statusCode: 400, body: { error: "No editable fields provided" } };
  }
  sets.push("updatedAt = :updatedAt");
  vals[":updatedAt"] = { S: (/* @__PURE__ */ new Date()).toISOString() };
  await dynamo.send(
    new import_client_dynamodb.UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: campaignId },
        rowId: { S: rowId }
      },
      UpdateExpression: "SET " + sets.join(", "),
      ExpressionAttributeValues: vals
    })
  );
  return { statusCode: 200, body: { action: "update", rowId, updated: true } };
}
var handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { action, campaignId } = body;
    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" })
      };
    }
    const camp = await dynamo.send(
      new import_client_dynamodb.GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } }
      })
    );
    if (!camp.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" })
      };
    }
    let result;
    if (action === "add") {
      result = await handleAdd(body);
    } else if (action === "delete") {
      result = await handleDelete(body);
    } else if (action === "update") {
      result = await handleUpdate(body);
    } else {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `Unknown action: ${action}. Use add | delete | update.`
        })
      };
    }
    return {
      statusCode: result.statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result.body)
    };
  } catch (err) {
    console.error("edit-campaign-contacts error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to edit campaign contacts",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
