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

// amplify/functions/get-live-transcript/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var import_client_connect_contact_lens = require("@aws-sdk/client-connect-contact-lens");
var client = new import_client_connect_contact_lens.ConnectContactLensClient({ maxAttempts: 1 });
var connectClient = new import_client_connect.ConnectClient({ maxAttempts: 1 });
var INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
var startTsCache = /* @__PURE__ */ new Map();
async function getContactStartTimestamp(contactId) {
  if (startTsCache.has(contactId)) return startTsCache.get(contactId);
  try {
    const res = await connectClient.send(
      new import_client_connect.DescribeContactCommand({
        InstanceId: INSTANCE_ID,
        ContactId: contactId
      })
    );
    const ts = res.Contact?.ConnectedToSystemTimestamp?.toISOString() || res.Contact?.InitiationTimestamp?.toISOString() || null;
    if (ts) startTsCache.set(contactId, ts);
    return ts;
  } catch {
    return null;
  }
}
var handler = async (event) => {
  const contactId = event.queryStringParameters?.contactId;
  if (!contactId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "contactId required" })
    };
  }
  try {
    const segments = [];
    const result = await client.send(
      new import_client_connect_contact_lens.ListRealtimeContactAnalysisSegmentsCommand({
        InstanceId: INSTANCE_ID,
        ContactId: contactId,
        MaxResults: 100
      })
    );
    for (const s of result.Segments || []) {
      if (s.Transcript) {
        segments.push({
          type: "transcript",
          // ParticipantRole ("AGENT"/"CUSTOMER") is the canonical field; ParticipantId may be a UUID.
          participant: s.Transcript.ParticipantRole || s.Transcript.ParticipantId || "UNKNOWN",
          content: s.Transcript.Content || "",
          sentiment: s.Transcript.Sentiment,
          beginOffsetMs: s.Transcript.BeginOffsetMillis || 0,
          endOffsetMs: s.Transcript.EndOffsetMillis || 0,
          issueText: s.Transcript.IssuesDetected?.[0] ? s.Transcript.Content?.substring(
            s.Transcript.IssuesDetected[0].CharacterOffsets?.BeginOffsetChar || 0,
            s.Transcript.IssuesDetected[0].CharacterOffsets?.EndOffsetChar || 0
          ) : void 0
        });
      }
      if (s.Categories) {
        for (const matched of s.Categories.MatchedCategories || []) {
          segments.push({
            type: "category",
            categoryName: matched,
            beginOffsetMs: 0,
            endOffsetMs: 0
          });
        }
      }
    }
    const transcriptStartTimestamp = await getContactStartTimestamp(contactId);
    segments.sort((a, b) => a.beginOffsetMs - b.beginOffsetMs);
    const transcripts = segments.filter((s) => s.type === "transcript");
    const positive = transcripts.filter((s) => s.sentiment === "POSITIVE").length;
    const negative = transcripts.filter((s) => s.sentiment === "NEGATIVE").length;
    const neutral = transcripts.filter((s) => s.sentiment === "NEUTRAL").length;
    const overall = negative > positive ? "NEGATIVE" : positive > negative ? "POSITIVE" : "NEUTRAL";
    const categories = Array.from(
      new Set(
        segments.filter((s) => s.type === "category").map((s) => s.categoryName)
      )
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId,
        segments: transcripts,
        categories,
        overallSentiment: overall,
        sentimentCounts: { positive, negative, neutral },
        totalSegments: transcripts.length,
        // ISO 8601 UTC. Frontend adds beginOffsetMs and renders in user's local timezone.
        transcriptStartTimestamp
      })
    };
  } catch (error) {
    const errName = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    const errMsg = error instanceof Error ? error.message : String(error);
    const isThrottled = errName === "ThrottlingException" || errName === "TooManyRequestsException" || /throttl|too many requests|rate exceeded/i.test(errMsg);
    if (isThrottled) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          throttled: true,
          segments: [],
          categories: [],
          overallSentiment: "NEUTRAL",
          sentimentCounts: { positive: 0, negative: 0, neutral: 0 },
          totalSegments: 0
        })
      };
    }
    console.error("Error getting live transcript:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get live transcript",
        message: errMsg
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
