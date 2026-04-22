import { useEffect, useState, useCallback } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface LiveAgent {
  userId: string;
  username: string;
  statusName: string | null;
  statusStartTimestamp: string | null;
  routingProfile: string | null;
  activeContact: {
    contactId: string;
    phone: string | null;
    state: string;
    channel: string;
    queueName: string | null;
    connectedToAgentTimestamp: string | null;
  } | null;
}

export interface QueuedContact {
  contactId: string;
  phone: string | null;
  channel: string;
  queueId: string | null;
  queueName: string | null;
  initiationMethod: string;
  initiationTimestamp: string | null;
  state: "IN_QUEUE" | "CONNECTING" | "INCOMING" | "PENDING_TRANSFER";
  waitingSeconds: number;
}

export interface QueueMeta {
  id: string;
  name: string;
}

export interface AgentStatus {
  id: string;
  name: string;
  type: string;
}

export interface LiveQueueData {
  agents: LiveAgent[];
  preQueue: QueuedContact[];
  inQueue: QueuedContact[];
  pendingTransfer: QueuedContact[];
  queues: QueueMeta[];
  statuses: AgentStatus[];
  generatedAt: string;
}

export function useLiveQueue(refreshMs = 3000) {
  const [data, setData] = useState<LiveQueueData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.getLiveQueue) return;
    try {
      const r = await fetch(endpoints.getLiveQueue);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as LiveQueueData;
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
    if (refreshMs > 0) {
      const id = setInterval(refresh, refreshMs);
      return () => clearInterval(id);
    }
  }, [refresh, refreshMs]);

  return { data, loading, error, refresh };
}
