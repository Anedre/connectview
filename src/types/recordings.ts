export interface TranscriptSegment {
  content: string;
  participant: "AGENT" | "CUSTOMER" | "SYSTEM" | "UNKNOWN";
  beginOffsetMillis: number;
  endOffsetMillis: number;
  sentiment?: string;
}

/** Un lead/contacto en la lista de Historial y Grabaciones (conectado por nombre). */
export interface RecentLead {
  leadId: string;
  name?: string;
  phone: string;
  email?: string;
  company?: string;
  stageId?: string;
  source?: string;
  sfLeadId?: string;
  updatedAt?: string;
  createdAt?: string;
  lastActivity?: {
    type?: string;
    channel?: string;
    untyped?: boolean;
    stageLabel?: string;
    subStageLabel?: string;
    ts?: string;
  } | null;
}

export interface RecordingDetail {
  contactId: string;
  recordingUrl: string;
  duration: number;
  transcript: TranscriptSegment[];
  hasRecording: boolean;
  hasTranscript: boolean;
}
