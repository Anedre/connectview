import { useEffect, useRef, useState } from "react";
import type { RealtimeMetrics } from "@/types/monitoring";

/**
 * useQueueInsights — derives SLA health + proactive alerts + per-queue trend
 * from the live realtime-metrics snapshots, WITHOUT any new backend data.
 *
 * The metrics endpoint only returns the CURRENT snapshot, so we keep a small
 * in-memory ring buffer of recent samples (per queue) to detect trends
 * ("queue rising", "wait crossed target"). Same pattern as the agent
 * dashboard's useMetricsHistory. Nothing is invented: every number traces to
 * a real snapshot field (contactsInQueue, oldestContactAge, agentsAvailable).
 */

/** Wait-time SLA target in seconds (a queue is "in SLA" if its oldest
 *  contact has waited less than this). 30s is the contact-center default. */
export const WAIT_SLA_SECONDS = 30;
/** Above this wait, a queue is critical. */
const WAIT_CRITICAL_SECONDS = 120;
const HISTORY_CAP = 20;

export type QueueAlertSeverity = "crit" | "warn" | "info";
export interface QueueAlert {
  id: string;
  severity: QueueAlertSeverity;
  kicker: string;
  title: string;
  sub: string;
}

export interface QueueInsights {
  /** % of active queues currently within the wait SLA (0–100). */
  slaPct: number;
  /** queues counted for the SLA figure. */
  slaQueues: number;
  /** per-queue recent contactsInQueue series (oldest→newest) for sparklines. */
  trendByQueue: Map<string, number[]>;
  /** proactive, actionable alerts derived from the snapshot + trend. */
  alerts: QueueAlert[];
}

const EMPTY: QueueInsights = { slaPct: 100, slaQueues: 0, trendByQueue: new Map(), alerts: [] };

/** Pure derivation from the current snapshot + the accumulated history. */
function derive(metrics: RealtimeMetrics, hist: Map<string, number[]>): QueueInsights {
  const queues = metrics.queues;
  const active = queues.filter((q) => q.agentsOnline > 0 || q.contactsInQueue > 0);
  const inSla = active.filter((q) => (q.oldestContactAge ?? 0) <= WAIT_SLA_SECONDS).length;
  const slaPct = active.length > 0 ? Math.round((inSla / active.length) * 100) : 100;

  const trendByQueue = new Map<string, number[]>();
  for (const q of queues) trendByQueue.set(q.queueId, [...(hist.get(q.queueId) ?? [])]);

  const alerts: QueueAlert[] = [];

  const critWait = queues
    .filter((q) => (q.oldestContactAge ?? 0) > WAIT_CRITICAL_SECONDS)
    .sort((a, b) => (b.oldestContactAge ?? 0) - (a.oldestContactAge ?? 0))[0];
  if (critWait) {
    const m = Math.floor((critWait.oldestContactAge ?? 0) / 60);
    const s = (critWait.oldestContactAge ?? 0) % 60;
    alerts.push({
      id: `wait-${critWait.queueId}`, severity: "crit", kicker: "SLA en riesgo",
      title: `${critWait.queueName} · espera ${m}:${String(s).padStart(2, "0")}`,
      sub: `${critWait.contactsInQueue} en cola y ${critWait.agentsAvailable} ${critWait.agentsAvailable === 1 ? "agente libre" : "agentes libres"}.`,
    });
  }

  const noCover = queues.find((q) => q.contactsInQueue > 0 && q.agentsAvailable === 0);
  if (noCover && noCover.queueId !== critWait?.queueId) {
    alerts.push({
      id: `cover-${noCover.queueId}`, severity: "crit", kicker: "Sin cobertura",
      title: `${noCover.queueName} sin agentes libres`,
      sub: `${noCover.contactsInQueue} ${noCover.contactsInQueue === 1 ? "contacto espera" : "contactos esperan"} y nadie disponible.`,
    });
  }

  for (const q of queues) {
    const arr = hist.get(q.queueId) ?? [];
    if (arr.length >= 3) {
      const prev = arr[Math.max(0, arr.length - 4)];
      const now = arr[arr.length - 1];
      if (now - prev >= 3 && now > 5 && alerts.length < 4) {
        alerts.push({
          id: `rise-${q.queueId}`, severity: "warn", kicker: "Cola subiendo",
          title: `${q.queueName} +${now - prev} en cola`,
          sub: `Pasó de ${prev} a ${now} contactos en los últimos minutos.`,
        });
      }
    }
  }

  return { slaPct, slaQueues: active.length, trendByQueue, alerts: alerts.slice(0, 4) };
}

export function useQueueInsights(metrics: RealtimeMetrics | null): QueueInsights {
  // ring buffer of per-queue contactsInQueue, keyed by queueId (effect-only)
  const histRef = useRef<Map<string, number[]>>(new Map());
  const [insights, setInsights] = useState<QueueInsights>(EMPTY);
  const stamp = metrics?.timestamp;

  useEffect(() => {
    if (!metrics) return;
    const hist = histRef.current;
    const seen = new Set<string>();
    for (const q of metrics.queues) {
      seen.add(q.queueId);
      const arr = hist.get(q.queueId) ?? [];
      arr.push(q.contactsInQueue);
      if (arr.length > HISTORY_CAP) arr.shift();
      hist.set(q.queueId, arr);
    }
    for (const k of [...hist.keys()]) if (!seen.has(k)) hist.delete(k);
    // Derive here (in the effect) — reading the ref outside render is fine.
    setInsights(derive(metrics, hist));
  }, [stamp, metrics]);

  return insights;
}
