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

// amplify/functions/admin-change-agent-status/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_node_crypto = require("node:crypto");
var connect = new import_client_connect.ConnectClient({ maxAttempts: 1 });
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
var AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";
async function audit(actor, target, result, errorMsg) {
  try {
    await dynamo.send(
      new import_client_dynamodb.PutItemCommand({
        TableName: AUDIT_TABLE,
        Item: {
          auditId: { S: (0, import_node_crypto.randomUUID)() },
          timestamp: { S: (/* @__PURE__ */ new Date()).toISOString() },
          action: { S: "change-agent-status" },
          actor: { S: actor },
          target: { S: JSON.stringify(target) },
          result: { S: result },
          errorMsg: { S: errorMsg || "" }
        }
      })
    );
  } catch (err) {
    console.warn("audit write failed:", err);
  }
}
var handler = async (event) => {
  const body = JSON.parse(event.body || "{}");
  const { userId, agentStatusId, actor } = body;
  if (!userId || !agentStatusId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "userId and agentStatusId required" })
    };
  }
  try {
    await connect.send(
      new import_client_connect.PutUserStatusCommand({
        InstanceId: INSTANCE_ID,
        UserId: userId,
        AgentStatusId: agentStatusId
      })
    );
    await audit(actor || "unknown", { userId, agentStatusId }, "success");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, agentStatusId, updated: true })
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await audit(
      actor || "unknown",
      { userId, agentStatusId },
      "error",
      msg
    );
    console.error("change-agent-status error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to change agent status",
        message: msg
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
