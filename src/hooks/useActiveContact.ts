import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getApiEndpoints } from "@/lib/api";

interface ActiveContact {
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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractContact(c: any): ActiveContact | null {
  try {
    const contactId = c.getContactId?.();
    if (!contactId) return null;

    const channel = c.getType?.() || "VOICE";
    const state = c.getState?.()?.type || "";
    const queue = c.getQueue?.()?.name || "";

    // Drop zombie contacts that Streams keeps in its snapshot after a
    // session error / disconnect — they have state="error" or
    // "missed" and can't be re-wired (getMediaController throws
    // "Media Controller is no longer available"). Letting them through
    // here makes the desktop show a ghost chat stuck on "Conectando…".
    if (state === "error" || state === "missed") return null;

    let customerPhone: string | null = null;
    let direction: "inbound" | "outbound" = "inbound";
    try {
      const conn = c.getInitialConnection?.();
      const endpoint = conn?.getEndpoint?.();
      customerPhone = endpoint?.phoneNumber || null;
      // streams: connection.getType() returns 'inbound' or 'outbound'
      const t = conn?.getType?.();
      if (t === "outbound") direction = "outbound";
    } catch {
      // ignore
    }

    // Streams Contact attributes come back as { [key]: { name, value } }.
    // Flatten to a plain string map for ergonomic consumption downstream.
    let attributes: Record<string, string> = {};
    try {
      const raw = c.getAttributes?.() || {};
      for (const k of Object.keys(raw)) {
        const v = raw[k]?.value;
        if (typeof v === "string" && v.length > 0) attributes[k] = v;
      }
    } catch {
      // ignore
    }

    return { contactId, channel, state, customerPhone, queueName: queue, direction, attributes };
  } catch {
    return null;
  }
}

// Poll the DataProvider synchronously (may be stale - Streams IPC bug)
function pollCurrentContact(): {
  contact: ActiveContact | null;
  snapshotAgeMs: number;
} {
  try {
    if (typeof connect === "undefined")
      return { contact: null, snapshotAgeMs: Infinity };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core = (connect as any).core;
    if (core?.getAgentDataProvider) {
      try {
        const dp = core.getAgentDataProvider();
        const data = dp?.getAgentData?.();
        const snapshot = data?.snapshot || data;
        const snapshotTs = snapshot?.snapshotTimestamp
          ? new Date(snapshot.snapshotTimestamp).getTime()
          : 0;
        const snapshotAgeMs = snapshotTs ? Date.now() - snapshotTs : Infinity;

        const contacts = snapshot?.contacts || [];
        // Filter zombie contacts (state error/missed) from the snapshot so
        // we don't show ghost chats.
        const liveContacts = contacts.filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (cc: any) => cc?.state?.type !== "error" && cc?.state?.type !== "missed"
        );
        if (liveContacts.length > 0) {
          const c = liveContacts[0];

          let customerPhone: string | null = null;
          if (c.connections && Array.isArray(c.connections)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const initialConn = c.connections.find((conn: any) => conn.initial);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

          // direction: prefer the initial connection's type if available
          let direction: "inbound" | "outbound" = "inbound";
          if (c.connections && Array.isArray(c.connections)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const initialConn = c.connections.find((conn: any) => conn.initial);
            const t = initialConn?.type;
            if (t === "outbound") direction = "outbound";
          }

          // Snapshot stores attributes flat: { key: { name, value } }
          const rawAttrs = c.attributes || {};
          const attributes: Record<string, string> = {};
          for (const k of Object.keys(rawAttrs)) {
            const v = rawAttrs[k]?.value;
            if (typeof v === "string" && v.length > 0) attributes[k] = v;
          }

          return {
            contact: {
              contactId: c.contactId || "",
              channel: c.type || "VOICE",
              state: c.state?.type || "",
              customerPhone,
              queueName: c.queue?.name || "",
              direction,
              attributes,
            },
            snapshotAgeMs,
          };
        }

        return { contact: null, snapshotAgeMs };
      } catch {
        return { contact: null, snapshotAgeMs: Infinity };
      }
    }

    return { contact: null, snapshotAgeMs: Infinity };
  } catch {
    return { contact: null, snapshotAgeMs: Infinity };
  }
}

function sameContact(a: ActiveContact | null, b: ActiveContact | null) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  // Compare attribute fingerprints so the UI re-renders when the flow
  // sets new context (e.g. udep_intent, udep_nivel) mid-contact.
  const fa = Object.entries(a.attributes).sort().map(([k, v]) => `${k}=${v}`).join("|");
  const fb = Object.entries(b.attributes).sort().map(([k, v]) => `${k}=${v}`).join("|");
  return (
    a.contactId === b.contactId &&
    a.state === b.state &&
    a.customerPhone === b.customerPhone &&
    fa === fb
  );
}

