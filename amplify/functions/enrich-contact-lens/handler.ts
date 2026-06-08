import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  DescribeContactCommand,
} from "@aws-sdk/client-connect";
import {
  ConnectContactLensClient,
  ListRealtimeContactAnalysisSegmentsCommand,
} from "@aws-sdk/client-connect-contact-lens";
import {
  DynamoDBClient,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { getTenantConnect } from "../_shared/tenantConnect";

// BYO (#43+#46): module-active. process-contact-event pasa { tenantId } en
// el event y nos cambia el Connect + DDB al del cliente.
const legacyConnect = new ConnectClient({ maxAttempts: 1 });
let connect: ConnectClient = legacyConnect;
const contactLens = new ConnectContactLensClient({ maxAttempts: 1 });
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "";

interface EnrichEvent {
  contactId: string;
  instanceId: string;
  /** #46: tenantId opcional pasado por process-contact-event. Si está,
   *  resolvemos `connect`+`dynamo` del tenant; si no, legacy Vox. */
  tenantId?: string;
}

type Sentiment = "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED" | "UNKNOWN";

interface SentimentStats {
  overall: Sentiment;
  positive: number;
  negative: number;
  neutral: number;
  total: number;
}

async function computeSentiment(
  contactId: string,
  instanceId: string
): Promise<SentimentStats> {
  try {
    const result = await contactLens.send(
      new ListRealtimeContactAnalysisSegmentsCommand({
        InstanceId: instanceId,
        ContactId: contactId,
        MaxResults: 100,
      })
    );

    let positive = 0;
    let negative = 0;
    let neutral = 0;
    for (const s of result.Segments || []) {
      if (!s.Transcript?.Sentiment) continue;
      // Only count CUSTOMER sentiment — the agent's sentiment doesn't represent
      // customer satisfaction.
      if (s.Transcript.ParticipantRole !== "CUSTOMER") continue;
      if (s.Transcript.Sentiment === "POSITIVE") positive++;
      else if (s.Transcript.Sentiment === "NEGATIVE") negative++;
      else if (s.Transcript.Sentiment === "NEUTRAL") neutral++;
    }
    const total = positive + negative + neutral;
    if (total === 0) {
      return { overall: "UNKNOWN", positive: 0, negative: 0, neutral: 0, total: 0 };
    }
    // If both positive AND negative segments exist in meaningful amounts → MIXED.
    const positiveRatio = positive / total;
    const negativeRatio = negative / total;
    let overall: Sentiment;
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

export const handler: Handler<EnrichEvent> = async (event) => {
  const { contactId, instanceId, tenantId } = event;

  // BYO (#46): si el invoker pasó tenantId, usar el Connect+DDB del tenant.
  if (tenantId) {
    const tc = await getTenantConnect(tenantId);
    if (tc) {
      connect = tc.client;
      dynamo = tc.dynamo;
    }
  }

  try {
    // Wait for Contact Lens analysis to finalize post-disconnect.
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Get contact description for duration + customer endpoint
    const contactDesc = await connect.send(
      new DescribeContactCommand({
        InstanceId: instanceId,
        ContactId: contactId,
      })
    );

    const contact = contactDesc.Contact;
    const duration =
      contact?.DisconnectTimestamp && contact?.InitiationTimestamp
        ? Math.round(
            (contact.DisconnectTimestamp.getTime() -
              contact.InitiationTimestamp.getTime()) /
              1000
          )
        : 0;

    const customerPhone = contact?.CustomerEndpoint?.Address || "";
    const customerEndpointType = contact?.CustomerEndpoint?.Type || "";

    // Compute real sentiment from Contact Lens segments.
    const sentimentStats = await computeSentiment(contactId, instanceId);

    // Update DynamoDB with enriched data. Conditional on contact existing so we don't
    // create stub rows for contacts we never processed on INITIATED.
    await dynamo.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: {
          contactId: { S: contactId },
        },
        UpdateExpression:
          "SET #dur = :dur, sentiment = :sent, customerPhone = :phone, customerEndpointType = :etype, sentimentPositive = :pos, sentimentNegative = :neg, sentimentNeutral = :neu, sentimentTotal = :tot",
        ExpressionAttributeNames: {
          "#dur": "duration",
        },
        ExpressionAttributeValues: {
          ":dur": { N: String(duration) },
          ":sent": { S: sentimentStats.overall },
          ":phone": { S: customerPhone },
          ":etype": { S: customerEndpointType },
          ":pos": { N: String(sentimentStats.positive) },
          ":neg": { N: String(sentimentStats.negative) },
          ":neu": { N: String(sentimentStats.neutral) },
          ":tot": { N: String(sentimentStats.total) },
        },
        ConditionExpression: "attribute_exists(contactId)",
      })
    );
  } catch (error) {
    // If the item doesn't exist yet (race with INITIATED event) just swallow it
    if (
      error instanceof Error &&
      error.name === "ConditionalCheckFailedException"
    ) {
      console.warn("Contact row missing on enrich, skipping:", contactId);
      return;
    }
    console.error("Error enriching contact:", error);
    throw error;
  }
};
