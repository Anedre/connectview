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

// amplify/functions/get-agent-leaderboard/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var connect = new import_client_connect.ConnectClient({ maxAttempts: 1 });
var TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "connectview-contacts";
var INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
var userCache = /* @__PURE__ */ new Map();
async function resolveUsername(userId) {
  if (!userId) return "";
  if (userCache.has(userId)) return userCache.get(userId);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
  if (!isUuid) {
    userCache.set(userId, userId);
    return userId;
  }
  try {
    const res = await connect.send(
      new import_client_connect.DescribeUserCommand({ InstanceId: INSTANCE_ID, UserId: userId })
    );
    const username = res.User?.Username || userId;
    userCache.set(userId, username);
    return username;
  } catch {
    userCache.set(userId, userId);
    return userId;
  }
}
async function scanContactsWindow(startIso) {
  const rows = [];
  let lastKey;
  for (let i = 0; i < 10; i++) {
    const result = await dynamo.send(
      new import_client_dynamodb.ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "initiationTimestamp >= :start AND attribute_exists(agentUsername)",
        ExpressionAttributeValues: {
          ":start": { S: startIso }
        },
        ExclusiveStartKey: lastKey
      })
    );
    for (const it of result.Items || []) {
      rows.push((0, import_util_dynamodb.unmarshall)(it));
    }
    lastKey = result.LastEvaluatedKey;
    if (!lastKey) break;
  }
  return rows;
}
function aggregate(rows) {
  const map = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const agentId = r.agentUsername;
    if (!agentId) continue;
    let bucket = map.get(agentId);
    if (!bucket) {
      bucket = {
        agentId,
        username: agentId,
        contactCount: 0,
        totalDurationSec: 0,
        positiveSegments: 0,
        negativeSegments: 0
      };
      map.set(agentId, bucket);
    }
    bucket.contactCount++;
    bucket.totalDurationSec += Number(r.duration || 0);
    bucket.positiveSegments += Number(r.sentimentPositive || 0);
    bucket.negativeSegments += Number(r.sentimentNegative || 0);
  }
  return map;
}
var handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const rangeDays = parseInt(params.days || "7");
    const limit = parseInt(params.limit || "10");
    const now = Date.now();
    const currentWindowStart = new Date(now - rangeDays * 86400 * 1e3);
    const previousWindowStart = new Date(now - rangeDays * 2 * 86400 * 1e3);
    const currentRows = await scanContactsWindow(currentWindowStart.toISOString());
    const previousAllRows = await scanContactsWindow(previousWindowStart.toISOString());
    const previousRows = previousAllRows.filter(
      (r) => new Date(r.initiationTimestamp) < currentWindowStart
    );
    const currentAgg = aggregate(currentRows);
    const previousAgg = aggregate(previousRows);
    await Promise.all(
      [...currentAgg.values()].map(async (a) => {
        a.username = await resolveUsername(a.agentId);
      })
    );
    const leaderboard = [...currentAgg.values()].sort((a, b) => b.contactCount - a.contactCount).slice(0, limit).map((a, idx) => {
      const prev = previousAgg.get(a.agentId);
      const prevScore = prev?.contactCount || 0;
      const changePct = prevScore > 0 ? Math.round((a.contactCount - prevScore) / prevScore * 100) : a.contactCount > 0 ? 100 : 0;
      const sentimentTotal = a.positiveSegments + a.negativeSegments;
      const sentimentScore = sentimentTotal > 0 ? Math.round(a.positiveSegments / sentimentTotal * 100) : null;
      return {
        rank: idx + 1,
        agentId: a.agentId,
        username: a.username,
        contactCount: a.contactCount,
        totalMinutes: Math.round(a.totalDurationSec / 60),
        sentimentScore,
        changePct
      };
    });
    const badges = {
      onFire: leaderboard.filter((a) => a.contactCount >= 10).length,
      topCsat: leaderboard.filter((a) => a.sentimentScore !== null && a.sentimentScore >= 70).length,
      risingStar: leaderboard.filter((a) => a.changePct >= 20).length
    };
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rangeDays,
        totalAgents: currentAgg.size,
        totalContacts: currentRows.length,
        leaderboard,
        badges
      })
    };
  } catch (err) {
    console.error("leaderboard error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to compute leaderboard",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
