import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getApiEndpoints } from "@/lib/api";

/**
 * Historical missed-contact record returned by the Connect
 * `SearchContacts` API (via our list-missed-contacts Lambda).
 *
 * `ageSeconds` is computed Lambda-side so the UI can show
 * "hace 4 min" without parsing the ISO timestamp.
 */
export interface MissedContactRecord {
  contactId: string;
  channel: string;
  initiationTimestamp: string;
  disconnectTimestamp: string;
  customerEndpoint: string | null;
  queueName: string;
  initiationMethod?: string;
  disconnectReason?: string;
  ageSeconds: number;
}

interface UseMissedContactsHistoryOptions {
  /** Time window in hours. Default: 24. */
  hours?: number;
  /** Max rows returned. Default: 50, cap 100. */
  limit?: number;
  /** Auto-poll every N seconds. 0 = no auto-refresh. Default: 90. */
  pollIntervalSec?: number;
}

interface UseMissedContactsHistoryReturn {
  records: MissedContactRecord[];
  loading: boolean;
  error: string | null;
  /** Manually re-fetch. Useful after the agent dismisses a record so
   *  the list refreshes without waiting for the next poll. */
  refetch: () => void;
  /** "false" until the Lambda has been deployed. UI can hide the
   *  panel entirely when this is false. */
  available: boolean;
}

/**
 * Polls the list-missed-contacts Lambda for missed contacts the
 * current agent had within the last N hours. The Lambda hits
 * Connect's SearchContacts API which is the authoritative source.
 *
 * Falls back gracefully when the endpoint isn't deployed yet
 * (`available: false`) so the UI can hide the drawer rather than
 * showing an error.
 */
export function useMissedContactsHistory(
  options: UseMissedContactsHistoryOptions = {}
): UseMissedContactsHistoryReturn {
  const { hours = 24, limit = 50, pollIntervalSec = 90 } = options;
  const { user } = useAuth();
  const [records, setRecords] = useState<MissedContactRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const endpoints = getApiEndpoints();
  const url = endpoints?.listMissedContacts;
  const userId = user?.userId;
  const available = !!url;

  const refetch = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    if (!url || !userId) return;

    let cancelled = false;
    const fetchOnce = async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          userId,
          hours: String(hours),
          limit: String(limit),
        });
        const res = await fetch(`${url}?${qs.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setRecords(Array.isArray(data.contacts) ? data.contacts : []);
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
  }, [url, userId, hours, limit, pollIntervalSec, refreshTick]);

  return { records, loading, error, refetch, available };
}
