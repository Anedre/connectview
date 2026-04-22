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

// amplify/functions/process-contact-event/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var import_client_lambda = require("@aws-sdk/client-lambda");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var lambda = new import_client_lambda.LambdaClient({});
var TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "";
var ENRICH_FUNCTION_NAME = process.env.ENRICH_FUNCTION_NAME || "";
var CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
var CAMPAIGN_CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
async function findCampaignContact(contactId) {
  try {
    const res = await dynamo.send(
      new import_client_dynamodb.QueryCommand({
        TableName: CAMPAIGN_CONTACTS_TABLE,
        IndexName: "connectContactId-index",
        KeyConditionExpression: "connectContactId = :cid",
        ExpressionAttributeValues: { ":cid": { S: contactId } },
        Limit: 1
      })
    );
    const first = res.Items?.[0];
    if (!first) return null;
    const row = (0, import_util_dynamodb.unmarshall)(first);
    return {
      campaignId: row.campaignId,
      rowId: row.rowId,
      attempts: Number(row.attempts || 0),
      status: row.status
    };
  } catch (err) {
    console.warn("findCampaignContact failed:", err);
    return null;
  }
}
function classifyDisconnect(reason, previousStatus) {
  if (previousStatus === "connected") return "done";
  const r = (reason || "").toUpperCase();
  if (r === "CUSTOMER_MISSED_CALL" || r === "TELECOM_PROBLEM" || r === "CALL_ABANDONED" || r.includes("MISSED")) {
    return "no_answer";
  }
  if (r === "CUSTOMER_DISCONNECT" || r === "AGENT_DISCONNECT") {
    return previousStatus === "connected" ? "done" : "no_answer";
  }
  return "failed";
}
async function updateCampaignContactStatus(link, newStatus, extra = {}) {
  const setParts = ["#st = :new"];
  const exprVals = {
    ":new": { S: newStatus }
  };
  const exprNames = { "#st": "status" };
  for (const [k, v] of Object.entries(extra)) {
    setParts.push(`${k} = :${k}`);
    if (typeof v === "number") exprVals[`:${k}`] = { N: String(v) };
    else exprVals[`:${k}`] = { S: v };
  }
  await dynamo.send(
    new import_client_dynamodb.UpdateItemCommand({
      TableName: CAMPAIGN_CONTACTS_TABLE,
      Key: {
        campaignId: { S: link.campaignId },
        rowId: { S: link.rowId }
      },
      UpdateExpression: "SET " + setParts.join(", "),
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprVals
    })
  );
}
async function updateCampaignCounters(campaignId, newStatus, previousStatus) {
  const counterInc = {};
  const counterDec = {};
  const statusToCounter = {
    pending: "pendingCount",
    dialing: "dialingCount",
    connected: "connectedCount",
    done: "doneCount",
    no_answer: "noAnswerCount",
    failed: "failedCount"
  };
  const incKey = statusToCounter[newStatus];
  const decKey = statusToCounter[previousStatus];
  if (incKey) counterInc[incKey] = 1;
  if (decKey && decKey !== incKey) counterDec[decKey] = 1;
  const allOps = { ...counterInc };
  for (const k of Object.keys(counterDec)) allOps[k] = -1;
  if (Object.keys(allOps).length === 0) return;
  const addParts = Object.entries(allOps).map(
    ([key, val], i) => `${key} :v${i}`
  );
  const exprVals = {};
  Object.entries(allOps).forEach(([, val], i) => {
    exprVals[`:v${i}`] = { N: String(val) };
  });
  try {
    await dynamo.send(
      new import_client_dynamodb.UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
        UpdateExpression: "ADD " + addParts.join(", "),
        ExpressionAttributeValues: exprVals
      })
    );
  } catch (err) {
    console.warn("updateCampaignCounters failed:", err);
  }
}
var handler = async (event) => {
  const detail = event.detail;
  const contactId = detail.contactId;
  const eventType = detail.eventType;
  try {
    if (eventType === "INITIATED" || eventType === "CONNECTED_TO_AGENT") {
      const agentName = detail.agentInfo?.agentArn?.split("/").pop() || "";
      const queueName = detail.queueInfo?.queueArn?.split("/").pop() || "";
      await dynamo.send(
        new import_client_dynamodb.PutItemCommand({
          TableName: TABLE_NAME,
          Item: {
            contactId: { S: contactId },
            initiationTimestamp: {
              S: detail.initiationTimestamp || (/* @__PURE__ */ new Date()).toISOString()
            },
            channel: { S: detail.channel || "VOICE" },
            agentUsername: { S: agentName },
            queueName: { S: queueName },
            initiationMethod: { S: detail.initiationMethod || "" },
            status: { S: "ACTIVE" }
          },
          ConditionExpression: "attribute_not_exists(contactId)"
        })
      ).catch((err) => {
        if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
          return;
        }
        throw err;
      });
    } else if (eventType === "DISCONNECTED" || eventType === "CONTACT_END") {
      await dynamo.send(
        new import_client_dynamodb.UpdateItemCommand({
          TableName: TABLE_NAME,
          Key: { contactId: { S: contactId } },
          UpdateExpression: "SET #status = :status, disconnectTimestamp = :dt, disconnectReason = :dr",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":status": { S: "COMPLETED" },
            ":dt": {
              S: detail.disconnectTimestamp || (/* @__PURE__ */ new Date()).toISOString()
            },
            ":dr": { S: detail.disconnectReason || "UNKNOWN" }
          }
        })
      );
      if (ENRICH_FUNCTION_NAME) {
        await lambda.send(
          new import_client_lambda.InvokeCommand({
            FunctionName: ENRICH_FUNCTION_NAME,
            InvocationType: "Event",
            Payload: Buffer.from(
              JSON.stringify({
                contactId,
                instanceId: detail.instanceArn?.split("/").pop() || ""
              })
            )
          })
        );
      }
    }
    const link = await findCampaignContact(contactId);
    if (!link) return;
    if (eventType === "CONNECTED_TO_AGENT") {
      const agentId = detail.agentInfo?.agentArn?.split("/").pop() || "";
      await updateCampaignContactStatus(link, "connected", {
        agentUsername: agentId,
        connectedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      await updateCampaignCounters(link.campaignId, "connected", link.status);
    } else if (eventType === "DISCONNECTED" || eventType === "CONTACT_END") {
      const newStatus = classifyDisconnect(detail.disconnectReason, link.status);
      await updateCampaignContactStatus(link, newStatus, {
        disconnectReason: detail.disconnectReason || "UNKNOWN",
        disconnectedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      await updateCampaignCounters(link.campaignId, newStatus, link.status);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return;
    }
    console.error("Error processing contact event:", error);
    throw error;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
