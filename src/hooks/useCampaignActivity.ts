import { useEffect, useMemo, useRef, useState } from "react";
import type { CampaignContactRow } from "./useCampaignContacts";
import { useCampaignContacts } from "./useCampaignContacts";
import type { CampaignStatsData } from "./useCampaignStats";

/**
 * One discrete event in the campaign timeline. Emitted whenever a contact
 * transitions to a new status, so the live feed can animate a new card in
 * from the top while the rest of the cards shift down.
 */
export interface CampaignActivityEvent {
  /** Unique per-event id so the feed can keyframe properly. */
  eventId: string;
  rowId: string;
  contactId?: string;
  phone: string;
  customerName: string;
  agentUsername?: string;
  /** New status after this transition. */
  status: CampaignContactRow["status"];
  /** Previous status (undefined for the very first event we see for a row). */
  prevStatus?: CampaignContactRow["status"];
  /** When the transition was detected (client time). */
  at: number;
  /** Retry attempt count at the moment of the event. */
  attempts: number;
  disconnectReason?: string;
  lastError?: string;
}

/**
 * The full per-row journey: list of (status, timestamp) pairs in chronological
 * order. We don't have a server-side audit log of per-contact transitions, so
 * the journey is reconstructed client-side as we observe `useCampaignContacts`
 * snapshots. It survives across renders thanks to the `journeyRef` ref but
 * resets when the campaignId changes.
 */
export interface ContactJourney {
  rowId: string;
  phone: string;
  customerName: string;
  agentUsername?: string;
  steps: Array<{
    status: CampaignContactRow["status"];
    at: number;
    /** True for the very first observation, where we don't know the actual
     *  transition time (it happened before we started watching). */
    inferred?: boolean;
  }>;
  /** Current attempt count. */
  attempts: number;
  /** Latest known status. */
  status: CampaignContactRow["status"];
}

export interface CampaignActivityKpis {
  /** Total contacts in the campaign (from stats or contacts length). */
  total: number;
  /** Contacts in pending state. */
  pending: number;
  /** Contacts currently dialing or connected. */
  live: number;
  /** Contacts that finished (done + no_answer + failed). */
  completed: number;
  /** Successful contact (done) percentage over completed. */
  successRate: number;
  /** Effective contact rate: done / (done + no_answer + failed) — same as
   *  successRate but expressed as 0..1 instead of percent for charts. */
  contactRate: number;
  /** Calls per minute (rolling 10-min window — see implementation). */
  callsPerMinute: number;
  /** Average call duration in seconds across rows where we observed both
   *  `dialing` and a terminal status. */
  avgCallSeconds: number;
  /** ETA in seconds based on remaining pending and current calls/minute. */
  etaSeconds: number | null;
  /** ETA expressed as a human label. */
  etaLabel: string;
}

interface UseCampaignActivityOptions {
  /** Polling cadence for the underlying contacts endpoint. */
  refreshMs?: number;
  /** Max number of events to keep in the feed (older ones are dropped). */
  maxEvents?: number;
  /** When true, the very first snapshot doesn't emit synthetic events. This
   *  is the default — we only emit events for transitions we actually saw
   *  happen, otherwise the feed would explode with ghosts on every page load. */
  emitInitialSnapshot?: boolean;
}

/**
 * Watches a campaign's contacts and produces:
 *  - `events`: chronological feed of transitions, newest first
 *  - `journeys`: per-row journey reconstruction
 *  - `kpis`: derived metrics (success rate, calls/min, ETA, etc.)
 *
 * The feed is the data source for the animated live-feed panel; the journeys
 * power the mini-timeline shown on each card; the KPIs drive the progress
 * panel above the flow.
 */
