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

// amplify/functions/admin-list-audit/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";
var handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const limit = parseInt(params.limit || "100");
    const items = [];
    let lastKey;
    for (let i = 0; i < 5; i++) {
      const res = await dynamo.send(
        new import_client_dynamodb.ScanCommand({
          TableName: AUDIT_TABLE,
          Limit: limit,
          ExclusiveStartKey: lastKey
        })
      );
      for (const it of res.Items || []) {
        const row = (0, import_util_dynamodb.unmarshall)(it);
        if (typeof row.target === "string") {
          try {
            row.target = JSON.parse(row.target);
          } catch {
          }
        }
        items.push(row);
      }
      lastKey = res.LastEvaluatedKey;
      if (!lastKey || items.length >= limit) break;
    }
    items.sort(
      (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: items.slice(0, limit),
        total: items.length
      })
    };
  } catch (err) {
    console.error("list-audit error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to list audit",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
