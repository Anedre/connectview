import { useEffect, useRef, useState } from "react";
import type { LiveQueueData, QueuedContact } from "./useLiveQueue";

/**
 * Represents a single "tick" we kept track of: for each poll of the live
 * queue we record the size of each stage at that moment. The UI uses this
 * to draw a 15-minute sparkline.
 */
export interface TimelineTick {
  t: number; // epoch ms
  arrived: number;
  inIvr: number;
  inQueue: number;
  withAgent: number;
  finished: number;
}

export interface TimelineContactEvent {
  contactId: string;
  /** Stable identity — same across retry attempts when available. */
  identityKey: string;
  phone: string | null;
  customerName: string | null;
  channel: string;
  /** When the event occurred (ISO). */
  at: string;
  /** What stage the contact entered. */
  stage:
    | "ARRIVED"
    | "IN_IVR"
    | "IN_QUEUE"
    | "WITH_AGENT"
    | "FINISHED"
    | "RETRY";
  retryCount?: number | null;
  queueName?: string | null;
  agentUsername?: string | null;
  disconnectReason?: string | null;
}

interface HistoryShape {
  ticks: TimelineTick[];
  events: TimelineContactEvent[];
}

const WINDOW_MS = 15 * 60 * 1000;

function idOf(c: QueuedContact): string {
  return c.campaignRowId || c.contactId;
}

export function usePipelineHistory(data: LiveQueueData | null): HistoryShape {
  const [state, setState] = useState<HistoryShape>({ ticks: [], events: [] });
  // Remember the last-known stage for each contact identity so we can detect
  // transitions (including retries: FINISHED → ARRIVED with higher retryCount).
  const lastStageRef = useRef<
    Map<string, { stage: string; retryCount: number }>
  >(new Map());
  const lastTickTsRef = useRef<number>(0);

  useEffect(() => {
    if (!data) return;
    const now = Date.now();

    // Throttle tick recording to once per ~2s so we don't make ticks too dense.
    if (now - lastTickTsRef.current < 2000) return;
    lastTickTsRef.current = now;

    // 1. Gather all active contacts & what stage they're in.
    const all: { c: QueuedContact; stage: TimelineContactEvent["stage"] }[] = [];
    for (const c of data.arrived || []) all.push({ c, stage: "ARRIVED" });
    for (const c of data.inIvr || []) all.push({ c, stage: "IN_IVR" });
    for (const c of data.inQueue || []) all.push({ c, stage: "IN_QUEUE" });
    for (const c of data.finished || []) all.push({ c, stage: "FINISHED" });
    // Agents' active contacts count as WITH_AGENT.
    for (const a of data.agents || []) {
      if (!a.activeContact) continue;
      all.push({
        c: {
          contactId: a.activeContact.contactId,
          phone: a.activeContact.phone,
          customerName: null,
          channel: a.activeContact.channel,
          queueId: null,
          queueName: a.activeContact.queueName,
          initiationMethod: "",
          initiationTimestamp: null,
          state: "WITH_AGENT",
          stageEnteredAt: a.activeContact.connectedToAgentTimestamp,
          waitingSeconds: 0,
          agentUsername: a.username,
        },
        stage: "WITH_AGENT",
      });
    }

    // 2. Detect transitions vs what we saw last time.
    const newEvents: TimelineContactEvent[] = [];
    for (const { c, stage } of all) {
      const key = idOf(c);
      const prev = lastStageRef.current.get(key);
      const retryCount = c.retryCount || 0;
      if (!prev) {
        // First time we see this contact.
        newEvents.push({
          contactId: c.contactId,
          identityKey: key,
          phone: c.phone,
          customerName: c.customerName || null,
          channel: c.channel,
          at: new Date(now).toISOString(),
          stage,
          retryCount,
          queueName: c.queueName,
          agentUsername: c.agentUsername || null,
          disconnectReason: c.disconnectReason || null,
        });
      } else if (prev.stage !== stage) {
        // Stage changed. If it went from FINISHED back to an earlier stage
        // *and* retryCount increased, record it as a RETRY — that's the
        // visual signal the admin wants: the bubble bouncing back.
        const isRetry =
          prev.stage === "FINISHED" &&
          (stage === "ARRIVED" || stage === "IN_IVR" || stage === "IN_QUEUE") &&
          retryCount > (prev.retryCount || 0);
        newEvents.push({
          contactId: c.contactId,
          identityKey: key,
          phone: c.phone,
          customerName: c.customerName || null,
          channel: c.channel,
          at: new Date(now).toISOString(),
          stage: isRetry ? "RETRY" : stage,
          retryCount,
          queueName: c.queueName,
          agentUsername: c.agentUsername || null,
          disconnectReason: c.disconnectReason || null,
        });
      }
      lastStageRef.current.set(key, { stage, retryCount });
    }

    // 3. Drop identities we haven't seen in > WINDOW_MS (garbage-collect).
    //    We keep them around long enough for the timeline to draw their arc.
    if (lastStageRef.current.size > 200) {
      // arbitrary cap to avoid unbounded growth
      const toDelete: string[] = [];
      for (const key of lastStageRef.current.keys()) {
        if (!all.some(({ c }) => idOf(c) === key)) toDelete.push(key);
      }
      for (const k of toDelete) lastStageRef.current.delete(k);
    }

    // 4. Append a tick.
    const tick: TimelineTick = {
      t: now,
      arrived: (data.arrived || []).length,
      inIvr: (data.inIvr || []).length,
      inQueue: (data.inQueue || []).length,
      withAgent: (data.agents || []).filter((a) => a.activeContact).length,
      finished: (data.finished || []).length,
    };

    setState((prev) => {
      const cutoff = now - WINDOW_MS;
      return {
        ticks: [...prev.ticks.filter((t) => t.t >= cutoff), tick],
        events: [...prev.events.filter((e) => new Date(e.at).getTime() >= cutoff), ...newEvents],
      };
    });
  }, [data]);

  return state;
}
