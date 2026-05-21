import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface ContactTranscriptSegment {
  type: "transcript";
  participant: string;
  content: string;
  sentiment?: string;
  beginOffsetMs: number;
  endOffsetMs: number;
  timestamp?: string;
}

export interface ContactAttachment {
  fileId: string;
  fileName?: string;
  fileSizeBytes?: number;
  fileStatus?: string;
  url?: string | null;
  createdTime?: string;
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
