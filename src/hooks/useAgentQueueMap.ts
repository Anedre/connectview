import { useMemo } from "react";
import type { LiveAgent, QueuedContact } from "./useLiveQueue";

export interface AgentQueueMap {
  /** userId → list of contacts waiting in that agent's Connect queues. */
  inQueueByAgent: Map<string, QueuedContact[]>;
  /** contactId → list of agent userIds that can take this contact. */
  eligibleAgentsByContact: Map<string, string[]>;
  /** userId → set of queueIds this agent's routing profile covers. */
  queuesByAgent: Map<string, Set<string>>;
  /** userId → list of contacts pre-assigned to that agent's bucket
   *  (status=pending in the campaign DB with assignedAgentUserId=userId).
   *  Always provided — empty array when nothing's bucketed yet. */
  pendingBucketByAgent: Map<string, QueuedContact[]>;
  /** Pending contacts that are NOT pre-assigned to any agent — the global
   *  pool the dialer pulls from when refilling buckets. */
  unassignedPending: QueuedContact[];
}

/**
 * Cross-reference agents' routing-profile queues with the in-queue contact
 * pool so the Queue Manager can render a per-agent "en cola" sub-lane.
 *
 * Additionally splits the per-campaign pending pool into per-agent buckets
 * (when the campaign uses the maxContactsPerAgent strategy) plus a
 * remaining "unassigned" pool. The bucket data feeds the per-agent column
 * in FlowView so the admin sees exactly which leads will go to which
 * agent in arrival order.
 *
 * A contact waiting in queueX will appear under every agent whose routing
 * profile includes queueX — exactly like the real Connect routing works.
 */
export function useAgentQueueMap(
  agents: LiveAgent[],
  inQueue: QueuedContact[],
  pending: QueuedContact[] = []
): AgentQueueMap {
  return useMemo(() => {
    const queuesByAgent = new Map<string, Set<string>>();
    for (const a of agents) {
      const s = new Set<string>();
      for (const q of a.queues || []) {
        if (q.id) s.add(q.id);
      }
      queuesByAgent.set(a.userId, s);
    }

    const inQueueByAgent = new Map<string, QueuedContact[]>();
    const eligibleAgentsByContact = new Map<string, string[]>();
    const pendingBucketByAgent = new Map<string, QueuedContact[]>();

    for (const a of agents) {
      inQueueByAgent.set(a.userId, []);
      pendingBucketByAgent.set(a.userId, []);
    }

    for (const c of inQueue) {
      if (!c.queueId) continue;
      const eligibleAgents: string[] = [];
      for (const a of agents) {
        const qs = queuesByAgent.get(a.userId);
        if (qs && qs.has(c.queueId)) {
          inQueueByAgent.get(a.userId)!.push(c);
          eligibleAgents.push(a.userId);
        }
      }
      eligibleAgentsByContact.set(c.contactId, eligibleAgents);
    }

    // Bucket pending contacts by their pre-assigned agent. Anything not
    // assigned to one of the rendered agents goes into the unassigned
    // pool — that includes both genuinely-unassigned rows and rows
    // assigned to an agent who is no longer in the campaign.
    const renderedAgentIds = new Set(agents.map((a) => a.userId));
    const unassignedPending: QueuedContact[] = [];
    for (const c of pending) {
      const uid = c.assignedAgentUserId;
      if (uid && renderedAgentIds.has(uid)) {
        pendingBucketByAgent.get(uid)!.push(c);
      } else {
        unassignedPending.push(c);
      }
    }
    // FIFO inside each bucket — oldest first.
    const byCreated = (a: QueuedContact, b: QueuedContact) =>
      (a.initiationTimestamp || a.stageEnteredAt || "").localeCompare(
        b.initiationTimestamp || b.stageEnteredAt || ""
      );
    for (const list of pendingBucketByAgent.values()) list.sort(byCreated);
    unassignedPending.sort(byCreated);

    return {
      inQueueByAgent,
      eligibleAgentsByContact,
      queuesByAgent,
      pendingBucketByAgent,
      unassignedPending,
    };
  }, [agents, inQueue, pending]);
}
