import { useMemo } from "react";
import type {
  LiveAgent,
  LiveQueueData,
  QueuedContact,
} from "@/hooks/useLiveQueue";

/**
 * A row in the pipeline view. It's either a real queued/finished contact
 * (from the live queue API) or a synthetic "WITH_AGENT" contact that we
 * derive from an agent's active contact so it shows up in the same grid.
 */
export interface PipelineContact extends QueuedContact {
  /** If WITH_AGENT, the agent holding the call. */
  agentUserId?: string | null;
  agentUsername?: string | null;
}

export type PipelineStageId =
  | "ARRIVED"
  | "IN_IVR"
  | "IN_QUEUE"
  | "WITH_AGENT"
  | "FINISHED";

export interface PipelineStageView {
  id: PipelineStageId;
  label: string;
  /** Short subtitle rendered under the stage label. */
  hint: string;
  contacts: PipelineContact[];
  /** Average seconds contacts have spent in this stage (for the header). */
  avgSeconds: number;
  /** Max seconds any single contact in this stage has been there. */
  maxSeconds: number;
}

export interface PipelineFilter {
  queueId?: string | null;
  channel?: string | null;
  campaignId?: string | null;
  /** Search by phone or customerName. */
  query?: string;
  /** Hide FINISHED stage. */
  hideFinished?: boolean;
  /** Hide IN_IVR stage (useful for instances that don't use IVR). */
  hideIvr?: boolean;
}

function makeAgentContact(a: LiveAgent): PipelineContact | null {
  if (!a.activeContact) return null;
  const ac = a.activeContact;
  const connectedMs = ac.connectedToAgentTimestamp
    ? new Date(ac.connectedToAgentTimestamp).getTime()
    : Date.now();
  return {
    contactId: ac.contactId,
    phone: ac.phone,
    customerName: null,
    channel: ac.channel,
    queueId: null,
    queueName: ac.queueName,
    initiationMethod: "",
    initiationTimestamp: null,
    state: "WITH_AGENT",
    stageEnteredAt: new Date(connectedMs).toISOString(),
    waitingSeconds: Math.max(
      0,
      Math.round((Date.now() - connectedMs) / 1000)
    ),
    sortKey: ac.contactId,
    agentUserId: a.userId,
    agentUsername: a.username,
  };
}

function channelMatches(c: PipelineContact, filter: string | null | undefined) {
  if (!filter || filter === "ALL") return true;
  return c.channel === filter;
}

function queueMatches(c: PipelineContact, filter: string | null | undefined) {
  if (!filter || filter === "ALL") return true;
  // We only filter contacts that have a queue or went through one.
  return c.queueId === filter;
}

function queryMatches(c: PipelineContact, q: string | undefined) {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    (c.phone || "").toLowerCase().includes(needle) ||
    (c.customerName || "").toLowerCase().includes(needle) ||
    (c.queueName || "").toLowerCase().includes(needle) ||
    (c.agentUsername || "").toLowerCase().includes(needle)
  );
}

function secondsIn(c: PipelineContact): number {
  if (c.stageEnteredAt) {
    return Math.max(
      0,
      Math.round((Date.now() - new Date(c.stageEnteredAt).getTime()) / 1000)
    );
  }
  return c.waitingSeconds;
}

export function usePipelineStages(
  data: LiveQueueData | null,
  filter: PipelineFilter,
  contactToCampaign?: Map<
    string,
    { campaignId: string; campaignName: string }
  >
): PipelineStageView[] {
  return useMemo(() => {
    if (!data) return [];

    // Build each stage from the relevant source data.
    const arrived = (data.arrived || []).map((c) => ({ ...c })) as PipelineContact[];
    const inIvr = (data.inIvr || []).map((c) => ({ ...c })) as PipelineContact[];
    const inQueue = data.inQueue.map((c) => ({ ...c })) as PipelineContact[];
    const withAgent = data.agents
      .map(makeAgentContact)
      .filter((c): c is PipelineContact => !!c);
    const finished = (data.finished || []).map((c) => ({
      ...c,
    })) as PipelineContact[];

    const applyFilters = (list: PipelineContact[]): PipelineContact[] => {
      return list.filter((c) => {
        if (!channelMatches(c, filter.channel)) return false;
        if (!queueMatches(c, filter.queueId)) return false;
        if (!queryMatches(c, filter.query)) return false;
        if (filter.campaignId) {
          // Prefer the campaignId stamped directly on the contact (from
          // Connect's Contact.Attributes.campaignId) — it covers contacts
          // that haven't been mirrored to getCampaignStats yet (early
          // ARRIVED/IVR/IN_QUEUE stages). Fall back to the map for older
          // contacts whose attributes have expired.
          const direct = c.campaignId;
          if (direct) {
            if (direct !== filter.campaignId) return false;
          } else {
            const meta = contactToCampaign?.get(c.contactId);
            if (!meta || meta.campaignId !== filter.campaignId) return false;
          }
        }
        return true;
      });
    };

    const sortFn = (a: PipelineContact, b: PipelineContact) => {
      // Stable sort by the immutable stage-entry timestamp so bubbles do not
      // swap places between polls when their "seconds in stage" values tie
      // or the relative ordering flips due to float rounding. Oldest-first
      // means the longest-waiting bubble stays at the top of the stage.
      const ta = a.stageEnteredAt
        ? new Date(a.stageEnteredAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      const tb = b.stageEnteredAt
        ? new Date(b.stageEnteredAt).getTime()
        : Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      // Tiebreaker: contactId to stay deterministic across polls.
      return a.contactId.localeCompare(b.contactId);
    };

    const stages: PipelineStageView[] = [
      {
        id: "ARRIVED",
        label: "Llegada",
        hint: "Contacto recién iniciado",
        contacts: applyFilters(arrived).sort(sortFn),
        avgSeconds: 0,
        maxSeconds: 0,
      },
      {
        id: "IN_IVR",
        label: "En IVR / Flow",
        hint: "Ejecutando el contact flow",
        contacts: applyFilters(inIvr).sort(sortFn),
        avgSeconds: 0,
        maxSeconds: 0,
      },
      {
        id: "IN_QUEUE",
        label: "En cola",
        hint: "Esperando un agente",
        contacts: applyFilters(inQueue).sort(sortFn),
        avgSeconds: 0,
        maxSeconds: 0,
      },
      {
        id: "WITH_AGENT",
        label: "Con agente",
        hint: "Conversación en curso",
        contacts: applyFilters(withAgent).sort(sortFn),
        avgSeconds: 0,
        maxSeconds: 0,
      },
      {
        id: "FINISHED",
        label: "Finalizado",
        hint: "Desconectado hace poco",
        contacts: applyFilters(finished).sort(sortFn),
        avgSeconds: 0,
        maxSeconds: 0,
      },
    ];

    // Compute avg/max per stage.
    for (const s of stages) {
      if (s.contacts.length === 0) continue;
      let total = 0;
      let max = 0;
      for (const c of s.contacts) {
        const sec = secondsIn(c);
        total += sec;
        if (sec > max) max = sec;
      }
      s.avgSeconds = Math.round(total / s.contacts.length);
      s.maxSeconds = max;
    }

    // Apply hide-* flags.
    return stages.filter((s) => {
      if (filter.hideFinished && s.id === "FINISHED") return false;
      if (filter.hideIvr && s.id === "IN_IVR") return false;
      return true;
    });
  }, [data, filter, contactToCampaign]);
}
