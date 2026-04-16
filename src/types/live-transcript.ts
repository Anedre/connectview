export interface LiveTranscriptSegment {
  type: "transcript" | "category" | "issue";
  participant?: string;
  content?: string;
  sentiment?: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED";
  beginOffsetMs: number;
  endOffsetMs: number;
  categoryName?: string;
  issueText?: string;
}

export interface LiveTranscriptData {
  contactId: string;
  segments: LiveTranscriptSegment[];
  categories: string[];
  overallSentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  sentimentCounts: {
    positive: number;
    negative: number;
    neutral: number;
  };
  totalSegments: number;
  // ISO 8601 UTC of when the call connected. Used to render absolute clock times.
  transcriptStartTimestamp?: string | null;
  // True when Connect Contact Lens is rate-limiting; segments will be empty for this poll.
  throttled?: boolean;
}
