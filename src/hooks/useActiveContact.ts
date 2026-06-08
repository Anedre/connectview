import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/hooks/useAuth";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useConnectAgentUsername } from "@/hooks/useConnectAgentUsername";
import { traceChange, traceInfo } from "@/lib/debugTrace";
import { whenStreamsReady } from "@/lib/whenStreamsReady";

export interface ActiveContact {
  contactId: string;
  channel: string;
  state: string;
  customerPhone: string | null;
  queueName: string;
  /** "inbound" when the customer called us; "outbound" when the agent
   *  dialed out via placeCall(). Used by the global incoming overlay
   *  to skip the modal for outbound calls. */
  direction: "inbound" | "outbound";
  /** Contact attributes set by the contact flow (e.g. udep_intent,
   *  udep_nivel, udep_facultad, udep_sede). Empty object if unavailable. */
  attributes: Record<string, string>;
  /** Wall-clock timestamp of the most recent poll/event that observed
   *  this contact. We use this to expire contacts that disappeared from
   *  Streams without ever firing onEnded/onDestroy. */
  lastSeenTs: number;
  /** Wall-clock ms when this contact entered the "connected" state.
   *  Stays stable across snapshot polls so the call timer keeps
   *  ticking the REAL duration even when the agent switches focused
   *  tab (which used to reset the timer's internal counter). */
  connectedAtMs: number | null;
}

/**
 * A contact the agent failed to accept within the routing-profile
 * timeout. Amazon Connect fires `contact.onMissed()` exactly once for
 * these and then changes the agent state to `MissedCallAgent`, which
 * blocks new routed contacts until the agent manually returns to
 * Available.
 *
 * We surface them in their own short-lived list so the UI can:
 *  - Toast the agent immediately ("Llamada perdida · +51953...")
 *  - Show a dismissable tab with a red badge in the tab strip
 *  - Auto-expire after 30s so old misses don't clutter the strip
 */
export interface MissedContact {
  contactId: string;
  channel: string;
  customerPhone: string | null;
  queueName: string;
  /** When the miss was observed (Date.now() at the time onMissed fired). */
  missedAt: number;
  attributes: Record<string, string>;
}

/**
 * Persist contactId → connectedAtMs in sessionStorage so the call
 * timer survives a page refresh. Streams re-attaches to the live
 * contact after reload but its first few snapshots can report a stale
 * `statusDuration` (because the snapshot is from before the refresh
 * finished or because the iframe is still re-syncing). Without this
 * persistence the timer visibly resets to 00:00 mid-call.
 *
 * sessionStorage (not localStorage) — clears on tab close which is
 * correct: a closed tab means the agent ended their session, no need
 * to carry the timer forward.
 */
