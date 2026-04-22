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

// amplify/functions/get-campaign-contacts/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
var handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const campaignId = params.campaignId;
    const statusFilter = params.status;
    const limit = parseInt(params.limit || "100");
    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" })
      };
    }
    let items = [];
    if (statusFilter) {
      const r = await dynamo.send(
        new import_client_dynamodb.QueryCommand({
          TableName: CONTACTS_TABLE,
          IndexName: "campaignId-status-index",
          KeyConditionExpression: "campaignId = :cid AND #st = :s",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: {
            ":cid": { S: campaignId },
            ":s": { S: statusFilter }
          },
          Limit: limit
        })
      );
      items = (r.Items || []).map((it) => (0, import_util_dynamodb.unmarshall)(it));
    } else {
      const r = await dynamo.send(
        new import_client_dynamodb.QueryCommand({
          TableName: CONTACTS_TABLE,
          KeyConditionExpression: "campaignId = :cid",
          ExpressionAttributeValues: { ":cid": { S: campaignId } },
          Limit: limit
        })
      );
      items = (r.Items || []).map((it) => (0, import_util_dynamodb.unmarshall)(it));
    }
    for (const it of items) {
      if (typeof it.customAttributes === "string") {
        try {
          it.customAttributes = JSON.parse(it.customAttributes);
        } catch {
          it.customAttributes = {};
        }
      }
    }
    items.sort((a, b) => {
      const ta = new Date(a.lastAttemptAt || 0).getTime();
      const tb = new Date(b.lastAttemptAt || 0).getTime();
      return tb - ta;
    });
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts: items, count: items.length })
    };
  } catch (err) {
    console.error("get-campaign-contacts error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get campaign contacts",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
