import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

export interface QueueSummary {
  id: string;
  name: string;
  type: string;
  arn: string;
}

export function useQueues() {
  const [queues, setQueues] = useState<QueueSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.listQueues) return;
    setLoading(true);
    setError(null);
    authedFetch(endpoints.listQueues)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => setQueues(j.queues || []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { queues, loading, error, refetch };
}
