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

// amplify/functions/get-churn-risk/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var import_client_customer_profiles = require("@aws-sdk/client-customer-profiles");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var profiles = new import_client_customer_profiles.CustomerProfilesClient({ maxAttempts: 1 });
var TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "connectview-contacts";
var CUSTOMER_PROFILES_DOMAIN = process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";
async function scanRecentContacts(days) {
  const startIso = new Date(Date.now() - days * 86400 * 1e3).toISOString();
  const rows = [];
  let lastKey;
  for (let i = 0; i < 10; i++) {
    const result = await dynamo.send(
      new import_client_dynamodb.ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "initiationTimestamp >= :start AND attribute_exists(customerPhone) AND customerPhone <> :empty",
        ExpressionAttributeValues: {
          ":start": { S: startIso },
          ":empty": { S: "" }
        },
        ExclusiveStartKey: lastKey
      })
    );
    for (const it of result.Items || []) rows.push((0, import_util_dynamodb.unmarshall)(it));
    lastKey = result.LastEvaluatedKey;
    if (!lastKey) break;
  }
  return rows;
}
function bucketByCustomer(rows) {
  const map = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const phone = r.customerPhone || "";
    if (!phone) continue;
    let b = map.get(phone);
    if (!b) {
      b = {
        customerPhone: phone,
        contactCount: 0,
        negativeContacts: 0,
        mixedContacts: 0,
        lastContactAt: r.initiationTimestamp,
        lastSentiment: r.sentiment || "UNKNOWN",
        totalNegativeSegments: 0,
        totalPositiveSegments: 0,
        avgDurationSec: 0,
        abandonedCount: 0
      };
      map.set(phone, b);
    }
    b.contactCount++;
    b.totalNegativeSegments += Number(r.sentimentNegative || 0);
    b.totalPositiveSegments += Number(r.sentimentPositive || 0);
    b.avgDurationSec += Number(r.duration || 0);
    if (r.sentiment === "NEGATIVE") b.negativeContacts++;
    if (r.sentiment === "MIXED") b.mixedContacts++;
    if (r.disconnectReason === "CUSTOMER_DISCONNECT" && Number(r.duration || 0) < 30) {
      b.abandonedCount++;
    }
    if (new Date(r.initiationTimestamp) > new Date(b.lastContactAt)) {
      b.lastContactAt = r.initiationTimestamp;
      b.lastSentiment = r.sentiment || b.lastSentiment;
    }
  }
  for (const b of map.values()) {
    b.avgDurationSec = Math.round(b.avgDurationSec / Math.max(1, b.contactCount));
  }
  return map;
}
function computeRiskScore(b) {
  const negativeSegmentTotal = b.totalNegativeSegments + b.totalPositiveSegments;
  const negativeRatio = negativeSegmentTotal > 0 ? b.totalNegativeSegments / negativeSegmentTotal : 0;
  const contactWeight = Math.min(1, b.contactCount / 5);
  const abandonedWeight = Math.min(1, b.abandonedCount / 3);
  const sentimentWeight = negativeRatio;
  const lastSentimentBoost = b.lastSentiment === "NEGATIVE" ? 0.2 : b.lastSentiment === "MIXED" ? 0.1 : 0;
  const score = 40 * sentimentWeight + 25 * contactWeight + 20 * abandonedWeight + 15 * lastSentimentBoost;
  return Math.max(0, Math.min(100, Math.round(score * 1.1)));
}
async function lookupProfileName(phone) {
  try {
    const res = await profiles.send(
      new import_client_customer_profiles.SearchProfilesCommand({
        DomainName: CUSTOMER_PROFILES_DOMAIN,
        KeyName: "_phone",
        Values: [phone]
      })
    );
    const p = res.Items?.[0];
    if (!p) return null;
    const first = p.FirstName?.trim() || "";
    const last = p.LastName?.trim() || "";
    const name = `${first} ${last}`.trim();
    return name || null;
  } catch {
    return null;
  }
}
var handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const days = parseInt(params.days || "30");
    const limit = parseInt(params.limit || "5");
    const minRisk = parseInt(params.minRisk || "40");
    const rows = await scanRecentContacts(days);
    const customers = bucketByCustomer(rows);
    const ranked = [...customers.values()].map((b) => {
      const score = computeRiskScore(b);
      const daysSince = Math.floor(
        (Date.now() - new Date(b.lastContactAt).getTime()) / 864e5
      );
      return { ...b, riskScore: score, daysSinceContact: daysSince };
    }).filter((c) => c.riskScore >= minRisk).sort((a, b) => b.riskScore - a.riskScore).slice(0, limit);
    const enriched = await Promise.all(
      ranked.map(async (c) => ({
        customerPhone: c.customerPhone,
        name: await lookupProfileName(c.customerPhone) || c.customerPhone,
        contactCount: c.contactCount,
        lastSentiment: c.lastSentiment,
        daysSinceContact: c.daysSinceContact,
        riskScore: c.riskScore
      }))
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rangeDays: days,
        totalCustomersAnalyzed: customers.size,
        atRisk: enriched
      })
    };
  } catch (err) {
    console.error("churn-risk error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to compute churn risk",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