const CALL_TIMER_KEY = "vox.callTimers";
function readStoredConnectedAt(contactId: string): number | null {
  try {
    const raw = sessionStorage.getItem(CALL_TIMER_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, number>;
    const v = obj?.[contactId];
    return typeof v === "number" && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeStoredConnectedAt(contactId: string, ts: number) {
  try {
    const raw = sessionStorage.getItem(CALL_TIMER_KEY);
    const obj: Record<string, number> = raw ? JSON.parse(raw) : {};
    obj[contactId] = ts;
    // Cap to last 20 entries so this doesn't grow unbounded.
    const entries = Object.entries(obj);
    if (entries.length > 20) {
      const trimmed = entries
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);
      sessionStorage.setItem(CALL_TIMER_KEY, JSON.stringify(Object.fromEntries(trimmed)));
    } else {
      sessionStorage.setItem(CALL_TIMER_KEY, JSON.stringify(obj));
    }
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}
/**
 * Reconcile a freshly-computed connectedAtMs with the persisted one.
 *
 * Rule: if we already have a stored timestamp, prefer it ALWAYS unless
 * the new one is significantly EARLIER (which would mean we mis-anchored
 * earlier — very rare). This means the very first observation after a
 * refresh restores the original timestamp instead of "now".
 */
function reconcileConnectedAt(
  contactId: string,
  fresh: number | null
): number | null {
  if (!contactId) return fresh;
  const stored = readStoredConnectedAt(contactId);
  if (stored && fresh && fresh < stored - 5000) {
    // Fresh is clearly earlier — adopt and overwrite.
    writeStoredConnectedAt(contactId, fresh);
    return fresh;
  }
  if (stored) return stored;
  if (fresh) {
    writeStoredConnectedAt(contactId, fresh);
    return fresh;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractContact(c: any): ActiveContact | null {
  try {
    const contactId = c.getContactId?.();
    if (!contactId) return null;

    const channel = c.getType?.() || "VOICE";
    const state = c.getState?.()?.type || "";
    const queue = c.getQueue?.()?.name || "";

    // Drop only `error` zombies — those are unrecoverable. `missed`
    // contacts are still alive in the agent's slot (especially for
    // chat / WhatsApp / email): they block new routing until the
    // agent explicitly closes them via `contact.clear()`. The
    // Amazon Connect native CCP surfaces them with a "Close contact"
    // button for exactly this reason.
    if (state === "error") return null;

    let customerPhone: string | null = null;
    let direction: "inbound" | "outbound" = "inbound";
    try {
      const conn = c.getInitialConnection?.();
      const endpoint = conn?.getEndpoint?.();
      customerPhone = endpoint?.phoneNumber || null;
      const t = conn?.getType?.();
      if (t === "outbound") direction = "outbound";
    } catch {
      // ignore
    }

    const attributes: Record<string, string> = {};
    try {
      const raw = c.getAttributes?.() || {};
      for (const k of Object.keys(raw)) {
        const v = raw[k]?.value;
        if (typeof v === "string" && v.length > 0) attributes[k] = v;
      }
    } catch {
      // ignore
    }

    // Streams exposes `c.getStatusDuration()` = ms since the contact
    // entered its CURRENT state. When state==="connected" we anchor the
    // wall-clock at (now - statusDuration) so the timer keeps real time
    // regardless of how many snapshot polls / refresh callbacks fire.
    let connectedAtMs: number | null = null;
    if (state === "connected") {
      try {
        const dur = c.getStatusDuration?.() ?? 0;
        connectedAtMs = Date.now() - (typeof dur === "number" ? dur : 0);
      } catch {
        connectedAtMs = Date.now();
      }
    }
    // Restore from sessionStorage if we had this contact pre-refresh.
    connectedAtMs = reconcileConnectedAt(contactId, connectedAtMs);

    return {
      contactId,
      channel,
      state,
      customerPhone,
      queueName: queue,
      direction,
      attributes,
      lastSeenTs: Date.now(),
      connectedAtMs,
    };
  } catch {
    return null;
  }
}

/**
 * Extract a single contact from the Streams data-provider snapshot
 * (different shape from the live `connect.contact` object — uses plain
 * data instead of methods). Returns null for zombie contacts (state
 * error / missed) so we never surface contacts the agent can't act on.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFromSnapshot(c: any): ActiveContact | null {
  if (!c) return null;
  const state = c.state?.type || "";
  // Same rationale as extractContact: keep `missed` contacts in the
  // active list so the agent can see and act on them (close /
  // callback). Only `error` is truly unrecoverable.
  if (state === "error") return null;

  let customerPhone: string | null = null;
  if (c.connections && Array.isArray(c.connections)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const initialConn = c.connections.find((conn: any) => conn.initial);
     
    const customerConn = c.connections.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (conn: any) => conn.endpoint?.type === "telephone_number"
    );
    customerPhone =
      initialConn?.endpoint?.phoneNumber ||
      customerConn?.endpoint?.phoneNumber ||
      c.connections[0]?.endpoint?.phoneNumber ||
      null;
  }

  let direction: "inbound" | "outbound" = "inbound";
  if (c.connections && Array.isArray(c.connections)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const initialConn = c.connections.find((conn: any) => conn.initial);
    const t = initialConn?.type;
    if (t === "outbound") direction = "outbound";
  }

  const rawAttrs = c.attributes || {};
  const attributes: Record<string, string> = {};
  for (const k of Object.keys(rawAttrs)) {
    const v = rawAttrs[k]?.value;
    if (typeof v === "string" && v.length > 0) attributes[k] = v;
  }

  // Snapshot shape has `state.duration` (ms in current state). Use it
  // to anchor the connected timestamp the same way extractContact does.
  let connectedAtMs: number | null = null;
  if (state === "connected") {
    const dur = typeof c.state?.duration === "number" ? c.state.duration : 0;
    connectedAtMs = Date.now() - dur;
  }
  // Restore from sessionStorage if we had this contact pre-refresh.
  connectedAtMs = reconcileConnectedAt(c.contactId || "", connectedAtMs);

  return {
    contactId: c.contactId || "",
    channel: c.type || "VOICE",
    state,
    customerPhone,
    queueName: c.queue?.name || "",
    direction,
    attributes,
    lastSeenTs: Date.now(),
    connectedAtMs,
  };
}

/**
 * Poll the Streams data-provider for **all** the agent's contacts at once.
 *
 * Previously this returned only the first contact, which forced the
 * desktop into a single-contact mental model. Connect routing profiles
 * with chat / email concurrency > 1 commonly produce 5–10 live contacts
 * for an agent simultaneously, and we want the tab strip in the desktop
 * to see them all.
 */
function pollAllContacts(): {
  contacts: ActiveContact[];
  snapshotAgeMs: number;
} {
  try {
    if (typeof connect === "undefined")
      return { contacts: [], snapshotAgeMs: Infinity };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core = (connect as any).core;
    if (!core?.getAgentDataProvider) {
      return { contacts: [], snapshotAgeMs: Infinity };
    }

    try {
      const dp = core.getAgentDataProvider();
      const data = dp?.getAgentData?.();
      const snapshot = data?.snapshot || data;
      const snapshotTs = snapshot?.snapshotTimestamp
        ? new Date(snapshot.snapshotTimestamp).getTime()
        : 0;
      const snapshotAgeMs = snapshotTs ? Date.now() - snapshotTs : Infinity;

      const raw = snapshot?.contacts || [];
      const extracted: ActiveContact[] = [];
      for (const c of raw) {
        const ex = extractFromSnapshot(c);
        if (ex) extracted.push(ex);
      }
      return { contacts: extracted, snapshotAgeMs };
    } catch {
      return { contacts: [], snapshotAgeMs: Infinity };
    }
  } catch {
    return { contacts: [], snapshotAgeMs: Infinity };
  }
}

function sameContact(a: ActiveContact | null, b: ActiveContact | null) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const fa = Object.entries(a.attributes).sort().map(([k, v]) => `${k}=${v}`).join("|");
  const fb = Object.entries(b.attributes).sort().map(([k, v]) => `${k}=${v}`).join("|");
  return (
    a.contactId === b.contactId &&
    a.state === b.state &&
    a.customerPhone === b.customerPhone &&
    fa === fb
  );
}

/**
 * Merge a new observation of an existing contact with the cached value.
 * Implements the monotonic-state and sticky-field rules that prevent
 * the UI from oscillating when two pollers (Streams snapshot + API)
 * report different fields for the same contactId in quick succession.
 *
 * Returns `prev` (same reference) when nothing meaningful changed —
 * lets React bail out of re-renders.
 */
function mergeContact(prev: ActiveContact, next: ActiveContact): ActiveContact {
  const stateRank: Record<string, number> = {
    "": 0,
    ringing: 1,
    incoming: 2,
    connecting: 3,
    connected: 4,
    onhold: 4,
    acw: 5,
    ended: 6,
    error: 7,
    missed: 7,
  };
  const prevRank = stateRank[prev.state] ?? 0;
  const nextRank = stateRank[next.state] ?? 0;
  const stickyState = nextRank >= prevRank ? next.state : prev.state;

  // Preserve `connectedAtMs` across polls — it's the wall-clock anchor
  // for the call timer. The new snapshot might re-derive a slightly
  // different value (drift in Date.now() vs Streams' duration counter),
  // so once we have a value we KEEP it for the lifetime of the contact.
  // Only adopt the new value when prev didn't have one yet (e.g. the
  // contact just transitioned ringing → connected).
  const connectedAtMs =
    prev.connectedAtMs ?? next.connectedAtMs ?? null;

  const merged: ActiveContact = {
    ...prev,
    ...next,
    state: stickyState,
    customerPhone: next.customerPhone || prev.customerPhone,
    queueName: next.queueName || prev.queueName,
    attributes: { ...prev.attributes, ...next.attributes },
    lastSeenTs: Math.max(prev.lastSeenTs, next.lastSeenTs),
    connectedAtMs,
  };
  if (stickyState !== next.state) {
    traceInfo("useActiveContact.stateStickied", {
      contactId: prev.contactId,
      from: next.state,
      kept: stickyState,
      prevRank,
      nextRank,
    });
  }
  return sameContact(prev, merged) ? prev : merged;
}

/**
 * Per-contact "missed observation" budget. If a contactId disappears
 * from this many consecutive polls without firing onEnded/onDestroy,
 * we evict it. Streams occasionally drops contacts from the snapshot
 * before the lifecycle callback fires, so we need to garbage-collect
 * stale contacts proactively.
 *
 * 4 polls × 800 ms ≈ 3.2 s window — covers transient snapshot gaps
 * but evicts truly-dead contacts in a few seconds.
 */
const EVICT_AFTER_MS = 5_000;

/**
 * How long a missed-contact entry stays in the tab strip before
 * auto-disappearing. 30s is enough for the agent to notice the toast,
 * read the customer info, and decide if they want to call back.
 */
const MISSED_CONTACT_TTL_MS = 30_000;

interface ActiveContactsContextValue {
  contacts: ActiveContact[];
  focusedContactId: string | null;
  /** The currently-focused contact, derived from `contacts` +
   *  `focusedContactId`. Null when no contacts exist. */
  focused: ActiveContact | null;
  focus: (contactId: string | null) => void;
  /** Recently-missed contacts. Auto-expire after MISSED_CONTACT_TTL_MS
   *  or when the agent calls `dismissMissed(contactId)`. */
  missedContacts: MissedContact[];
  dismissMissed: (contactId: string) => void;
}

/**
 * SHARED POLLING HOOK — multi-contact.
 *
 * Tracks every active contact the agent has (Connect routing profiles
 * allow concurrent voice / chat / email / task — an agent can easily
 * have 8+ contacts at once). Each contact lives independently with its
 * own merge state. A single "focused" contact at any time drives what
 * the AgentDesktop center panels render; the tab strip lets the agent
 * pick which one to focus.
 *
 * One Provider, one polling loop, one Streams subscription — all
 * consumers read from React context.
 */
function useActiveContactsState(): ActiveContactsContextValue {
  const { user, isOnboarding } = useAuth();
  const [contacts, setContacts] = useState<ActiveContact[]>([]);
  const [focusedContactId, setFocusedContactId] = useState<string | null>(null);
  const [missedContacts, setMissedContacts] = useState<MissedContact[]>([]);
  // Streams poll uses setTimeout self-rescheduling so it can back off
  // when the data-provider IPC is stuck.
  const intervalRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const apiIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const subscribedContactIds = useRef<Set<string>>(new Set());
  const missedExpiryRef = useRef<ReturnType<typeof setInterval>>(undefined);

  /**
   * Record a contact that the agent failed to accept. Called from the
   * `contact.onMissed` subscription (Streams) or from a state
   * transition into "missed" in the snapshot polls. Idempotent — same
   * contactId fires only once per session, even if we observe the
   * missed state multiple times via different paths.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recordMissed = useCallback((c: any) => {
    if (!c) return;
    const contactId =
      typeof c.getContactId === "function" ? c.getContactId() : c.contactId;
    if (!contactId) return;

    // Try to read fields from both the live Streams contact object
    // (has methods) and the snapshot shape (has plain fields).
    const channel =
      typeof c.getType === "function" ? c.getType() : c.type || "VOICE";
    let queueName = "";
    try {
      queueName =
        typeof c.getQueue === "function"
          ? c.getQueue()?.name || ""
          : c.queue?.name || "";
    } catch { /* noop */ }

    let customerPhone: string | null = null;
    try {
      if (typeof c.getInitialConnection === "function") {
        customerPhone =
          c.getInitialConnection()?.getEndpoint?.()?.phoneNumber || null;
      } else if (c.connections && Array.isArray(c.connections)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const initial = c.connections.find((cn: any) => cn.initial);
        customerPhone =
          initial?.endpoint?.phoneNumber ||
          c.connections[0]?.endpoint?.phoneNumber ||
          null;
      }
    } catch { /* noop */ }

    const attributes: Record<string, string> = {};
    try {
      const raw =
        typeof c.getAttributes === "function" ? c.getAttributes() : c.attributes;
      if (raw) {
        for (const k of Object.keys(raw)) {
          const v = raw[k]?.value;
          if (typeof v === "string" && v.length > 0) attributes[k] = v;
        }
      }
    } catch { /* noop */ }

    setMissedContacts((prev) => {
      // Dedup — same contactId only goes into the list once.
      if (prev.some((m) => m.contactId === contactId)) return prev;
      traceChange("useActiveContact.contactMissed", {
        contactId,
        channel,
        customerPhone,
      });
      return [
        ...prev,
        {
          contactId,
          channel,
          customerPhone,
          queueName,
          missedAt: Date.now(),
          attributes,
        },
      ];
    });
  }, []);

  /** Agent dismissed a missed-contact tab. Removes it immediately. */
  const dismissMissed = useCallback((contactId: string) => {
    setMissedContacts((prev) => prev.filter((m) => m.contactId !== contactId));
  }, []);

  // Auto-expire old missed contacts. Runs once per second — cheap
  // because the list is bounded and short-lived.
  useEffect(() => {
    if (missedContacts.length === 0) {
      if (missedExpiryRef.current) {
        clearInterval(missedExpiryRef.current);
        missedExpiryRef.current = undefined;
      }
      return;
    }
    if (missedExpiryRef.current) return;
    missedExpiryRef.current = setInterval(() => {
      const cutoff = Date.now() - MISSED_CONTACT_TTL_MS;
      setMissedContacts((prev) => {
        const next = prev.filter((m) => m.missedAt >= cutoff);
        return next.length === prev.length ? prev : next;
      });
    }, 1000);
    return () => {
      if (missedExpiryRef.current) {
        clearInterval(missedExpiryRef.current);
        missedExpiryRef.current = undefined;
      }
    };
  }, [missedContacts.length]);

  /**
   * Apply an observation of the current contact set. For each
   * incoming contact, upsert into the array with merge logic. For
   * cached contacts that didn't appear in the observation, decide
   * whether to evict (based on lastSeenTs).
   */
  /**
   * Reconcile observed contacts into the cached list.
   *
   * @param observed      The contacts we just saw.
   * @param isFullSnapshot When TRUE, the caller represents the COMPLETE
   *                       agent state (e.g. a Streams snapshot poll that
   *                       called `agent.getContacts()`). Cached contacts
   *                       that aren't in `observed` are considered for
   *                       eviction after the grace window.
   *
   *                       When FALSE, this is a partial update from a
   *                       single contact's lifecycle callback
   *                       (onRefresh, onConnected, …). We only upsert
   *                       that contact and leave the others alone —
   *                       evicting them based on a partial observation
   *                       was THE bug that caused the multi-contact
   *                       strip to flicker tabs in/out every ~5-10 s.
   */
  const observeAllContacts = useCallback(
    (observed: ActiveContact[], isFullSnapshot = false) => {
      setContacts((prev) => {
        const now = Date.now();

        // 1) Upsert each observed contact (always — both modes do this)
        const next: ActiveContact[] = [];
        const seen = new Set<string>();
        for (const obs of observed) {
          const prior = prev.find((p) => p.contactId === obs.contactId);
          if (prior) {
            const merged = mergeContact(prior, obs);
            next.push(merged);
          } else {
            traceChange("useActiveContact.contactAdded", {
              contactId: obs.contactId,
              channel: obs.channel,
              state: obs.state,
            });
            next.push(obs);
          }
          seen.add(obs.contactId);
        }

        // 2) Carry forward the rest of the cached contacts.
        for (const cached of prev) {
          if (seen.has(cached.contactId)) continue;
          if (!isFullSnapshot) {
            // PARTIAL update — preserve every other cached contact
            // verbatim. They're still alive; this callback just doesn't
            // know about them.
            next.push(cached);
            continue;
          }
          // FULL snapshot — check the eviction window. The grace
          // covers transient snapshot gaps (Streams IPC briefly drops
          // a contact then re-includes it on the next tick).
          const age = now - cached.lastSeenTs;
          if (age < EVICT_AFTER_MS) {
            next.push(cached);
          } else {
            traceInfo("useActiveContact.contactEvicted", {
              contactId: cached.contactId,
              ageMs: age,
            });
          }
        }

        // 3) Bail out if nothing changed (same set + same ordering +
        //    each pairwise equal via sameContact).
        if (
          next.length === prev.length &&
          next.every((c, i) => sameContact(c, prev[i]))
        ) {
          return prev;
        }
        traceChange("useActiveContact.contactsChanged", {
          count: next.length,
          ids: next.map((c) => c.contactId),
          states: next.map((c) => `${c.contactId.slice(-6)}:${c.state}`),
        });
        return next;
      });
    },
    []
  );

  /** Force-remove a single contact (fired from onEnded / onDestroy). */
  const removeContact = useCallback((contactId: string) => {
    setContacts((prev) => {
      if (!prev.some((c) => c.contactId === contactId)) return prev;
      traceInfo("useActiveContact.contactRemoved", { contactId });
      return prev.filter((c) => c.contactId !== contactId);
    });
  }, []);

  // Auto-focus management.
  //   - No focus + at least one contact → focus the most recent one.
  //   - Focused contact disappears → focus next available.
  //   - Brand new contact appears but agent already has focus → keep
  //     current focus (tab strip will pulse to indicate the new one).
  useEffect(() => {
    if (contacts.length === 0) {
      if (focusedContactId !== null) {
        traceInfo("useActiveContact.focusCleared", {});
        setFocusedContactId(null);
      }
      return;
    }
    const currentFocusValid =
      focusedContactId !== null &&
      contacts.some((c) => c.contactId === focusedContactId);
    if (currentFocusValid) return;

    // Pick the freshest contact (most recently observed).
    const next = [...contacts].sort((a, b) => b.lastSeenTs - a.lastSeenTs)[0];
    if (next) {
      traceInfo("useActiveContact.autoFocus", {
        contactId: next.contactId,
        previousFocus: focusedContactId,
        reason: focusedContactId === null ? "no-focus" : "focus-gone",
      });
      setFocusedContactId(next.contactId);
    }
  }, [contacts, focusedContactId]);

  // ─── Streams subscription + polling (multi-contact) ────────────
  useEffect(() => {
    if (typeof connect === "undefined") return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscribeToContact = (c: any) => {
      const contactId = c.getContactId?.();
      if (!contactId || subscribedContactIds.current.has(contactId)) return;
      subscribedContactIds.current.add(contactId);

      const refresh = () => {
        const info = extractContact(c);
        // Per-contact lifecycle callback — NOT a full snapshot. We must
        // pass isFullSnapshot=false so the other cached contacts aren't
        // mistakenly considered for eviction just because they aren't
        // in this single-contact observation.
        if (info) observeAllContacts([info], false);
      };

      refresh();

      try { c.onConnecting?.(refresh); } catch { /* noop */ }
      try { c.onIncoming?.(refresh); } catch { /* noop */ }
      try { c.onAccepted?.(refresh); } catch { /* noop */ }
      try { c.onConnected?.(refresh); } catch { /* noop */ }
      try { c.onACW?.(refresh); } catch { /* noop */ }
      try { c.onRefresh?.(refresh); } catch { /* noop */ }
      try { c.onError?.(refresh); } catch { /* noop */ }
      // onMissed fires exactly once when the agent fails to accept a
      // ringing contact within the routing-profile timeout. We:
      //   1) Record it so the toast + banner UX fires.
      //   2) Refresh the contact (so its state transitions to "missed"
      //      in the active contacts list).
      //   3) Do NOT remove it. For chat / WhatsApp / email the contact
      //      stays attached to the agent and blocks new routing —
      //      they must explicitly close it via `contact.clear()`.
      //      Voice missed contacts disappear from agent.getContacts()
      //      shortly after on their own, so the eviction-by-staleness
      //      logic catches them naturally.
      try {
        c.onMissed?.(() => {
          recordMissed(c);
          refresh();
        });
      } catch { /* noop */ }
      try {
        c.onEnded?.(() => {
          subscribedContactIds.current.delete(contactId);
          removeContact(contactId);
        });
      } catch { /* noop */ }
      try {
        c.onDestroy?.(() => {
          subscribedContactIds.current.delete(contactId);
          removeContact(contactId);
        });
      } catch { /* noop */ }
    };

    // Suscripción a contactos (camino INSTANTÁNEO) — ESPERA el event bus. Antes se
    // suscribía al toque; si el bus aún no existía (carga async vía el CCP), los
    // callbacks se registraban pero NUNCA disparaban (mismo bug del username). El
    // poll de 800ms de abajo igual levanta los contactos, pero con delay; esto
    // restaura el path en tiempo real. whenStreamsReady reintenta hasta que el bus
    // exista y recién ahí suscribe.
    const cancelStreams = whenStreamsReady((conn) => {
      try { conn.contact?.(subscribeToContact); } catch { /* noop */ }
      try {
        const bus = conn.core?.getEventBus?.();
        if (bus) {
          const events = [
            "contact::init",
            "contact::incoming",
            "contact::connecting",
            "contact::connected",
            "contact::accepted",
            "contact::refresh",
            "contact::acw",
          ];
          events.forEach((evt) => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              bus.subscribe(evt, (c: any) => {
                subscribeToContact(c);
                const info = extractContact(c);
                // Bus events fire for a single contact — partial update.
                if (info) observeAllContacts([info], false);
              });
            } catch { /* noop */ }
          });
        }
      } catch { /* noop */ }
    });

    // Streams polling with backoff. See the long comment in the
    // previous (single-contact) version — same logic, but now it
    // refreshes the entire contacts array instead of just the
    // "current" one.
    let staleCount = 0;
    const FAST_MS = 800;
    const schedule = (delay: number) => {
      intervalRef.current = setTimeout(tick, delay);
    };
    const tick = () => {
      const { contacts: snap, snapshotAgeMs } = pollAllContacts();
      if (snapshotAgeMs >= 8000) {
        staleCount += 1;
        traceInfo("useActiveContact.streamsPoll.staleSnapshot", {
          snapshotAgeMs,
          staleCount,
        });
        const delay =
          staleCount >= 10
            ? FAST_MS * 12
            : staleCount >= 6
            ? FAST_MS * 6
            : staleCount >= 3
            ? FAST_MS * 3
            : FAST_MS;
        schedule(delay);
        return;
      }
      if (staleCount > 0) {
        traceInfo("useActiveContact.streamsPoll.recovered", {
          previousStaleCount: staleCount,
        });
        staleCount = 0;
      }
      traceChange("useActiveContact.streamsPoll", {
        count: snap.length,
        snapshotAgeMs,
        ids: snap.map((c) => c.contactId.slice(-6)),
      });
      // Snapshot is the canonical "all contacts the agent currently
      // has". Pass isFullSnapshot=true so missing contacts can be
      // evicted (subject to the EVICT_AFTER_MS grace window).
      observeAllContacts(snap, true);
      schedule(FAST_MS);
    };
    schedule(FAST_MS);

    // Seed initial state synchronously so the first render has the
    // current contacts (rather than waiting 800 ms for the first tick).
    const { contacts: initial, snapshotAgeMs: initialAge } = pollAllContacts();
    if (initial.length > 0 && initialAge < 8000) {
      observeAllContacts(initial, true);
    }

    return () => {
      cancelStreams();
      if (intervalRef.current) clearTimeout(intervalRef.current);
      subscribedContactIds.current.clear();
    };
  }, [observeAllContacts, removeContact]);

  // ─── API fallback (single primary contact) ─────────────────────
  // The /agentActiveContact endpoint only returns one contact (the
  // "primary"). We still hit it as a corroborator for the focused
  // contact — useful when Streams IPC is wedged. It can't surface
  // additional contacts beyond what Streams sees.

  // Username REAL de Connect del agente (del CCP) — fuente de verdad para los
  // lookups de Connect; puede ≠ el de Cognito. Ver useConnectAgentUsername.
  const connectUsername = useConnectAgentUsername();

  useEffect(() => {
    // En onboarding (tenant sin Connect conectado) no hay agente ni contacto
    // activo que consultar — saltamos el polling para no spamear 404s.
    if (isOnboarding) return;
    // Preferimos el username de CONNECT (del CCP); fallback al de Cognito.
    const username = connectUsername || user?.username;
    if (!username) return;

    const endpoints = getApiEndpoints();
    if (!endpoints?.getAgentActiveContact) return;

    let cancelled = false;

    const fetchActive = async () => {
      try {
        const res = await authedFetch(
          `${endpoints.getAgentActiveContact}?username=${encodeURIComponent(
            username
          )}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        if (!data.contact) {
          // No primary contact — leave the Streams-tracked list alone;
          // we don't infer "no contacts" from the API since it might
          // just be missing the non-primary ones.
          return;
        }

        const apiContact: ActiveContact = {
          contactId: data.contact.contactId,
          channel: data.contact.channel || "VOICE",
          state: (data.contact.state || "").toLowerCase(),
          customerPhone: data.contact.customerPhone || null,
          queueName: data.contact.queueName || "",
          direction:
            (data.contact.direction || data.contact.initiationMethod) === "outbound"
              ? "outbound"
              : "inbound",
          attributes: data.contact.attributes || {},
          lastSeenTs: Date.now(),
          connectedAtMs: null,
        };

        if (apiContact.state === "error" || apiContact.state === "missed") {
          traceInfo("useActiveContact.apiFallback.zombie", {
            contactId: apiContact.contactId,
            state: apiContact.state,
          });
          return;
        }

        traceChange("useActiveContact.apiFallback.contact", {
          contactId: apiContact.contactId,
          state: apiContact.state,
        });
        observeAllContacts([apiContact]);
      } catch {
        // network error — fall back to streams polling
      }
    };

    fetchActive();
    apiIntervalRef.current = setInterval(fetchActive, 5000);

    return () => {
      cancelled = true;
      if (apiIntervalRef.current) clearInterval(apiIntervalRef.current);
    };
  }, [connectUsername, user?.username, observeAllContacts, isOnboarding]);

  // Stable callback for focus changes (used by the tab strip).
  const focus = useCallback((contactId: string | null) => {
    setFocusedContactId(contactId);
  }, []);

  // Derive the focused contact from the current contacts + focusedId.
  const focused = useMemo(
    () =>
      focusedContactId == null
        ? null
        : contacts.find((c) => c.contactId === focusedContactId) || null,
    [contacts, focusedContactId]
  );

  return useMemo(
    () => ({
      contacts,
      focusedContactId,
      focused,
      focus,
      missedContacts,
      dismissMissed,
    }),
    [
      contacts,
      focusedContactId,
      focused,
      focus,
      missedContacts,
      dismissMissed,
    ]
  );
}

/* -------------------------------------------------------------------------- */
/* Provider + context-backed hooks                                             */
/* -------------------------------------------------------------------------- */

const EMPTY_CONTEXT: ActiveContactsContextValue = {
  contacts: [],
  focusedContactId: null,
  focused: null,
  focus: () => {},
  missedContacts: [],
  dismissMissed: () => {},
};

const ActiveContactsContext = createContext<
  ActiveContactsContextValue | undefined
>(undefined);

export function ActiveContactProvider({ children }: { children: ReactNode }) {
  const value = useActiveContactsState();
  return createElement(
    ActiveContactsContext.Provider,
    { value },
    children
  );
}

/**
 * Backwards-compatible hook. Returns the **focused** contact only.
 * Components that just need to know "what's the agent looking at right
 * now?" can keep using this; nothing changed on their side.
 */
export function useActiveContact(): ActiveContact | null {
  const ctx = useContext(ActiveContactsContext);
  // Mirror the previous fallback path: if no provider is mounted, run
  // a local poller. In practice the provider is always mounted at the
  // app root, so this only fires in storybook/tests.
  if (ctx !== undefined) return ctx.focused;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useActiveContactsState().focused;
}

/**
 * Read the full list of contacts the agent currently has, regardless
 * of which one is focused. Use this for the tab strip / list views.
 */
export function useAllActiveContacts(): ActiveContact[] {
  const ctx = useContext(ActiveContactsContext);
  return ctx ? ctx.contacts : EMPTY_CONTEXT.contacts;
}

/**
 * Read + change the focused contact id. The setter accepts null to
 * deselect (rare). Use this from the tab strip click handler.
 */
export function useContactFocus(): {
  focusedContactId: string | null;
  focus: (contactId: string | null) => void;
} {
  const ctx = useContext(ActiveContactsContext);
  return ctx
    ? { focusedContactId: ctx.focusedContactId, focus: ctx.focus }
    : { focusedContactId: null, focus: EMPTY_CONTEXT.focus };
}

/**
 * Read the list of recently-missed contacts + a dismisser. Auto-expires
 * each entry after 30 seconds; the agent can also dismiss manually via
 * an `X` button on the tab strip / banner.
 */
export function useMissedContacts(): {
  missedContacts: MissedContact[];
  dismissMissed: (contactId: string) => void;
} {
  const ctx = useContext(ActiveContactsContext);
  return ctx
    ? { missedContacts: ctx.missedContacts, dismissMissed: ctx.dismissMissed }
    : {
        missedContacts: EMPTY_CONTEXT.missedContacts,
        dismissMissed: EMPTY_CONTEXT.dismissMissed,
      };
}
