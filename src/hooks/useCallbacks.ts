import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * One scheduled follow-up row, as returned by the list-callbacks
 * Lambda. Mirrors the DynamoDB schema of `connectview-callbacks`.
 *
 * The legacy name "callback" is kept for backward compat but the row
 * now represents any kind of follow-up: voice callback, email follow-
 * up, WhatsApp template follow-up.
 */
export interface CallbackRecord {
  callbackId: string;
  phone: string;
  customerName?: string;
  scheduledAt: string; // ISO
  /** SCHEDULED → in the future (voice & non-voice)
   *  DUE       → email/whatsapp that's past its scheduledAt and waiting
   *              for the agent to attend it manually
   *  RINGING   → voice callback currently being dispatched
   *  COMPLETED → voice fired OK, OR email/whatsapp attended by agent
   *  FAILED    → voice dispatch threw
   *  CANCELLED → soft-cancelled */
  status:
    | "SCHEDULED"
    | "DUE"
    | "RINGING"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED";
  assignedAgentUserId?: string;
  notes?: string;
  /** Default "voice" when missing (legacy rows). `task` is a generic
   *  reminder with no auto-dispatch — the agent just sees it as a to-do. */
  channel?: "voice" | "email" | "whatsapp" | "task";
  /** Free-text title / asunto — added for Citas. Optional; if missing,
   *  the UI derives a label from the channel + customer name. */
  title?: string;
  /** Visual duration in minutes for the calendar block. The actual
   *  dispatch is point-in-time; this is just for rendering. */
  durationMin?: number;
  actionType?: "auto-dispatch" | "manual-action";
  campaignId?: string;
  contactFlowId?: string;
  sourcePhoneNumber?: string;
  attempts?: number;
  createdAt?: string;
  updatedAt?: string;
  lastError?: string;
  connectContactId?: string;
  // Email-specific
  emailFromAddress?: string;
  emailToAddress?: string;
  emailSubject?: string;
  emailBody?: string;
  // WhatsApp-specific
  templateName?: string;
  templateLanguage?: string;
  /** JSON-stringified array — parse to use. */
  templateVariables?: string;
}

interface UseCallbacksOptions {
  /** Connect user-id whose follow-ups we want. When omitted, defaults
   *  to the signed-in agent's userId. Pass `null` to fetch ALL
   *  follow-ups (admin view). */
  agentUserId?: string | null;
  /** Filter by status. `"PENDING"` is sugar for SCHEDULED OR DUE
   *  (most useful for the drawer). */
  status?: CallbackRecord["status"] | "PENDING";
  /** Filter by channel. */
  channel?: "voice" | "email" | "whatsapp" | "task";
  /** Max rows returned. Default: 50, cap 200. */
  limit?: number;
  /** Auto-poll every N seconds. 0 = no auto-refresh. Default: 60. */
  pollIntervalSec?: number;
}

interface UseCallbacksReturn {
  callbacks: CallbackRecord[];
  loading: boolean;
  error: string | null;
  /** Manually re-fetch — useful after the agent cancels or after the
   *  schedule modal submits a new follow-up. */
  refetch: () => void;
  /** Cancel a follow-up (SCHEDULED or DUE). */
  cancel: (callbackId: string) => Promise<void>;
  /** Mark an email/whatsapp follow-up as completed (the agent
   *  attended it manually). Only valid for DUE rows. */
  complete: (callbackId: string) => Promise<void>;
  /** `false` until the listCallbacks endpoint has been deployed. UI
   *  hides the drawer entirely when this is false. */
  available: boolean;
}

export function useCallbacks(
  options: UseCallbacksOptions = {}
): UseCallbacksReturn {
  const {
    agentUserId,
    status,
    channel,
    limit = 50,
    pollIntervalSec = 60,
  } = options;
  const { user } = useAuth();
  const [callbacks, setCallbacks] = useState<CallbackRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const endpoints = getApiEndpoints();
  const listUrl = endpoints?.listCallbacks;
  const cancelUrl = endpoints?.cancelCallback;
  const effectiveUserId =
    agentUserId === null
      ? null
      : agentUserId !== undefined
      ? agentUserId
      : user?.userId;
  const available = !!listUrl;

  const refetch = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    if (!listUrl) return;
    if (effectiveUserId === undefined) return;

    let cancelled = false;
    const fetchOnce = async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (effectiveUserId) qs.set("agentUserId", effectiveUserId);
        if (status) qs.set("status", status);
        if (channel) qs.set("channel", channel);
        const res = await authedFetch(`${listUrl}?${qs.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setCallbacks(Array.isArray(data.items) ? data.items : []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchOnce();
    let timer: ReturnType<typeof setInterval> | undefined;
    if (pollIntervalSec > 0) {
      timer = setInterval(fetchOnce, pollIntervalSec * 1000);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [listUrl, effectiveUserId, status, channel, limit, pollIntervalSec, refreshTick]);

  const callMutation = useCallback(
    async (callbackId: string, action: "cancel" | "complete") => {
      if (!cancelUrl) throw new Error("Endpoint cancelCallback no configurado");
      const r = await authedFetch(cancelUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callbackId,
          actor: user?.username || user?.userId || "unknown",
          action,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data?.error || `HTTP ${r.status}`);
      }
    },
    [cancelUrl, user]
  );

  const cancel = useCallback(
    (callbackId: string) => callMutation(callbackId, "cancel"),
    [callMutation]
  );
  const complete = useCallback(
    (callbackId: string) => callMutation(callbackId, "complete"),
    [callMutation]
  );

  return { callbacks, loading, error, refetch, cancel, complete, available };
}
