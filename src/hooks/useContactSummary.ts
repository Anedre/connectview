import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import type { ContactTranscriptSegment } from "@/hooks/useContactDetail";

/**
 * Build a Bedrock-friendly transcript string from a list of contact
 * segments. Skips attachments (they aren't text) and events (they're
 * metadata noise). Truncates participant labels to AGENT/CUSTOMER/SYSTEM
 * because that's what the prompt expects.
 */
function segmentsToTranscript(segments: ContactTranscriptSegment[]): string {
  return segments
    .filter((s) => s.type === "message" || s.type === "transcript")
    .map((s) => {
      const p = (s.participant || "UNKNOWN").toUpperCase();
      const role =
        p === "AGENT" || p === "CUSTOMER" || p === "SYSTEM" ? p : "UNKNOWN";
      // Strip JSON for interactive replies — Bedrock doesn't need the wrapper
      let content = s.content || "";
      if (s.contentType?.includes("interactive") && content.startsWith("{")) {
        try {
          const parsed = JSON.parse(content);
          content =
            parsed?.data?.content?.title || parsed?.title || content;
        } catch {
          /* keep raw */
        }
      }
      return `${role}: ${content}`;
    })
    .join("\n");
}

/**
 * Generates an AI summary of a historical contact using its transcript.
 * Sends the transcript text to `generate-call-summary` Lambda (which routes
 * to Bedrock). Returns a degraded-but-non-empty `summary` even if Bedrock
 * fails — the Lambda handles that itself.
 *
 * Auto-fires when `segments` becomes non-empty and `contactId` changes.
 * No-ops while segments is empty.
 */
export function useContactSummary(
  contactId: string | null,
  segments: ContactTranscriptSegment[] | null
) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contactId) {
      setSummary(null);
      return;
    }
    if (!segments || segments.length === 0) {
      // We have a contactId but no usable transcript — let the caller
      // render a "Sin transcripción" hint instead of calling Bedrock.
      setSummary(null);
      return;
    }
    const endpoints = getApiEndpoints();
    if (!endpoints?.generateCallSummary) {
      setError("Endpoint generateCallSummary no configurado");
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setSummary(null);
    const transcriptText = segmentsToTranscript(segments);
    if (!transcriptText.trim()) {
      setLoading(false);
      setSummary(null);
      return;
    }
    fetch(endpoints.generateCallSummary, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId,
        mode: "summary",
        transcript: transcriptText,
      }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (ctrl.signal.aborted) return;
        const text = (j.result || j.summary || "").trim();
        setSummary(text || null);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Error generando resumen");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [contactId, segments]);

  return { summary, loading, error };
}