// How many consecutive null observations from BOTH sources before we
// commit to clearing the contact. With Streams polling at 800 ms and API
// polling at 5 s, ~4 polls covers brief snapshot gaps without flickering
// the Agent Desktop empty state for a still-live contact.
const CLEAR_AFTER_NULLS = 4;

export function useActiveContact() {
  const { user } = useAuth();
  const [contact, setContact] = useState<ActiveContact | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const apiIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const subscribedContactIds = useRef<Set<string>>(new Set());
  // Counter for consecutive "no contact" observations from either source.
  // Reset to 0 every time any source surfaces a real contact.
  const nullCountRef = useRef<number>(0);

  // Apply a debounced clear — only commits null after CLEAR_AFTER_NULLS
  // consecutive nulls. Used by both Streams and API pollers to dampen
  // the transient null spikes that were flickering the UI.
  const observeNull = useCallback(() => {
    nullCountRef.current += 1;
    if (nullCountRef.current >= CLEAR_AFTER_NULLS) {
      setContact((prev) => (prev === null ? prev : null));
    }
  }, []);
  const observeReal = useCallback((next: ActiveContact) => {
    nullCountRef.current = 0;
    setContact((prev) => {
      if (sameContact(prev, next)) return prev;
      // Two pollers (Streams snapshot + API fallback) observe the same
      // contact with slightly different field coverage:
      //   - Streams: usually has customerPhone, queueName from snapshot
      //   - API:     authoritative on contactId/state, but customerPhone
      //              and queueName are sometimes empty
      // When the *same* contactId comes back from a different poller
      // with EMPTY fields, we'd otherwise overwrite the populated values
      // with nulls — the UI then bounces between "Andre Alata Calle ·
      // +51953730189" and "Sin contacto · ".
      //
      // Merge instead: keep populated fields when the new sample has
      // them empty.
      if (prev && prev.contactId === next.contactId) {
        // State must be monotonic — once a contact reaches a "more
        // progressed" state (e.g. connected), a stale poll reporting
        // "connecting" shouldn't drag it back. This is exactly what
        // caused the customer card to oscillate between "Sin contacto"
        // (state=connected, but missing phone) and "Andre · Sin
        // whatsapp activo" (state=connecting, phone present): two
        // pollers reporting different fields with different state.
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

        const merged: ActiveContact = {
          ...prev,
          ...next,
          state: stickyState,
          customerPhone: next.customerPhone || prev.customerPhone,
          queueName: next.queueName || prev.queueName,
          // Union of attribute keys with `next` taking precedence on
          // conflicting values. Streams snapshot + API may each have a
          // subset (e.g. one has udep_source but not udep_intent).
          attributes: { ...prev.attributes, ...next.attributes },
        };
        return sameContact(prev, merged) ? prev : merged;
      }
      return next;
    });
  }, []);

  // Streams-based detection (fast path, may fail silently if IPC frozen)
  useEffect(() => {
    if (typeof connect === "undefined") return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscribeToContact = (c: any) => {
      const contactId = c.getContactId?.();
      if (!contactId || subscribedContactIds.current.has(contactId)) return;
      subscribedContactIds.current.add(contactId);

      const refresh = () => {
        const info = extractContact(c);
        if (info) {
          setContact((prev) => (sameContact(prev, info) ? prev : info));
        } else {
          // extractContact returned null — either the contact has no id
          // anymore, or its state is "error" / "missed" (a zombie). If
          // this id was the one we were tracking, drop it so the desktop
          // returns to the empty state rather than rendering a ghost.
          setContact((prev) => (prev?.contactId === contactId ? null : prev));
        }
      };

      refresh();

      try { c.onConnecting?.(refresh); } catch { /* noop */ }
      try { c.onIncoming?.(refresh); } catch { /* noop */ }
      try { c.onAccepted?.(refresh); } catch { /* noop */ }
      try { c.onConnected?.(refresh); } catch { /* noop */ }
      try { c.onACW?.(refresh); } catch { /* noop */ }
      try { c.onRefresh?.(refresh); } catch { /* noop */ }
      try { c.onError?.(refresh); } catch { /* noop */ }
      try { c.onMissed?.(refresh); } catch { /* noop */ }
      try {
        c.onEnded?.(() => {
          subscribedContactIds.current.delete(contactId);
          setContact(null);
        });
      } catch { /* noop */ }
      try {
        c.onDestroy?.(() => {
          subscribedContactIds.current.delete(contactId);
          setContact(null);
        });
      } catch { /* noop */ }
    };

    try { connect.contact?.(subscribeToContact); } catch { /* noop */ }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const core = (connect as any).core;
      const bus = core?.getEventBus?.();
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
              if (info)
                setContact((prev) => (sameContact(prev, info) ? prev : info));
            });
          } catch { /* noop */ }
        });
      }
    } catch { /* noop */ }

    // Streams polling (fast path). Apply the null-debounce so transient
    // gaps in the data-provider snapshot don't bounce the UI to empty.
    intervalRef.current = setInterval(() => {
      const { contact: current, snapshotAgeMs } = pollCurrentContact();
      if (snapshotAgeMs >= 8000) return; // snapshot stale — trust last known
      if (current) {
        observeReal(current);
      } else {
        observeNull();
      }
    }, 800);

    const { contact: initial, snapshotAgeMs } = pollCurrentContact();
    if (initial && snapshotAgeMs < 8000) {
      nullCountRef.current = 0;
      setContact(initial);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      subscribedContactIds.current.clear();
    };
  }, [observeNull, observeReal]);

  // API-based fallback (reliable, polls every 3s - bypasses Streams IPC)
  useEffect(() => {
    const username = user?.username;
    if (!username) return;

    const endpoints = getApiEndpoints();
    if (!endpoints?.getAgentActiveContact) return;

    let cancelled = false;

    const fetchActive = async () => {
      try {
        const res = await fetch(
          `${endpoints.getAgentActiveContact}?username=${encodeURIComponent(
            username
          )}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        if (!data.contact) {
          // API says no active contact — go through the same debounce so a
          // single 5 s API hiccup doesn't flash the UI to empty state.
          const { contact: streamsContact, snapshotAgeMs } = pollCurrentContact();
          if (!streamsContact || snapshotAgeMs > 8000) {
            observeNull();
          }
          return;
        }

        const apiContact: ActiveContact = {
          contactId: data.contact.contactId,
          channel: data.contact.channel || "VOICE",
          // Map API state to Streams-like state
          state: (data.contact.state || "").toLowerCase(),
          customerPhone: data.contact.customerPhone || null,
          queueName: data.contact.queueName || "",
          direction:
            (data.contact.direction || data.contact.initiationMethod) === "outbound"
              ? "outbound"
              : "inbound",
          // API may or may not surface attributes; default to empty.
          // The Streams snapshot path above is the authoritative source.
          attributes: data.contact.attributes || {},
        };

        // Same zombie filter as Streams snapshot — don't observe contacts
        // the agent can't actually interact with (state error / missed).
        if (apiContact.state === "error" || apiContact.state === "missed") {
          observeNull();
          return;
        }

        observeReal(apiContact);
      } catch {
        // network error - fall back to Streams polling
      }
    };

    // Initial fetch + 5s interval (Connect APIs are throttled — 3s was too aggressive)
    fetchActive();
    apiIntervalRef.current = setInterval(fetchActive, 5000);

    return () => {
      cancelled = true;
      if (apiIntervalRef.current) clearInterval(apiIntervalRef.current);
    };
  }, [user?.username, observeNull, observeReal]);

  return contact;
}
