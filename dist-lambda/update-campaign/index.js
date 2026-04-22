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

// amplify/functions/update-campaign/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
var FIELD_MAP = {
  name: { toAttrValue: (v) => ({ S: v }) },
  description: { toAttrValue: (v) => ({ S: v }) },
  sourcePhoneNumber: { toAttrValue: (v) => ({ S: v }) },
  contactFlowId: { toAttrValue: (v) => ({ S: v }) },
  contactFlowName: { toAttrValue: (v) => ({ S: v }) },
  campaignQueueId: { toAttrValue: (v) => ({ S: v }) },
  campaignQueueName: { toAttrValue: (v) => ({ S: v }) },
  dialMode: { toAttrValue: (v) => ({ S: v }) },
  concurrency: { toAttrValue: (v) => ({ N: String(v) }) },
  timezone: { toAttrValue: (v) => ({ S: v }) },
  windowStartHour: { toAttrValue: (v) => ({ N: String(v) }) },
  windowEndHour: { toAttrValue: (v) => ({ N: String(v) }) },
  windowDaysOfWeek: {
    toAttrValue: (v) => ({ S: JSON.stringify(v) })
  },
  retryNoAnswerMinutes: { toAttrValue: (v) => ({ N: String(v) }) },
  retryMaxAttempts: { toAttrValue: (v) => ({ N: String(v) }) }
};
var handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    if (!body.campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" })
      };
    }
    const current = await dynamo.send(
      new import_client_dynamodb.GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: body.campaignId } }
      })
    );
    if (!current.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" })
      };
    }
    const currentStatus = current.Item.status?.S || "";
    if (currentStatus === "COMPLETED" || currentStatus === "CANCELLED") {
      return {
        statusCode: 409,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `Campaign in ${currentStatus} state cannot be edited. Clone it instead.`
        })
      };
    }
    const setExpressions = [];
    const exprVals = {};
    const exprNames = {};
    for (const [field, val] of Object.entries(body)) {
      if (field === "campaignId") continue;
      if (val === void 0 || val === null) continue;
      const mapping = FIELD_MAP[field];
      if (!mapping) continue;
      const nameAlias = `#${field}`;
      const valueAlias = `:${field}`;
      setExpressions.push(`${nameAlias} = ${valueAlias}`);
      exprNames[nameAlias] = field;
      exprVals[valueAlias] = mapping.toAttrValue(val);
    }
    if (setExpressions.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "No editable fields provided" })
      };
    }
    setExpressions.push("#updatedAt = :updatedAt");
    exprNames["#updatedAt"] = "updatedAt";
    exprVals[":updatedAt"] = { S: (/* @__PURE__ */ new Date()).toISOString() };
    await dynamo.send(
      new import_client_dynamodb.UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: body.campaignId } },
        UpdateExpression: "SET " + setExpressions.join(", "),
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprVals
      })
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId: body.campaignId,
        updated: true,
        fieldsChanged: setExpressions.length - 1
        // minus updatedAt
      })
    };
  } catch (err) {
    console.error("update-campaign error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to update campaign",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
