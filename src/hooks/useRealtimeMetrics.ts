import { useState, useEffect, useCallback, useRef } from "react";
import type { RealtimeMetrics } from "@/types/monitoring";
import { getApiEndpoints } from "@/lib/api";

const POLL_INTERVAL = 15000; // 15 seconds

export function useRealtimeMetrics() {
  const [metrics, setMetrics] = useState<RealtimeMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [usingLiveData, setUsingLiveData] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchMetrics = useCallback(async () => {
    try {
      const endpoints = getApiEndpoints();

      if (endpoints?.realtimeMetrics) {
        const response = await fetch(endpoints.realtimeMetrics);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        setMetrics(data);
        setUsingLiveData(true);
      } else {
        throw new Error("API not configured");
      }
      setError(null);
    } catch (err) {
      // No mock fallback - show the real error so user knows
      setError(
        err instanceof Error ? err.message : "Failed to fetch metrics"
      );
      // Set empty metrics structure so UI doesn't break
      if (!metrics) {
        setMetrics({
          timestamp: new Date().toISOString(),
          summary: {
            totalContactsInQueue: 0,
            totalAgentsAvailable: 0,
            totalAgentsOnline: 0,
            longestWaitSeconds: 0,
          },
          queues: [],
          agents: [],
        });
      }
      setUsingLiveData(false);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchMetrics();
    intervalRef.current = setInterval(fetchMetrics, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchMetrics]);

  return {
    metrics,
    loading,
    error,
    lastRefresh,
    usingLiveData,
    refresh: fetchMetrics,
  };
}
