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
var import_client_connectcampaignsv2 = require("@aws-sdk/client-connectcampaignsv2");
var import_node_crypto = require("node:crypto");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var campaignsV2 = new import_client_connectcampaignsv2.ConnectCampaignsV2Client({ maxAttempts: 2 });
var CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
var CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
var CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
var AMD_FLOW_ID = process.env.AMD_FLOW_ID || "a40dc527-8348-4694-a389-7b675c0ac3ac";
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function buildOutboundMode(dialMode, concurrency) {
  const cap = Math.max(0.1, Math.min(1, concurrency / 2));
  if (dialMode === "power" || dialMode === "predictive") {
    return { predictive: { bandwidthAllocation: cap } };
  }
  return { progressive: { bandwidthAllocation: 1 } };
}
async function createNativeCampaign(params) {
  try {
    const res = await campaignsV2.send(
      new import_client_connectcampaignsv2.CreateCampaignCommand({
        name: params.name.slice(0, 127),
        connectInstanceId: CONNECT_INSTANCE_ID,
        channelSubtypeConfig: {
          telephony: {
            capacity: 1,
            connectQueueId: params.queueId,
            outboundMode: buildOutboundMode(
              params.dialMode,
              params.concurrency
            ),
            defaultOutboundConfig: {
              connectContactFlowId: params.contactFlowId,
              connectSourcePhoneNumber: params.sourcePhoneNumber,
              answerMachineDetectionConfig: {
                enableAnswerMachineDetection: true,
                awaitAnswerMachinePrompt: false
              }
            }
          }
        },
        // Owner tag — this is what the Connect admin UI uses to associate a
        // campaign with the Connect instance. Without it, the UI shows 403s
        // and the Campaigns service won't dispatch. Matches AWS console
        // behavior when you create a campaign via the managed wizard.
        tags: {
          owner: `arn:aws:connect:us-east-1:${params.awsAccountId}:instance/${CONNECT_INSTANCE_ID}`
        }
      })
    );
    return res.id || null;
  } catch (err) {
    console.error("createNativeCampaign failed:", err);
    return null;
  }
}
var handler = async (event, context) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const awsAccountId = context?.invokedFunctionArn?.split(":")[4] || process.env.AWS_ACCOUNT_ID || "";
    const errors = [];
    if (!body.name?.trim()) errors.push("name is required");
    if (!body.sourcePhoneNumber?.trim())
      errors.push("sourcePhoneNumber is required");
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
    const useNative = body.useNativeCampaign === true;
    let awsCampaignId = null;
    if (useNative && body.campaignQueueId) {
      awsCampaignId = await createNativeCampaign({
        // Prefix with our id so we can find it later if needed
        name: `cv-${campaignId.slice(0, 8)}-${body.name.trim()}`,
        queueId: body.campaignQueueId,
        // Use the AMD-aware flow, not the one the admin picked (SBS etc).
        // The admin's chosen flow is stored in DynamoDB for reference but we
        // swap it for the AMD flow at the AWS level.
        contactFlowId: AMD_FLOW_ID,
        sourcePhoneNumber: body.sourcePhoneNumber,
        dialMode: body.dialMode || "progressive",
        concurrency: body.concurrency || 1,
        awsAccountId
      });
    }
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
          campaignQueueId: body.campaignQueueId ? { S: body.campaignQueueId } : { NULL: true },
          campaignQueueName: { S: body.campaignQueueName || "" },
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
          skippedCount: { N: String(skippedCount) },
          // Native campaign link (null if creation failed or legacy mode)
          awsCampaignId: awsCampaignId ? { S: awsCampaignId } : { NULL: true },
          useNativeCampaign: { BOOL: !!awsCampaignId }
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
        skipped: skippedCount,
        awsCampaignId,
        useNativeCampaign: !!awsCampaignId
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
