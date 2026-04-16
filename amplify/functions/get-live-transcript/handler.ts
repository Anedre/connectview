import type { Handler } from "aws-lambda";
import {
  ConnectContactLensClient,
  ListRealtimeContactAnalysisSegmentsCommand,
} from "@aws-sdk/client-connect-contact-lens";

const client = new ConnectContactLensClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

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

    let nextToken: string | undefined;
    do {
      const result = await client.send(
        new ListRealtimeContactAnalysisSegmentsCommand({
          InstanceId: INSTANCE_ID,
          ContactId: contactId,
          NextToken: nextToken,
          MaxResults: 100,
        })
      );

      for (const s of result.Segments || []) {
        if (s.Transcript) {
          segments.push({
            type: "transcript",
            participant: s.Transcript.ParticipantId || "UNKNOWN",
            content: s.Transcript.Content || "",
            sentiment: s.Transcript.Sentiment,
            beginOffsetMs: s.Transcript.BeginOffsetMillis || 0,
            endOffsetMs: s.Transcript.EndOffsetMillis || 0,
            issueText: s.Transcript.IssuesDetected?.[0]
              ? s.Transcript.Content?.substring(
                  s.Transcript.IssuesDetected[0].CharacterOffsets
                    ?.BeginOffsetChar || 0,
                  s.Transcript.IssuesDetected[0].CharacterOffsets
                    ?.EndOffsetChar || 0
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

      nextToken = result.NextToken;
    } while (nextToken);

    // Sort transcript segments by time
    segments.sort((a, b) => a.beginOffsetMs - b.beginOffsetMs);

    // Calculate overall sentiment from transcript segments
    const transcripts = segments.filter((s) => s.type === "transcript");
    const positive = transcripts.filter((s) => s.sentiment === "POSITIVE").length;
    const negative = transcripts.filter((s) => s.sentiment === "NEGATIVE").length;
    const neutral = transcripts.filter((s) => s.sentiment === "NEUTRAL").length;
    const overall =
      negative > positive
        ? "NEGATIVE"
        : positive > negative
        ? "POSITIVE"
        : "NEUTRAL";

    // Unique categories
    const categories = Array.from(
      new Set(
        segments.filter((s) => s.type === "category").map((s) => s.categoryName!)
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
