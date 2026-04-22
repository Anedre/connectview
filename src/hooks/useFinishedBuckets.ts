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
    color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    ring: "ring-emerald-300/60",
  },
  NO_ANSWER: {
    id: "NO_ANSWER",
    label: "No contestadas",
    hint: "Voicemail o sin respuesta",
    color: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    ring: "ring-amber-300/60",
  },
  ERROR: {
    id: "ERROR",
    label: "Errores",
    hint: "Fallo técnico / carrier",
    color: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
    ring: "ring-rose-300/60",
  },
  ABANDONED: {
    id: "ABANDONED",
    label: "Abandonadas",
    hint: "El cliente colgó antes",
    color: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
    ring: "ring-violet-300/60",
  },
  REQUEUED: {
    id: "REQUEUED",
    label: "Reencoladas",
    hint: "Se reintentará automáticamente",
    color: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
    ring: "ring-sky-300/60",
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
