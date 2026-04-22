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

// amplify/functions/control-campaign/handler.ts
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
var ALLOWED_ACTIONS = /* @__PURE__ */ new Set(["start", "pause", "resume", "cancel"]);
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
async function queryPendingContacts(campaignId) {
  const items = [];
  let lastKey;
  for (let i = 0; i < 20; i++) {
    const res = await dynamo.send(
      new import_client_dynamodb.QueryCommand({
        TableName: CONTACTS_TABLE,
        IndexName: "campaignId-status-index",
        KeyConditionExpression: "campaignId = :cid AND #st = :s",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":cid": { S: campaignId },
          ":s": { S: "pending" }
        },
        ExclusiveStartKey: lastKey
      })
    );
    for (const it of res.Items || []) items.push((0, import_util_dynamodb.unmarshall)(it));
    lastKey = res.LastEvaluatedKey;
    if (!lastKey) break;
  }
  return items;
}
async function pushContactsToAws(awsCampaignId, contacts) {
  if (contacts.length === 0) return 0;
  let queued = 0;
  for (const batch of chunk(contacts, 25)) {
    try {
      await campaignsV2.send(
        new import_client_connectcampaignsv2.PutOutboundRequestBatchCommand({
          id: awsCampaignId,
          outboundRequests: batch.map((c) => {
            let attrs = {};
            try {
              attrs = JSON.parse(c.customAttributes || "{}");
            } catch {
            }
            return {
              clientToken: `${c.rowId}-${Date.now()}`.slice(0, 500),
              // AWS Campaigns v2 enforces max 15 minutes for expirationTime.
              // Use 10 minutes to leave a safety margin.
              expirationTime: new Date(
                Date.now() + 10 * 60 * 1e3
              ),
              channelSubtypeParameters: {
                telephony: {
                  destinationPhoneNumber: c.phone,
                  // Pass our internal rowId + name so the flow can surface them.
                  // AWS requires keys be alphanumeric, dash, or underscore only.
                  attributes: {
                    campaignRowId: c.rowId,
                    customerName: c.customerName || "",
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
        ).catch((err) => {
          console.warn("markDialing failed for", c.rowId, err);
        });
        queued++;
      }
    } catch (err) {
      console.error("PutOutboundRequestBatch failed:", err);
    }
  }
  return queued;
}
var handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { campaignId, action } = body;
    if (!campaignId || !action) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId and action required" })
      };
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `action must be one of: ${[...ALLOWED_ACTIONS].join(", ")}`
        })
      };
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
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
    const campaign = (0, import_util_dynamodb.unmarshall)(current.Item);
    const currentStatus = campaign.status;
    const awsCampaignId = campaign.awsCampaignId;
    const useNative = !!awsCampaignId;
    let newStatus;
    const extraSets = {};
    switch (action) {
      case "start":
        if (currentStatus !== "DRAFT" && currentStatus !== "PAUSED") {
          return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: `Cannot start from status ${currentStatus}`
            })
          };
        }
        newStatus = "RUNNING";
        if (currentStatus === "DRAFT") extraSets.startedAt = { S: now };
        break;
      case "pause":
        if (currentStatus !== "RUNNING") {
          return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: `Cannot pause from status ${currentStatus}`
            })
          };
        }
        newStatus = "PAUSED";
        break;
      case "resume":
        if (currentStatus !== "PAUSED") {
          return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: `Cannot resume from status ${currentStatus}`
            })
          };
        }
        newStatus = "RUNNING";
        break;
      case "cancel":
        if (currentStatus === "COMPLETED" || currentStatus === "CANCELLED") {
          return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: `Cannot cancel from status ${currentStatus}`
            })
          };
        }
        newStatus = "CANCELLED";
        extraSets.completedAt = { S: now };
        break;
      default:
        throw new Error("unreachable");
    }
    let queuedCount = 0;
    if (useNative && awsCampaignId) {
      try {
        if (action === "start" || action === "resume") {
          await campaignsV2.send(new import_client_connectcampaignsv2.StartCampaignCommand({ id: awsCampaignId })).catch(async (err) => {
            const msg = err instanceof Error ? err.message : String(err);
            if (/already|invalid state/i.test(msg)) {
              await campaignsV2.send(new import_client_connectcampaignsv2.ResumeCampaignCommand({ id: awsCampaignId })).catch(() => {
              });
            } else {
              throw err;
            }
          });
          const pending = await queryPendingContacts(campaignId);
          queuedCount = await pushContactsToAws(awsCampaignId, pending);
        } else if (action === "pause") {
          await campaignsV2.send(
            new import_client_connectcampaignsv2.PauseCampaignCommand({ id: awsCampaignId })
          );
        } else if (action === "cancel") {
          await campaignsV2.send(
            new import_client_connectcampaignsv2.StopCampaignCommand({ id: awsCampaignId })
          );
        }
      } catch (err) {
        console.error(
          "AWS campaigns v2 action failed (continuing with DynamoDB update):",
          err
        );
      }
    }
    const setExpressions = ["#st = :new"];
    const exprVals = { ":new": { S: newStatus } };
    const exprNames = { "#st": "status" };
    for (const [key, val] of Object.entries(extraSets)) {
      setExpressions.push(`${key} = :${key}`);
      if (val.S) exprVals[`:${key}`] = { S: val.S };
    }
    await dynamo.send(
      new import_client_dynamodb.UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
        UpdateExpression: "SET " + setExpressions.join(", "),
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprVals
      })
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        status: newStatus,
        previousStatus: currentStatus,
        useNative,
        awsCampaignId: awsCampaignId || null,
        contactsQueued: queuedCount
      })
    };
  } catch (err) {
    console.error("control-campaign error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to control campaign",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
