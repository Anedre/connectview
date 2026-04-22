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

// amplify/functions/clone-campaign/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var import_node_crypto = require("node:crypto");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
var CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
async function listContacts(campaignId) {
  const items = [];
  let lastKey;
  for (let i = 0; i < 20; i++) {
    const res = await dynamo.send(
      new import_client_dynamodb.QueryCommand({
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
    const includeContacts = body.includeContacts !== false;
    const resetAttempts = body.resetAttempts !== false;
    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" })
      };
    }
    const src = await dynamo.send(
      new import_client_dynamodb.GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } }
      })
    );
    if (!src.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Source campaign not found" })
      };
    }
    const source = (0, import_util_dynamodb.unmarshall)(src.Item);
    const newCampaignId = (0, import_node_crypto.randomUUID)();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const cloneName = body.name?.trim() || `${source.name || "Campaign"} (copy)`.slice(0, 200);
    let contacts = [];
    if (includeContacts) {
      contacts = await listContacts(campaignId);
    }
    await dynamo.send(
      new import_client_dynamodb.PutItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Item: {
          campaignId: { S: newCampaignId },
          name: { S: cloneName },
          description: {
            S: source.description || ""
          },
          sourcePhoneNumber: { S: source.sourcePhoneNumber || "" },
          contactFlowId: { S: source.contactFlowId || "" },
          contactFlowName: { S: source.contactFlowName || "" },
          dialMode: { S: source.dialMode || "progressive" },
          concurrency: { N: String(source.concurrency || 1) },
          timezone: { S: source.timezone || "America/Lima" },
          windowStartHour: { N: String(source.windowStartHour ?? 9) },
          windowEndHour: { N: String(source.windowEndHour ?? 18) },
          windowDaysOfWeek: {
            S: typeof source.windowDaysOfWeek === "string" ? source.windowDaysOfWeek : JSON.stringify(source.windowDaysOfWeek || [1, 2, 3, 4, 5])
          },
          retryNoAnswerMinutes: {
            N: String(source.retryNoAnswerMinutes ?? 30)
          },
          retryMaxAttempts: { N: String(source.retryMaxAttempts ?? 3) },
          status: { S: "DRAFT" },
          createdAt: { S: now },
          createdBy: { S: body.createdBy || "system" },
          startedAt: { NULL: true },
          completedAt: { NULL: true },
          totalContacts: { N: String(contacts.length) },
          pendingCount: { N: String(contacts.length) },
          dialingCount: { N: "0" },
          connectedCount: { N: "0" },
          doneCount: { N: "0" },
          failedCount: { N: "0" },
          noAnswerCount: { N: "0" },
          skippedCount: { N: "0" },
          clonedFrom: { S: campaignId }
        }
      })
    );
    let contactsCopied = 0;
    if (contacts.length > 0) {
      for (const batch of chunk(contacts, 25)) {
        await dynamo.send(
          new import_client_dynamodb.BatchWriteItemCommand({
            RequestItems: {
              [CONTACTS_TABLE]: batch.map((c) => {
                const newRowId = (0, import_node_crypto.randomUUID)();
                return {
                  PutRequest: {
                    Item: {
                      campaignId: { S: newCampaignId },
                      rowId: { S: newRowId },
                      phone: { S: c.phone || "" },
                      customerName: {
                        S: c.customerName || ""
                      },
                      customAttributes: {
                        S: typeof c.customAttributes === "string" ? c.customAttributes : JSON.stringify(c.customAttributes || {})
                      },
                      status: { S: "pending" },
                      attempts: {
                        N: resetAttempts ? "0" : String(c.attempts || 0)
                      },
                      createdAt: { S: now },
                      nextRetryAt: { S: now }
                    }
                  }
                };
              })
            }
          })
        );
        contactsCopied += batch.length;
      }
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId: newCampaignId,
        status: "DRAFT",
        name: cloneName,
        clonedFrom: campaignId,
        contactsCopied
      })
    };
  } catch (err) {
    console.error("clone-campaign error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to clone campaign",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
