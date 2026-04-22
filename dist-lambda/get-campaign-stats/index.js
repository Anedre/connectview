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

// amplify/functions/get-campaign-stats/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
var CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
var handler = async (event) => {
  try {
    const campaignId = event.queryStringParameters?.campaignId;
    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" })
      };
    }
    const metaRes = await dynamo.send(
      new import_client_dynamodb.GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } }
      })
    );
    if (!metaRes.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" })
      };
    }
    const campaign = (0, import_util_dynamodb.unmarshall)(metaRes.Item);
    const statuses = [
      "pending",
      "dialing",
      "connected",
      "done",
      "no_answer",
      "failed"
    ];
    const freshCounts = {};
    const dialingContacts = [];
    for (const st of statuses) {
      let count = 0;
      let lastKey;
      for (let i = 0; i < 5; i++) {
        const r = await dynamo.send(
          new import_client_dynamodb.QueryCommand({
            TableName: CONTACTS_TABLE,
            IndexName: "campaignId-status-index",
            KeyConditionExpression: "campaignId = :cid AND #st = :s",
            ExpressionAttributeNames: { "#st": "status" },
            ExpressionAttributeValues: {
              ":cid": { S: campaignId },
              ":s": { S: st }
            },
            Select: st === "dialing" || st === "connected" ? "ALL_PROJECTED_ATTRIBUTES" : "COUNT",
            ExclusiveStartKey: lastKey
          })
        );
        count += r.Count || 0;
        if (st === "dialing" || st === "connected") {
          for (const it of r.Items || []) {
            const row = (0, import_util_dynamodb.unmarshall)(it);
            dialingContacts.push({
              rowId: row.rowId,
              phone: row.phone,
              customerName: row.customerName || "",
              agentUsername: row.agentUsername,
              connectContactId: row.connectContactId,
              status: row.status
            });
          }
        }
        lastKey = r.LastEvaluatedKey;
        if (!lastKey) break;
      }
      freshCounts[st] = count;
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign,
        counts: freshCounts,
        liveContacts: dialingContacts
      })
    };
  } catch (err) {
    console.error("get-campaign-stats error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get campaign stats",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
