import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const dynamo = new DynamoDBClient({});
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "connectview-contacts";

interface ContactRow {
  contactId: string;
  agentUsername: string;
  initiationTimestamp: string;
  duration?: number;
  sentiment?: string;
  sentimentPositive?: number;
  sentimentNegative?: number;
  sentimentTotal?: number;
}

// Start-of-day ISO for the agent's local day (UTC-5 Lima by default).
function startOfDayLimaIso(): string {
  const now = new Date();
  // Lima is UTC-5 year-round (no DST).
  const lima = new Date(now.getTime() - 5 * 3600 * 1000);
  lima.setUTCHours(0, 0, 0, 0);
  // Convert back to UTC for DynamoDB comparison (rows store ISO UTC).
  return new Date(lima.getTime() + 5 * 3600 * 1000).toISOString();
}

async function queryAgentToday(agentKey: string): Promise<ContactRow[]> {
  const startIso = startOfDayLimaIso();
  const result = await dynamo.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "agentUsername-initiationTimestamp-index",
      KeyConditionExpression: "agentUsername = :agent AND initiationTimestamp >= :start",
      ExpressionAttributeValues: {
        ":agent": { S: agentKey },
        ":start": { S: startIso },
      },
      ScanIndexForward: true,
    })
  );
  return (result.Items || []).map((it) => unmarshall(it) as ContactRow);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    const params = event.queryStringParameters || {};
    // process-contact-event currently stores the agent UUID (from agentArn) as the GSI key.
    // Frontend has both available — prefer userId (UUID) and fall back to username.
    const agentKey =
      (params.userId as string | undefined) ||
      (params.agentUsername as string | undefined);

    if (!agentKey) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "userId or agentUsername required" }),
      };
    }

    const rows = await queryAgentToday(agentKey);

    // Focus time: sum of real call durations (in minutes). Cap at 480 (8 hrs shift) for display.
    const focusSec = rows.reduce((acc, r) => acc + Number(r.duration || 0), 0);
    const focusMinutes = Math.round(focusSec / 60);

    // Mood score: % of CUSTOMER positive segments across today's contacts.
    // Scoring formula: 50 (neutral baseline) + 50 * (pos - neg) / max(pos + neg, 1) → 0..100
    const totalPos = rows.reduce((acc, r) => acc + Number(r.sentimentPositive || 0), 0);
    const totalNeg = rows.reduce((acc, r) => acc + Number(r.sentimentNegative || 0), 0);
    const moodTotal = totalPos + totalNeg;
    const moodScore =
      moodTotal === 0
        ? 75 // default when no sentiment data yet — "unknown but assume good"
        : Math.max(0, Math.min(100, Math.round(50 + (50 * (totalPos - totalNeg)) / moodTotal)));

    // Energy: proxy for burnout. 100 = fresh, 0 = exhausted. Drops with focusMinutes,
    // drops faster if mood is negative. Linear 480 min → 0 if perfectly mood-neutral.
    const focusPct = Math.min(1, focusMinutes / 480);
    const moodPenalty = Math.max(0, (75 - moodScore) / 75); // 0..1, higher when mood is bad
    const energy = Math.max(
      0,
      Math.min(100, Math.round(100 - focusPct * 70 - moodPenalty * 30))
    );

    // Count NEGATIVE-dominated contacts (any row where negative segments > positive).
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
        needsBreak,
      }),
    };
  } catch (err) {
    console.error("wellness error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to compute wellness",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
