import { useMemo } from "react";
import type { PipelineContact } from "./usePipelineStages";

export type FinishedBucketId =
  | "COMPLETED"
  | "NO_ANSWER"
  | "ERROR"
  | "ABANDONED"
  | "REQUEUED";

export interface FinishedBucket {
  id: FinishedBucketId;
  label: string;
  hint: string;
  color: string; // tailwind bg-* text-* pair
  ring: string; // ring-* color
  contacts: PipelineContact[];
}

/**
 * Classify a finished contact by its DisconnectReason.
 *
 * Amazon Connect emits a fixed set of DisconnectReasons; we bucket them
 * so the admin sees what actually happened at a glance.
 */
function bucketOf(reason: string | null | undefined): FinishedBucketId {
  const r = (reason || "").toUpperCase();
  if (r === "REQUEUED") return "REQUEUED";
  // "No contestadas": the customer never picked up — this is exactly what
  // NO_USER_RESPONSE means in Connect, plus voicemail detections and flow
  // disconnects (commonly the AMD flow hangs up on voicemail).
  if (
    r === "NO_USER_RESPONSE" ||
    r === "VOICEMAIL_BEEP" ||
    r === "VOICEMAIL_NO_BEEP" ||
    r === "CONTACT_FLOW_DISCONNECT" ||
    r === "AGENT_MISSED" ||
    r === "MISSED"
  )
    return "NO_ANSWER";
  // "Abandonadas": customer answered then hung up before being routed to an
  // agent / gave up while in queue.
  if (r === "CUSTOMER_DISCONNECT_ABANDONED") return "ABANDONED";
  if (
    r.startsWith("OUTBOUND_") ||
    r === "TELECOM_PROBLEM" ||
    r === "CONTACT_FLOW_ERROR" ||
    r === "DISCONNECT_REASON_UNKNOWN"
  )
    return "ERROR";
  // Default: agent / customer / third-party disconnect after a normal call.
  return "COMPLETED";
}

const BUCKET_DEF: Record<
  FinishedBucketId,
  Omit<FinishedBucket, "contacts">
> = {
  COMPLETED: {
    id: "COMPLETED",
    label: "Completadas",
    hint: "Agente y cliente hablaron",
    color: "bg-[var(--accent-green-soft)] text-[var(--accent-green)]",
    ring: "ring-[var(--accent-green-soft)]",
  },
  NO_ANSWER: {
    id: "NO_ANSWER",
    label: "No contestadas",
    hint: "Voicemail o sin respuesta",
    color: "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)]",
    ring: "ring-[var(--accent-amber-soft)]",
  },
  ERROR: {
    id: "ERROR",
    label: "Errores",
    hint: "Fallo técnico / carrier",
    color: "bg-[var(--accent-red-soft)] text-[var(--accent-red)]",
    ring: "ring-[var(--accent-red-soft)]",
  },
  ABANDONED: {
    id: "ABANDONED",
    label: "Abandonadas",
    hint: "El cliente colgó antes",
    color: "bg-[var(--accent-violet-soft)] text-[var(--accent-violet)]",
    ring: "ring-[var(--accent-violet-soft)]",
  },
  REQUEUED: {
    id: "REQUEUED",
    label: "Reencoladas",
    hint: "Se reintentará automáticamente",
    color: "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)]",
    ring: "ring-[var(--accent-cyan-soft)]",
  },
};

export function useFinishedBuckets(
  finished: PipelineContact[],
  retryScheduled: PipelineContact[] = []
): FinishedBucket[] {
  return useMemo(() => {
    const buckets: Record<FinishedBucketId, PipelineContact[]> = {
      COMPLETED: [],
      NO_ANSWER: [],
      ERROR: [],
      ABANDONED: [],
      REQUEUED: [...retryScheduled],
    };

    for (const c of finished) {
      const bid = bucketOf(c.disconnectReason);
      buckets[bid].push(c);
    }

    // Stable order: Completadas · No contestadas · Errores · Abandonadas · Reencoladas
    return (
      ["COMPLETED", "NO_ANSWER", "ERROR", "ABANDONED", "REQUEUED"] as FinishedBucketId[]
    ).map((id) => ({
      ...BUCKET_DEF[id],
      contacts: buckets[id],
    }));
  }, [finished, retryScheduled]);
}
