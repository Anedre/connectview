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

// amplify/functions/create-campaign/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_node_crypto = require("node:crypto");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
var CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
var handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const errors = [];
    if (!body.name?.trim()) errors.push("name is required");
    if (!body.sourcePhoneNumber?.trim()) errors.push("sourcePhoneNumber is required");
    if (!body.contactFlowId?.trim()) errors.push("contactFlowId is required");
    if (!Array.isArray(body.contacts) || body.contacts.length === 0)
      errors.push("contacts must be a non-empty array");
    if (body.contacts && body.contacts.length > 1e4)
      errors.push("contacts limited to 10000 per campaign");
    if (errors.length) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Validation failed", details: errors })
      };
    }
    const validContacts = body.contacts.filter(
      (c) => /^\+\d{8,15}$/.test((c.phone || "").trim())
    );
    const skippedCount = body.contacts.length - validContacts.length;
    if (validContacts.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "No valid phone numbers",
          skipped: skippedCount
        })
      };
    }
    const campaignId = (0, import_node_crypto.randomUUID)();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const startNow = body.startNow !== false;
    const status = startNow ? "RUNNING" : "DRAFT";
    await dynamo.send(
      new import_client_dynamodb.PutItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Item: {
          campaignId: { S: campaignId },
          name: { S: body.name.trim() },
          description: { S: body.description || "" },
          sourcePhoneNumber: { S: body.sourcePhoneNumber },
          contactFlowId: { S: body.contactFlowId },
          contactFlowName: { S: body.contactFlowName || "" },
          dialMode: { S: body.dialMode || "progressive" },
          concurrency: { N: String(body.concurrency || 1) },
          timezone: { S: body.timezone || "America/Lima" },
          windowStartHour: { N: String(body.windowStartHour ?? 9) },
          windowEndHour: { N: String(body.windowEndHour ?? 18) },
          windowDaysOfWeek: {
            S: JSON.stringify(body.windowDaysOfWeek ?? [1, 2, 3, 4, 5])
          },
          retryNoAnswerMinutes: { N: String(body.retryNoAnswerMinutes ?? 30) },
          retryMaxAttempts: { N: String(body.retryMaxAttempts ?? 3) },
          status: { S: status },
          createdAt: { S: now },
          createdBy: { S: body.createdBy || "system" },
          startedAt: startNow ? { S: now } : { NULL: true },
          completedAt: { NULL: true },
          totalContacts: { N: String(validContacts.length) },
          pendingCount: { N: String(validContacts.length) },
          dialingCount: { N: "0" },
          connectedCount: { N: "0" },
          doneCount: { N: "0" },
          failedCount: { N: "0" },
          noAnswerCount: { N: "0" },
          skippedCount: { N: String(skippedCount) }
        }
      })
    );
    for (const batch of chunk(validContacts, 25)) {
      await dynamo.send(
        new import_client_dynamodb.BatchWriteItemCommand({
          RequestItems: {
            [CONTACTS_TABLE]: batch.map((c) => {
              const rowId = (0, import_node_crypto.randomUUID)();
              const attrs = JSON.stringify(c.attributes || {});
              return {
                PutRequest: {
                  Item: {
                    campaignId: { S: campaignId },
                    rowId: { S: rowId },
                    phone: { S: c.phone },
                    customerName: { S: c.customerName || "" },
                    customAttributes: { S: attrs },
                    status: { S: "pending" },
                    attempts: { N: "0" },
                    createdAt: { S: now },
                    nextRetryAt: { S: now }
                    // eligible immediately
                  }
                }
              };
            })
          }
        })
      );
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        status,
        totalContacts: validContacts.length,
        skipped: skippedCount
      })
    };
  } catch (err) {
    console.error("create-campaign error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to create campaign",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
