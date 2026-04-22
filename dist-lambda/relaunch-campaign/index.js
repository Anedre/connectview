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

// amplify/functions/relaunch-campaign/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var import_client_connectcampaignsv2 = require("@aws-sdk/client-connectcampaignsv2");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var campaignsV2 = new import_client_connectcampaignsv2.ConnectCampaignsV2Client({ maxAttempts: 2 });
var CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
var CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
async function pushResetsToAws(awsCampaignId, rows) {
  let queued = 0;
  const toPush = rows.filter((r) => r.rowId && r.phone);
  for (const batch of chunk(toPush, 25)) {
    try {
      await campaignsV2.send(
        new import_client_connectcampaignsv2.PutOutboundRequestBatchCommand({
          id: awsCampaignId,
          outboundRequests: batch.map((r) => {
            let attrs = {};
            const raw = r.customAttributes;
            if (typeof raw === "string") {
              try {
                attrs = JSON.parse(raw);
              } catch {
              }
            }
            return {
              clientToken: `${r.rowId}-relaunch-${Date.now()}`.slice(0, 500),
              // AWS Campaigns v2 enforces max 15 minutes. Use 10 min with a safety margin.
              expirationTime: new Date(Date.now() + 10 * 60 * 1e3),
              channelSubtypeParameters: {
                telephony: {
                  destinationPhoneNumber: r.phone,
                  // AWS requires keys be alphanumeric, dash, or underscore only.
                  attributes: {
                    campaignRowId: r.rowId,
                    customerName: r.customerName || "",
                    ...Object.fromEntries(
                      Object.entries(attrs).slice(0, 25).map(([k, v]) => [
                        k.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 127),
                        String(v).slice(0, 256)
                      ]).filter(([k]) => k.length > 0)
                    )
                  }
                }
              }
            };
          })
        })
      );
      for (const r of batch) {
        await dynamo.send(
          new import_client_dynamodb.UpdateItemCommand({
            TableName: CONTACTS_TABLE,
            Key: {
              campaignId: { S: r.campaignId },
              rowId: { S: r.rowId }
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
      console.warn("pushResetsToAws batch failed:", err);
    }
  }
  return queued;
}
async function listContacts(campaignId, statusFilter) {
  const items = [];
  let lastKey;
  for (let i = 0; i < 20; i++) {
    const res = await dynamo.send(
      statusFilter ? new import_client_dynamodb.QueryCommand({
        TableName: CONTACTS_TABLE,
        IndexName: "campaignId-status-index",
        KeyConditionExpression: "campaignId = :cid AND #st = :s",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":cid": { S: campaignId },
          ":s": { S: statusFilter }
        },
        ExclusiveStartKey: lastKey
      }) : new import_client_dynamodb.QueryCommand({
        TableName: CONTACTS_TABLE,
        KeyConditionExpression: "campaignId = :cid",
        ExpressionAttributeValues: { ":cid": { S: campaignId } },
        ExclusiveStartKey: lastKey
      })
    );
    for (const it of res.Items || []) items.push((0, import_util_dynamodb.unmarshall)(it));
    lastKey = res.LastEvaluatedKey;
    if (!lastKey) break;
  }
  return items;
}
var handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { campaignId } = body;
    const scope = body.scope || "all";
    const resetAttempts = body.resetAttempts !== false;
    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" })
      };
    }
    const current = await dynamo.send(
      new import_client_dynamodb.GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } }
      })
    );
    if (!current.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" })
      };
    }
    let rowsToReset = [];
    if (scope === "all") {
      rowsToReset = await listContacts(campaignId);
    } else if (scope === "failed") {
      const failed = await listContacts(campaignId, "failed");
      const noAnswer = await listContacts(campaignId, "no_answer");
      rowsToReset = [...failed, ...noAnswer];
    } else if (scope === "specific" && body.specificRowIds?.length) {
      const allRows2 = await listContacts(campaignId);
      const ids = new Set(body.specificRowIds);
      rowsToReset = allRows2.filter((r) => ids.has(r.rowId));
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let resetCount = 0;
    for (const row of rowsToReset) {
      const rowId = row.rowId;
      if (!rowId) continue;
      const updateExpr = resetAttempts ? "SET #st = :pending, nextRetryAt = :now, attempts = :zero REMOVE lastError, disconnectReason, connectContactId, agentUsername" : "SET #st = :pending, nextRetryAt = :now REMOVE lastError, disconnectReason, connectContactId, agentUsername";
      try {
        await dynamo.send(
          new import_client_dynamodb.UpdateItemCommand({
            TableName: CONTACTS_TABLE,
            Key: {
              campaignId: { S: campaignId },
              rowId: { S: rowId }
            },
            UpdateExpression: updateExpr,
            ExpressionAttributeNames: { "#st": "status" },
            ExpressionAttributeValues: {
              ":pending": { S: "pending" },
              ":now": { S: now },
              ...resetAttempts ? { ":zero": { N: "0" } } : {}
            }
          })
        );
        resetCount++;
      } catch (err) {
        console.warn("reset row failed:", rowId, err);
      }
    }
    const allRows = await listContacts(campaignId);
    const counts = {
      pending: 0,
      dialing: 0,
      connected: 0,
      done: 0,
      no_answer: 0,
      failed: 0
    };
    for (const r of allRows) {
      const s = r.status;
      if (s in counts) counts[s]++;
    }
    await dynamo.send(
      new import_client_dynamodb.UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
        UpdateExpression: "SET #st = :running, pendingCount = :p, dialingCount = :d, connectedCount = :c, doneCount = :done, noAnswerCount = :na, failedCount = :f, startedAt = :now, completedAt = :null, relaunchedAt = :now",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":running": { S: "RUNNING" },
          ":p": { N: String(counts.pending) },
          ":d": { N: String(counts.dialing) },
          ":c": { N: String(counts.connected) },
          ":done": { N: String(counts.done) },
          ":na": { N: String(counts.no_answer) },
          ":f": { N: String(counts.failed) },
          ":now": { S: now },
          ":null": { NULL: true }
        }
      })
    );
    void import_client_dynamodb.BatchWriteItemCommand;
    const campMeta = current.Item ? (0, import_util_dynamodb.unmarshall)(current.Item) : {};
    const awsCampaignId = campMeta.awsCampaignId;
    let pushed = 0;
    if (awsCampaignId) {
      try {
        await campaignsV2.send(new import_client_connectcampaignsv2.StartCampaignCommand({ id: awsCampaignId })).catch(async (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (/already|invalid state/i.test(msg)) {
            await campaignsV2.send(new import_client_connectcampaignsv2.ResumeCampaignCommand({ id: awsCampaignId })).catch(() => {
            });
          }
        });
        pushed = await pushResetsToAws(awsCampaignId, rowsToReset);
      } catch (err) {
        console.warn("AWS v2 push after relaunch failed:", err);
      }
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        status: "RUNNING",
        rowsReset: resetCount,
        pushedToAws: pushed,
        awsCampaignId: awsCampaignId || null,
        counts
      })
    };
  } catch (err) {
    console.error("relaunch-campaign error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to relaunch campaign",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
