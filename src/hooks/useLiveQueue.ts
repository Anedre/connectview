import { useEffect, useState, useCallback } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface LiveAgent {
  userId: string;
  username: string;
  statusName: string | null;
  statusStartTimestamp: string | null;
  routingProfile: string | null;
  routingProfileId?: string | null;
  /** Queues from this agent's routing profile (dedup'd across channels). */
  queues?: { id: string; name: string }[];
  activeContact: {
    contactId: string;
    phone: string | null;
    state: string;
    channel: string;
    queueName: string | null;
    connectedToAgentTimestamp: string | null;
  } | null;
  stats?: {
    queuedForMe: number;
    completedToday: number;
    errorsToday: number;
  };
}

export type PipelineStage =
  | "ARRIVED"
  | "IN_IVR"
  | "IN_QUEUE"
  | "WITH_AGENT"
  | "FINISHED"
  | "CONNECTING"
  | "INCOMING"
  | "PENDING_TRANSFER";

export interface QueuedContact {
  contactId: string;
  phone: string | null;
  customerName?: string | null;
  channel: string;
  queueId: string | null;
  queueName: string | null;
  initiationMethod: string;
  initiationTimestamp: string | null;
  state: PipelineStage;
  /** Timestamp the contact entered the current stage (ISO string). */
  stageEnteredAt?: string | null;
  waitingSeconds: number;
  disconnectReason?: string | null;
  agentUsername?: string | null;
  /** Stable key for deduping/animation; unchanged as a contact moves stages. */
  sortKey?: string;
  /** If this is a campaign contact, the row-level identifier stays stable
   *  across retry attempts so the pipeline UI can keep the same bubble
   *  identity when a call is re-queued. */
  campaignRowId?: string | null;
  /** How many dial attempts this campaign row has had. If >1 the bubble
   *  is a retry and should visually indicate it. */
  retryCount?: number | null;
  /** For retry/finished contacts that belong to a campaign. */
  campaignId?: string | null;
  /** When a campaign uses the per-agent bucket dialing strategy, pending and
   *  dialing rows are pre-assigned to one specific agent. The FlowView uses
   *  this to render the contact under that agent's column instead of the
   *  global "Pendientes" block. */
  assignedAgentUserId?: string | null;
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
  // New pipeline fields:
  arrived?: QueuedContact[];
  inIvr?: QueuedContact[];
  finished?: QueuedContact[];
  /** Campaign rows pending a retry (scheduled re-dial). */
  retryScheduled?: QueuedContact[];
  // Kept for compatibility:
  preQueue: QueuedContact[];
  inQueue: QueuedContact[];
  pendingTransfer: QueuedContact[];
  queues: QueueMeta[];
  statuses: AgentStatus[];
  generatedAt: string;
}

export function useLiveQueue(refreshMs = 3000, paused = false) {
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

  // Initial load — runs once, independent of the interval.
  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Polling interval — paused during drag so the UI doesn't flicker when
  // a bubble the user is dragging gets re-rendered from a stale snapshot.
  useEffect(() => {
    if (paused || refreshMs <= 0) return;
    const id = setInterval(refresh, refreshMs);
    return () => clearInterval(id);
  }, [refresh, refreshMs, paused]);

  return { data, loading, error, refresh };
}
