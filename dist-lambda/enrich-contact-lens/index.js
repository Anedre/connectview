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

// amplify/functions/enrich-contact-lens/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var import_client_connect_contact_lens = require("@aws-sdk/client-connect-contact-lens");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var connect = new import_client_connect.ConnectClient({ maxAttempts: 1 });
var contactLens = new import_client_connect_contact_lens.ConnectContactLensClient({ maxAttempts: 1 });
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "";
async function computeSentiment(contactId, instanceId) {
  try {
    const result = await contactLens.send(
      new import_client_connect_contact_lens.ListRealtimeContactAnalysisSegmentsCommand({
        InstanceId: instanceId,
        ContactId: contactId,
        MaxResults: 100
      })
    );
    let positive = 0;
    let negative = 0;
    let neutral = 0;
    for (const s of result.Segments || []) {
      if (!s.Transcript?.Sentiment) continue;
      if (s.Transcript.ParticipantRole !== "CUSTOMER") continue;
      if (s.Transcript.Sentiment === "POSITIVE") positive++;
      else if (s.Transcript.Sentiment === "NEGATIVE") negative++;
      else if (s.Transcript.Sentiment === "NEUTRAL") neutral++;
    }
    const total = positive + negative + neutral;
    if (total === 0) {
      return { overall: "UNKNOWN", positive: 0, negative: 0, neutral: 0, total: 0 };
    }
    const positiveRatio = positive / total;
    const negativeRatio = negative / total;
    let overall;
    if (positiveRatio >= 0.3 && negativeRatio >= 0.3) overall = "MIXED";
    else if (negative > positive && negativeRatio > 0.3) overall = "NEGATIVE";
    else if (positive > negative && positiveRatio > 0.3) overall = "POSITIVE";
    else overall = "NEUTRAL";
    return { overall, positive, negative, neutral, total };
  } catch (err) {
    console.warn("Contact Lens sentiment lookup failed:", err);
    return { overall: "UNKNOWN", positive: 0, negative: 0, neutral: 0, total: 0 };
  }
}
var handler = async (event) => {
  const { contactId, instanceId } = event;
  try {
    await new Promise((resolve) => setTimeout(resolve, 5e3));
    const contactDesc = await connect.send(
      new import_client_connect.DescribeContactCommand({
        InstanceId: instanceId,
        ContactId: contactId
      })
    );
    const contact = contactDesc.Contact;
    const duration = contact?.DisconnectTimestamp && contact?.InitiationTimestamp ? Math.round(
      (contact.DisconnectTimestamp.getTime() - contact.InitiationTimestamp.getTime()) / 1e3
    ) : 0;
    const customerPhone = contact?.CustomerEndpoint?.Address || "";
    const customerEndpointType = contact?.CustomerEndpoint?.Type || "";
    const sentimentStats = await computeSentiment(contactId, instanceId);
    await dynamo.send(
      new import_client_dynamodb.UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: {
          contactId: { S: contactId }
        },
        UpdateExpression: "SET #dur = :dur, sentiment = :sent, customerPhone = :phone, customerEndpointType = :etype, sentimentPositive = :pos, sentimentNegative = :neg, sentimentNeutral = :neu, sentimentTotal = :tot",
        ExpressionAttributeNames: {
          "#dur": "duration"
        },
        ExpressionAttributeValues: {
          ":dur": { N: String(duration) },
          ":sent": { S: sentimentStats.overall },
          ":phone": { S: customerPhone },
          ":etype": { S: customerEndpointType },
          ":pos": { N: String(sentimentStats.positive) },
          ":neg": { N: String(sentimentStats.negative) },
          ":neu": { N: String(sentimentStats.neutral) },
          ":tot": { N: String(sentimentStats.total) }
        },
        ConditionExpression: "attribute_exists(contactId)"
      })
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      console.warn("Contact row missing on enrich, skipping:", contactId);
      return;
    }
    console.error("Error enriching contact:", error);
    throw error;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
