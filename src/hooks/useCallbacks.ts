import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getApiEndpoints } from "@/lib/api";

/**
 * One scheduled callback row, as returned by the list-callbacks
 * Lambda. Mirrors the DynamoDB schema of `connectview-callbacks`.
 */
export interface CallbackRecord {
  callbackId: string;
  phone: string;
  customerName?: string;
  scheduledAt: string; // ISO
  status: "SCHEDULED" | "RINGING" | "COMPLETED" | "FAILED" | "CANCELLED";
  assignedAgentUserId?: string;
  notes?: string;
  campaignId?: string;
  contactFlowId?: string;
  sourcePhoneNumber?: string;
  attempts?: number;
  createdAt?: string;
  updatedAt?: string;
  lastError?: string;
  connectContactId?: string;
}

interface UseCallbacksOptions {
  /** Connect user-id whose callbacks we want. When omitted, defaults
   *  to the signed-in agent's userId. Supervisors / admins can pass
   *  a specific agentUserId to peek at their queue.
   *  Pass `null` to fetch ALL callbacks (admin view). */
  agentUserId?: string | null;
  /** Filter by status. Default: undefined (all statuses). */
  status?: CallbackRecord["status"];
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
   *  schedule modal submits a new callback. */
  refetch: () => void;
  /** Cancel a scheduled callback (status=SCHEDULED only). Returns the
   *  resolved cancel promise; the caller can await it before refetching. */
  cancel: (callbackId: string) => Promise<void>;
  /** `false` until the listCallbacks endpoint has been deployed. UI
   *  hides the drawer entirely when this is false. */
  available: boolean;
}

/**
 * Polls the list-callbacks Lambda for the current agent's scheduled
 * callbacks. Auto-refreshes every minute so the agent sees the
 * countdown shrink in (near) real time and rows disappear after the
 * dispatcher fires them.
 *
 * Falls back gracefully when the endpoint isn't deployed yet
 * (`available: false`) so the UI can hide the drawer rather than
 * showing an error.
 */
export function useCallbacks(
  options: UseCallbacksOptions = {}
): UseCallbacksReturn {
  const { agentUserId, status, limit = 50, pollIntervalSec = 60 } = options;
  const { user } = useAuth();
  const [callbacks, setCallbacks] = useState<CallbackRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const endpoints = getApiEndpoints();
  const listUrl = endpoints?.listCallbacks;
  const cancelUrl = endpoints?.cancelCallback;
  // When `agentUserId` is explicitly `null` → admin "all callbacks" view.
  // When omitted (undefined) → default to the signed-in agent.
  // When a string is passed → use that string.
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
    // The signed-in user might not be loaded yet — wait until we have a
    // userId (or the explicit `null` admin-mode signal) before fetching.
    if (effectiveUserId === undefined) return;

    let cancelled = false;
    const fetchOnce = async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (effectiveUserId) qs.set("agentUserId", effectiveUserId);
        if (status) qs.set("status", status);
        const res = await fetch(`${listUrl}?${qs.toString()}`);
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
  }, [listUrl, effectiveUserId, status, limit, pollIntervalSec, refreshTick]);

  const cancel = useCallback(
    async (callbackId: string) => {
      if (!cancelUrl) throw new Error("Endpoint cancelCallback no configurado");
      const r = await fetch(cancelUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callbackId,
          actor: user?.username || user?.userId || "unknown",
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data?.error || `HTTP ${r.status}`);
      }
    },
    [cancelUrl, user]
  );

  return { callbacks, loading, error, refetch, cancel, available };
}
