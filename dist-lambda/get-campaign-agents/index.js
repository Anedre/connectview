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

// amplify/functions/get-campaign-agents/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var connect = new import_client_connect.ConnectClient({ maxAttempts: 1 });
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
var AGENTS_TABLE = process.env.CAMPAIGN_AGENTS_TABLE || "connectview-campaign-agents";
var userCache = /* @__PURE__ */ new Map();
async function resolveUsername(userId) {
  if (userCache.has(userId)) return userCache.get(userId);
  try {
    const res = await connect.send(
      new import_client_connect.DescribeUserCommand({ InstanceId: INSTANCE_ID, UserId: userId })
    );
    const name = res.User?.Username || userId;
    userCache.set(userId, name);
    return name;
  } catch {
    userCache.set(userId, userId);
    return userId;
  }
}
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
    const items = [];
    let lastKey;
    for (let i = 0; i < 5; i++) {
      const res = await dynamo.send(
        new import_client_dynamodb.QueryCommand({
          TableName: AGENTS_TABLE,
          KeyConditionExpression: "campaignId = :cid",
          ExpressionAttributeValues: { ":cid": { S: campaignId } },
          ExclusiveStartKey: lastKey
        })
      );
      for (const it of res.Items || []) items.push((0, import_util_dynamodb.unmarshall)(it));
      lastKey = res.LastEvaluatedKey;
      if (!lastKey) break;
    }
    const enriched = await Promise.all(
      items.map(async (it) => ({
        userId: it.userId,
        username: await resolveUsername(it.userId),
        routingProfileId: it.routingProfileId,
        queueId: it.queueId,
        addedQueueToRoutingProfile: Boolean(it.addedQueueToRoutingProfile),
        priority: Number(it.priority || 5),
        delay: Number(it.delay || 0),
        addedAt: it.addedAt,
        addedBy: it.addedBy
      }))
    );
    enriched.sort((a, b) => a.username.localeCompare(b.username));
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        agents: enriched,
        total: enriched.length
      })
    };
  } catch (err) {
    console.error("get-campaign-agents error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get campaign agents",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
