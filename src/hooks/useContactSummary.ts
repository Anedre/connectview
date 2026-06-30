import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
  const url = getApiEndpoints()?.generateCallSummary;
  // El transcript de un contacto cerrado es inmutable → su texto (y por tanto
  // el resumen) depende solo del contactId. Lo derivamos memoizado para usarlo
  // como cuerpo de la petición.
  const transcriptText = useMemo(
    () => (segments && segments.length ? segmentsToTranscript(segments) : ""),
    [segments]
  );
  const hasTranscript = !!transcriptText.trim();

  // Cacheamos el resumen por contactId con staleTime infinito: el resumen IA de
  // una interacción ya cerrada no cambia, así que reabrir el contacto NO vuelve
  // a llamar a Bedrock (antes regeneraba el resumen — y pagaba la latencia —
  // en cada apertura).
  const query = useQuery({
    queryKey: ["contactSummary", contactId],
    enabled: !!contactId && !!url && hasTranscript,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const r = await fetch(url!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          mode: "summary",
          transcript: transcriptText,
        }),
        signal,
      });
      const j = await r.json();
      const text = (j.result || j.summary || "").trim();
      return (text || null) as string | null;
    },
  });

  return {
    summary: (query.data as string | null | undefined) ?? null,
    loading: !!contactId && hasTranscript && query.isLoading,
    error: !url
      ? "Endpoint generateCallSummary no configurado"
      : query.error instanceof Error
      ? query.error.message
      : query.error
      ? "Error generando resumen"
      : null,
  };
}
