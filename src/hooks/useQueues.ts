import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

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

  useEffect(() => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.listQueues) return;
    setLoading(true);
    fetch(endpoints.listQueues)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => setQueues(j.queues || []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  return { queues, loading, error };
}
