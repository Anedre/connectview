import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface FlowQueue {
  queueId: string;
  queueName: string;
  source: "set-working-queue" | "transfer-to-queue" | "update-queue";
  actionId: string;
  isDynamic: boolean;
}

export interface FlowQueueAnalysis {
  contactFlowId: string;
  flowName: string;
  flowType: string;
  queues: FlowQueue[];
  literalQueues: FlowQueue[];
  dynamicQueues: FlowQueue[];
  primaryQueue: FlowQueue | null;
}

// Inspect a Connect contact flow and surface every queue it references.
// Called when the admin picks a flow in the wizard / edit dialog so we can
// auto-populate the campaign's target queue.
export function useFlowQueues(contactFlowId: string | null) {
  const [data, setData] = useState<FlowQueueAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contactFlowId) {
      setData(null);
      setError(null);
      return;
    }
    const endpoints = getApiEndpoints();
    if (!endpoints?.getFlowQueues) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `${endpoints.getFlowQueues}?contactFlowId=${encodeURIComponent(contactFlowId)}`
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: FlowQueueAnalysis) => {
        if (!cancelled) setData(j);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contactFlowId]);

  return { data, loading, error };
}