export function useCampaignActivity(
  campaignId: string | null,
  campaignStats: CampaignStatsData | null,
  options: UseCampaignActivityOptions = {}
) {
  const {
    refreshMs = 3000,
    maxEvents = 60,
    emitInitialSnapshot = false,
  } = options;

  const { contacts, refresh } = useCampaignContacts(
    campaignId,
    null,
    refreshMs
  );

  /** Last-seen status per rowId — used to diff snapshots. */
  const prevStatusRef = useRef<Map<string, CampaignContactRow["status"]>>(
    new Map()
  );
  /** Per-row journey accumulated over the lifetime of this hook. */
  const journeyRef = useRef<Map<string, ContactJourney>>(new Map());
  /** Sliding window of recent terminal events for the calls/min calculation. */
  const recentCompletionsRef = useRef<number[]>([]);
  /** Sliding window of (dialing-start, terminal-time) pairs for avg call. */
  const callDurationsRef = useRef<number[]>([]);

  const [events, setEvents] = useState<CampaignActivityEvent[]>([]);
  /** Bumped whenever the journeys map mutates so consumers re-render. */
  const [journeyVersion, setJourneyVersion] = useState(0);
  /** First snapshot flag — used to suppress initial ghost events. */
  const firstSnapshotRef = useRef(true);

  // Reset state when campaign changes — otherwise we'd carry over journeys.
  useEffect(() => {
    prevStatusRef.current = new Map();
    journeyRef.current = new Map();
    recentCompletionsRef.current = [];
    callDurationsRef.current = [];
    firstSnapshotRef.current = true;
    setEvents([]);
    setJourneyVersion((v) => v + 1);
  }, [campaignId]);

  // Diff every new snapshot.
  useEffect(() => {
    if (!contacts) return;
    const prev = prevStatusRef.current;
    const isFirst = firstSnapshotRef.current;
    const newEvents: CampaignActivityEvent[] = [];
    const now = Date.now();

    for (const c of contacts) {
      const prevStatus = prev.get(c.rowId);
      const changed = prevStatus !== c.status;

      // Always make sure the journey map has an entry for this row.
      let journey = journeyRef.current.get(c.rowId);
      if (!journey) {
        journey = {
          rowId: c.rowId,
          phone: c.phone,
          customerName: c.customerName,
          agentUsername: c.agentUsername,
          steps: [],
          attempts: c.attempts,
          status: c.status,
        };
        journeyRef.current.set(c.rowId, journey);
      }
      // Refresh derived fields that change over time.
      journey.phone = c.phone;
      journey.customerName = c.customerName;
      journey.agentUsername = c.agentUsername || journey.agentUsername;
      journey.attempts = c.attempts;
      journey.status = c.status;

      if (changed) {
        // Anchor the step time on `lastAttemptAt` if available — it's more
        // accurate than client time, especially on the first snapshot.
        const stepAt = c.lastAttemptAt
          ? new Date(c.lastAttemptAt).getTime()
          : now;

        if (isFirst) {
          // For the initial snapshot we record the current state but mark it
          // as inferred so the timeline UI can show a "?" hint instead of a
          // precise transition.
          if (journey.steps.length === 0) {
            journey.steps.push({
              status: c.status,
              at: stepAt,
              inferred: true,
            });
          }
        } else {
          journey.steps.push({ status: c.status, at: stepAt });
        }

        if (!isFirst || emitInitialSnapshot) {
          newEvents.push({
            eventId: `${c.rowId}-${c.status}-${stepAt}`,
            rowId: c.rowId,
            contactId: c.connectContactId,
            phone: c.phone,
            customerName: c.customerName,
            agentUsername: c.agentUsername,
            status: c.status,
            prevStatus,
            at: now,
            attempts: c.attempts,
            disconnectReason: c.disconnectReason,
            lastError: c.lastError,
          });

          // Track completions for calls/min.
          if (
            c.status === "done" ||
            c.status === "no_answer" ||
            c.status === "failed"
          ) {
            recentCompletionsRef.current.push(now);
            // Compute call duration if we saw it dial earlier.
            const dialStep = journey.steps.find((s) => s.status === "dialing");
            if (dialStep && !dialStep.inferred) {
              const dur = Math.max(0, Math.round((stepAt - dialStep.at) / 1000));
              if (dur > 0 && dur < 3600) {
                callDurationsRef.current.push(dur);
                if (callDurationsRef.current.length > 50) {
                  callDurationsRef.current.shift();
                }
              }
            }
          }
        }
      }

      prev.set(c.rowId, c.status);
    }

    firstSnapshotRef.current = false;

    if (newEvents.length > 0) {
      setEvents((current) => {
        const merged = [...newEvents.reverse(), ...current];
        return merged.slice(0, maxEvents);
      });
      setJourneyVersion((v) => v + 1);
    } else if (isFirst) {
      // Even when no events emit on first snapshot, bump the version so the
      // journey map (which now has every row's starting state) is visible.
      setJourneyVersion((v) => v + 1);
    }

    // Prune calls/min window — keep only events from the last 10 minutes.
    const cutoff = now - 10 * 60 * 1000;
    recentCompletionsRef.current = recentCompletionsRef.current.filter(
      (t) => t >= cutoff
    );
  }, [contacts, emitInitialSnapshot, maxEvents]);

  // Build the journey snapshot for consumers.
  const journeys = useMemo(() => {
    // journeyVersion is used as a dependency so React re-derives this list
    // when the underlying map mutates. We intentionally don't include the
    // map reference itself.
    void journeyVersion;
    return Array.from(journeyRef.current.values());
  }, [journeyVersion]);

  // KPIs derived from contacts + campaignStats counts.
  const kpis = useMemo<CampaignActivityKpis>(() => {
    const counts = campaignStats?.counts || {
      pending: 0,
      dialing: 0,
      connected: 0,
      done: 0,
      no_answer: 0,
      failed: 0,
    };
    const totalFromStats = campaignStats?.campaign.totalContacts || 0;
    const total = totalFromStats || contacts.length;

    const pending = counts.pending;
    const live = counts.dialing + counts.connected;
    const completed = counts.done + counts.no_answer + counts.failed;
    const closedTerminal = counts.done + counts.no_answer + counts.failed;
    const successRate =
      closedTerminal > 0 ? Math.round((counts.done / closedTerminal) * 100) : 0;
    const contactRate = closedTerminal > 0 ? counts.done / closedTerminal : 0;

    // Calls/min — based on the rolling 10-min window. If we have fewer than
    // 60s of observations we extrapolate from what we have (clamped).
    const windowMs = 10 * 60 * 1000;
    const recentCount = recentCompletionsRef.current.length;
    const oldestEvent =
      recentCompletionsRef.current.length > 0
        ? recentCompletionsRef.current[0]
        : Date.now();
    const observedMs = Math.max(60_000, Math.min(windowMs, Date.now() - oldestEvent));
    const callsPerMinute =
      recentCount > 0
        ? Math.round(((recentCount / observedMs) * 60_000) * 10) / 10
        : 0;

    // Avg call duration — median is more stable than mean.
    let avgCallSeconds = 0;
    if (callDurationsRef.current.length > 0) {
      const sorted = [...callDurationsRef.current].sort((a, b) => a - b);
      avgCallSeconds = sorted[Math.floor(sorted.length / 2)];
    }

    // ETA — pending / calls per minute. If calls/min is 0 we return null so
    // the UI can show "—" instead of "Infinity".
    let etaSeconds: number | null = null;
    let etaLabel = "—";
    if (callsPerMinute > 0 && pending > 0) {
      const minutes = pending / callsPerMinute;
      etaSeconds = Math.round(minutes * 60);
      if (minutes < 1) etaLabel = "< 1 min";
      else if (minutes < 60) etaLabel = `~${Math.round(minutes)} min`;
      else {
        const h = Math.floor(minutes / 60);
        const m = Math.round(minutes % 60);
        etaLabel = `~${h}h ${m}m`;
      }
    } else if (pending === 0 && total > 0) {
      etaLabel = "Completada";
    }

    return {
      total,
      pending,
      live,
      completed,
      successRate,
      contactRate,
      callsPerMinute,
      avgCallSeconds,
      etaSeconds,
      etaLabel,
    };
  }, [campaignStats, contacts.length]);

  return {
    events,
    journeys,
    kpis,
    contacts,
    refresh,
  };
}
