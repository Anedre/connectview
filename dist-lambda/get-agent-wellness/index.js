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

// amplify/functions/get-agent-wellness/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "connectview-contacts";
function startOfDayLimaIso() {
  const now = /* @__PURE__ */ new Date();
  const lima = new Date(now.getTime() - 5 * 3600 * 1e3);
  lima.setUTCHours(0, 0, 0, 0);
  return new Date(lima.getTime() + 5 * 3600 * 1e3).toISOString();
}
async function queryAgentToday(agentKey) {
  const startIso = startOfDayLimaIso();
  const result = await dynamo.send(
    new import_client_dynamodb.QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "agentUsername-initiationTimestamp-index",
      KeyConditionExpression: "agentUsername = :agent AND initiationTimestamp >= :start",
      ExpressionAttributeValues: {
        ":agent": { S: agentKey },
        ":start": { S: startIso }
      },
      ScanIndexForward: true
    })
  );
  return (result.Items || []).map((it) => (0, import_util_dynamodb.unmarshall)(it));
}
var handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const agentKey = params.userId || params.agentUsername;
    if (!agentKey) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "userId or agentUsername required" })
      };
    }
    const rows = await queryAgentToday(agentKey);
    const focusSec = rows.reduce((acc, r) => acc + Number(r.duration || 0), 0);
    const focusMinutes = Math.round(focusSec / 60);
    const totalPos = rows.reduce((acc, r) => acc + Number(r.sentimentPositive || 0), 0);
    const totalNeg = rows.reduce((acc, r) => acc + Number(r.sentimentNegative || 0), 0);
    const moodTotal = totalPos + totalNeg;
    const moodScore = moodTotal === 0 ? 75 : Math.max(0, Math.min(100, Math.round(50 + 50 * (totalPos - totalNeg) / moodTotal)));
    const focusPct = Math.min(1, focusMinutes / 480);
    const moodPenalty = Math.max(0, (75 - moodScore) / 75);
    const energy = Math.max(
      0,
      Math.min(100, Math.round(100 - focusPct * 70 - moodPenalty * 30))
    );
    const negativeContactCount = rows.filter(
      (r) => Number(r.sentimentNegative || 0) > Number(r.sentimentPositive || 0)
    ).length;
    const needsBreak = energy < 40 || focusMinutes > 300;
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentKey,
        contactsToday: rows.length,
        focusMinutes,
        moodScore,
        energy,
        negativeContactCount,
        needsBreak
      })
    };
  } catch (err) {
    console.error("wellness error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to compute wellness",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
