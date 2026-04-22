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

// amplify/functions/admin-stop-contact/handler.ts
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
var INSTANCE_ARN = process.env.CONNECT_INSTANCE_ARN || `arn:aws:connect:us-east-1:731736972577:instance/${INSTANCE_ID}`;
var AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";
async function audit(actor, contactId, result, errorMsg) {
  try {
    await dynamo.send(
      new import_client_dynamodb.PutItemCommand({
        TableName: AUDIT_TABLE,
        Item: {
          auditId: { S: (0, import_node_crypto.randomUUID)() },
          timestamp: { S: (/* @__PURE__ */ new Date()).toISOString() },
          action: { S: "stop-contact" },
          actor: { S: actor },
          target: { S: JSON.stringify({ contactId }) },
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
  const { contactId, actor } = body;
  if (!contactId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "contactId required" })
    };
  }
  try {
    await connect.send(
      new import_client_connect.StopContactCommand({
        InstanceId: INSTANCE_ID,
        ContactId: contactId
      })
    );
    await audit(actor || "unknown", contactId, "success");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, stopped: true })
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await audit(actor || "unknown", contactId, "error", msg);
    console.error("stop-contact error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to stop contact", message: msg })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
