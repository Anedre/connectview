import type { Handler } from "aws-lambda";
import { ConnectClient, DescribeContactCommand } from "@aws-sdk/client-connect";
import {
  ConnectContactLensClient,
  ListRealtimeContactAnalysisSegmentsCommand,
} from "@aws-sdk/client-connect-contact-lens";
import { resolveConnect } from "../_shared/tenantConnect";

// maxAttempts: 1 → no retries on throttling. We'd rather return fast and let the
// frontend's 5s polling pick up next time than waste the 10s Lambda budget on retry backoff.
const client = new ConnectContactLensClient({ maxAttempts: 1 });
const connectClient = new ConnectClient({ maxAttempts: 1 });
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

// Cache contact start timestamps so we don't DescribeContact on every poll.
const startTsCache = new Map<string, string>();

async function getContactStartTimestamp(
  connect: ConnectClient,
  instanceId: string,
  contactId: string,
): Promise<string | null> {
  const ck = `${instanceId}:${contactId}`;
  if (startTsCache.has(ck)) return startTsCache.get(ck)!;
  try {
    const res = await connect.send(
      new DescribeContactCommand({
        InstanceId: instanceId,
        ContactId: contactId,
      }),
    );
    const ts =
      res.Contact?.ConnectedToSystemTimestamp?.toISOString() ||
      res.Contact?.InitiationTimestamp?.toISOString() ||
      null;
    if (ts) startTsCache.set(ck, ts);
    return ts;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const contactId = event.queryStringParameters?.contactId;
  if (!contactId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "contactId required" }),
    };
  }

  // Auth + tenant: resuelve el Connect del tenant del JWT. Anónimo / tenant sin
  // instancia → instancia bloqueada → cortamos (NO leakeamos las transcripciones
  // EN VIVO de Novasys, que antes eran públicas por contactId). Contact Lens no
  // tiene blocked-client, así que el corte es explícito aquí.
  const r = await resolveConnect(event.headers, connectClient, INSTANCE_ID);
  const instanceId = r.instanceId;
  if (!instanceId || instanceId.startsWith("blocked")) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId,
        segments: [],
        categories: [],
        overallSentiment: "NEUTRAL",
        sentimentCounts: { positive: 0, negative: 0, neutral: 0 },
        totalSegments: 0,
      }),
    };
  }

  try {
    const segments: Array<{
      type: "transcript" | "category" | "issue";
      participant?: string;
      content?: string;
      sentiment?: string;
      beginOffsetMs: number;
      endOffsetMs: number;
      categoryName?: string;
      issueText?: string;
    }> = [];

    // SINGLE page, no pagination. With MaxResults: 100 a live conversation easily fits.
    // Pagination + throttling retries was killing the 10s Lambda budget and causing 502s.
    // If a call ever exceeds 100 segments, we just lose the oldest ones — better than nothing.
    const result = await client.send(
      new ListRealtimeContactAnalysisSegmentsCommand({
        InstanceId: instanceId,
        ContactId: contactId,
        MaxResults: 100,
      }),
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
          issueText: s.Transcript.IssuesDetected?.[0]
            ? s.Transcript.Content?.substring(
                s.Transcript.IssuesDetected[0].CharacterOffsets?.BeginOffsetChar || 0,
                s.Transcript.IssuesDetected[0].CharacterOffsets?.EndOffsetChar || 0,
              )
            : undefined,
        });
      }
      if (s.Categories) {
        for (const matched of s.Categories.MatchedCategories || []) {
          segments.push({
            type: "category",
            categoryName: matched,
            beginOffsetMs: 0,
            endOffsetMs: 0,
          });
        }
      }
    }

    // Get the contact start timestamp so the frontend can render absolute clock times.
    // Cached after first lookup so this only adds ~150ms once per contactId.
    const transcriptStartTimestamp = await getContactStartTimestamp(
      r.client,
      instanceId,
      contactId,
    );

    // Sort transcript segments by time
    segments.sort((a, b) => a.beginOffsetMs - b.beginOffsetMs);

    // Calculate overall sentiment from transcript segments
    const transcripts = segments.filter((s) => s.type === "transcript");
    const positive = transcripts.filter((s) => s.sentiment === "POSITIVE").length;
    const negative = transcripts.filter((s) => s.sentiment === "NEGATIVE").length;
    const neutral = transcripts.filter((s) => s.sentiment === "NEUTRAL").length;
    const overall = negative > positive ? "NEGATIVE" : positive > negative ? "POSITIVE" : "NEUTRAL";

    // Unique categories
    const categories = Array.from(
      new Set(segments.filter((s) => s.type === "category").map((s) => s.categoryName!)),
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
        transcriptStartTimestamp,
      }),
    };
  } catch (error) {
    // ThrottlingException / TooManyRequestsException → return graceful 200 so the UI keeps the
    // previous transcript instead of flashing an error. Contact Lens has tight rate limits.
    const errName =
      error && typeof error === "object" && "name" in error
        ? String((error as { name: unknown }).name)
        : "";
    const errMsg = error instanceof Error ? error.message : String(error);
    const isThrottled =
      errName === "ThrottlingException" ||
      errName === "TooManyRequestsException" ||
      /throttl|too many requests|rate exceeded/i.test(errMsg);

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
          totalSegments: 0,
        }),
      };
    }

    console.error("Error getting live transcript:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get live transcript",
        message: errMsg,
      }),
    };
  }
};
