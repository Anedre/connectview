export interface QueueMetrics {
  queueId: string;
  queueName: string;
  contactsInQueue: number;
  oldestContactAge: number;
  agentsAvailable: number;
  agentsOnline: number;
  agentsOnCall: number;
  agentsACW: number;
  // Today's aggregated figures (GetMetricDataV2). Optional: absent on older
  // backend versions / when the daily call has no data for this queue.
  handledToday?: number;
  abandonedToday?: number;
  queuedToday?: number;
  serviceLevelToday?: number | null;
  abandonRateToday?: number;
  avgHandleTimeToday?: number;
}

export interface AgentStatus {
  agentId: string;
  username: string;
  status: string;
  statusStartTimestamp: string;
  activeContacts: Record<string, number>;
  availableSlots: Record<string, number>;
}

export interface RealtimeMetrics {
  timestamp: string;
  summary: {
    totalContactsInQueue: number;
    totalAgentsAvailable: number;
    totalAgentsOnline: number;
    longestWaitSeconds: number;
    // Today's aggregated KPIs (GetMetricDataV2). Optional for backward compat.
    today?: {
      handled: number;
      abandoned: number;
      queued: number;
      abandonRate: number;
      serviceLevel: number | null;
      avgHandleTime: number;
      avgAcw: number;
    };
  };
  queues: QueueMetrics[];
  agents: AgentStatus[];
}

export interface ContactRecord {
  contactId: string;
  initiationTimestamp: string;
  disconnectTimestamp?: string;
  agentUsername: string;
  queueName: string;
  channel: string;
  duration?: number;
  sentiment?: string;
  sentimentScore?: Record<string, string>;
  categories?: string[];
  disconnectReason?: string;
  status: string;
}

export interface ContactFilters {
  startDate: string;
  endDate: string;
  agentUsername?: string;
  queueName?: string;
  sentiment?: string;
}
