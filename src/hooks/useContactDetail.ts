import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

/**
 * One segment from the contact transcript. The `type` field discriminates:
 *   - "transcript"  : voice / Contact Lens segment (has begin/end offsets)
 *   - "message"     : chat text message
 *   - "attachment"  : chat file (PDF, image, audio, video) — see attachmentRef
 *   - "event"       : participant.joined / left / chat.ended / typing / read
 */
export interface ContactTranscriptSegment {
  type: "transcript" | "message" | "attachment" | "event";
  participant: string;
  content: string;
  /** Voice/Lens-only — content type for chat (e.g. text/plain, application/json) */
  contentType?: string;
  /** Voice/Lens-only — overall sentiment of the segment */
  sentiment?: string;
  beginOffsetMs: number;
  endOffsetMs: number;
  /** Chat-only — wall-clock timestamp of the message */
  timestamp?: string;
  /** Chat attachment cross-link — resolves to one of the top-level
   *  attachments[] by attachmentId, giving the bubble its presigned URL. */
  attachmentRef?: {
    attachmentId: string;
    name?: string;
    contentType?: string;
  };
  /** Chat event kind — participant.joined / chat.ended / etc. */
  eventKind?: string;
  /** Original Connect message id (delivered/read receipts) */
  id?: string;
}

export interface ContactAttachment {
  fileId: string;
  fileName?: string;
  fileSizeBytes?: number;
  fileStatus?: string;
  url?: string | null;
  createdTime?: string;
}

/**
 * Wrap-up data captured by the agent at the end of the contact —
 * disposition (stage → sub-stage), notes, tags, follow-up flags, and
 * any tasks that were spawned (task24h → Connect Task contactIds).
 * Returned by get-contact-detail when the wrap-up DynamoDB row exists.
 */
/**
 * A single historical wrap-up entry — produced every time an agent saves
 * the wrap-up form. Append-only; we never delete or update history rows.
 * The most-recent entry is also reflected in the top-level wrap-up
 * fields (notes/stage/valoracion/...) for the legacy single-state UI;
 * `history` carries the full audit trail when the same contact was
 * dispositioned more than once (e.g. agent reopens, supervisor corrects).
 */
export interface ContactWrapUpHistoryEntry {
  savedAt: string;
  agentUsername: string;
  agentNotes?: string;
  summary?: string;
  stage?: string;
  stageLabel?: string;
  subStage?: string;
  subStageLabel?: string;
  valoracion?: string;
  tags?: string[];
  followUps?: Record<string, boolean>;
  followUpTaskIds?: string[];
}

export interface ContactWrapUp {
  notes: string;
  summary: string;
  stage: string;
  stageLabel: string;
  subStage: string;
  subStageLabel: string;
  valoracion: string; // "muy_caliente" | "caliente" | "tibio" | "frio" | "no_califica" | ...
  tags: string[];
  followUps: Record<string, boolean>;
  followUpTaskIds: string[];
  agentUsername: string;
  updatedAt: string;
  /** Append-only audit trail of every wrap-up save. Newest first.
   *  Empty if the contact has only been dispositioned once (so the UI
   *  can skip rendering the "Historial" panel). */
  history?: ContactWrapUpHistoryEntry[];
}

export interface ContactDetail {
  contactId: string;
  channel: string;
  subChannel?: string;
  initiationTimestamp: string;
  disconnectTimestamp: string;
  connectedToSystemTimestamp?: string;
  duration: number;
  agentUsername: string;
  queueName: string;
  initiationMethod?: string;
  disconnectReason?: string;
  customerEndpoint?: string;
  customerEndpointType?: string;
  /** EMAIL channel only — the message Subject (from Contact.Name). */
  subject?: string;
  /** Whoever received the contact (e.g. UDEP admision email address). */
  systemEndpoint?: string;
  systemEndpointType?: string;
  attributes: Record<string, string>;
  recording: {
    url: string;
    expiresAt: string;
  } | null;
  transcript: {
    segments: ContactTranscriptSegment[];
    overallSentiment?: string;
    source: "contact-lens-s3" | "chat-s3" | string;
  } | null;
  attachments: ContactAttachment[];
  wrapUp: ContactWrapUp | null;
}

/**
 * Fetch the full detail of a single contact: metadata + presigned
 * audio URL + transcript + attachments. Used by the ContactDetailModal
 * the agent opens from the history timeline.
 */
export function useContactDetail(contactId: string | null) {
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contactId) {
      setDetail(null);
      return;
    }
    const endpoints = getApiEndpoints();
    if (!endpoints?.getContactDetail) {
      setError("Endpoint getContactDetail no configurado");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${endpoints.getContactDetail}?contactId=${encodeURIComponent(contactId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setDetail(data as ContactDetail);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  return { detail, loading, error };
}
