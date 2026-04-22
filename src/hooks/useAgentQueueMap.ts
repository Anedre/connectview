import { useMemo } from "react";
import type { LiveAgent, QueuedContact } from "./useLiveQueue";

export interface AgentQueueMap {
  /** userId → list of contacts waiting in that agent's queues. */
  inQueueByAgent: Map<string, QueuedContact[]>;
  /** contactId → list of agent userIds that can take this contact. */
  eligibleAgentsByContact: Map<string, string[]>;
  /** userId → set of queueIds this agent's routing profile covers. */
  queuesByAgent: Map<string, Set<string>>;
}

/**
 * Cross-reference agents' routing-profile queues with the in-queue contact
 * pool so the Queue Manager can render a per-agent "en cola" sub-lane.
 *
 * A contact waiting in queueX will appear under every agent whose routing
 * profile includes queueX — exactly like the real Connect routing works.
 */
export function useAgentQueueMap(
  agents: LiveAgent[],
  inQueue: QueuedContact[]
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

    for (const a of agents) {
      inQueueByAgent.set(a.userId, []);
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

    return { inQueueByAgent, eligibleAgentsByContact, queuesByAgent };
  }, [agents, inQueue]);
}
