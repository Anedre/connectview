export interface TranscriptSegment {
  content: string;
  participant: "AGENT" | "CUSTOMER" | "SYSTEM" | "UNKNOWN";
  beginOffsetMillis: number;
  endOffsetMillis: number;
  sentiment?: string;
}

export interface RecordingDetail {
  contactId: string;
  recordingUrl: string;
  duration: number;
  transcript: TranscriptSegment[];
  hasRecording: boolean;
  hasTranscript: boolean;
}
