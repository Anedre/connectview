import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getApiEndpoints } from "@/lib/api";

interface ActiveContact {
  contactId: string;
  channel: string;
  state: string;
  customerPhone: string | null;
  queueName: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractContact(c: any): ActiveContact | null {
  try {
    const contactId = c.getContactId?.();
    if (!contactId) return null;

    const channel = c.getType?.() || "VOICE";
    const state = c.getState?.()?.type || "";
    const queue = c.getQueue?.()?.name || "";

    let customerPhone: string | null = null;
    try {
      const conn = c.getInitialConnection?.();
      const endpoint = conn?.getEndpoint?.();
      customerPhone = endpoint?.phoneNumber || null;
    } catch {
      // ignore
    }

    return { contactId, channel, state, customerPhone, queueName: queue };
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
        if (contacts.length > 0) {
          const c = contacts[0];

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

          return {
            contact: {
              contactId: c.contactId || "",
              channel: c.type || "VOICE",
              state: c.state?.type || "",
              customerPhone,
              queueName: c.queue?.name || "",
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
  return (
    a.contactId === b.contactId &&
    a.state === b.state &&
    a.customerPhone === b.customerPhone
  );
}

export function useActiveContact() {
  const { user } = useAuth();
  const [contact, setContact] = useState<ActiveContact | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const apiIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const subscribedContactIds = useRef<Set<string>>(new Set());

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
        if (info) setContact((prev) => (sameContact(prev, info) ? prev : info));
      };

      refresh();

      try { c.onConnecting?.(refresh); } catch { /* noop */ }
      try { c.onIncoming?.(refresh); } catch { /* noop */ }
      try { c.onAccepted?.(refresh); } catch { /* noop */ }
      try { c.onConnected?.(refresh); } catch { /* noop */ }
      try { c.onACW?.(refresh); } catch { /* noop */ }
      try { c.onRefresh?.(refresh); } catch { /* noop */ }
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

    // Streams polling (fast path)
    intervalRef.current = setInterval(() => {
      const { contact: current, snapshotAgeMs } = pollCurrentContact();
      // Only trust Streams if snapshot is fresh (< 8s old)
      if (snapshotAgeMs < 8000) {
        setContact((prev) => (sameContact(prev, current) ? prev : current));
      }
    }, 800);

    const { contact: initial, snapshotAgeMs } = pollCurrentContact();
    if (initial && snapshotAgeMs < 8000) setContact(initial);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      subscribedContactIds.current.clear();
    };
  }, []);

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
          // API says no active contact — only clear if Streams snapshot is also stale/empty
          const { contact: streamsContact, snapshotAgeMs } = pollCurrentContact();
          if (!streamsContact || snapshotAgeMs > 8000) {
            setContact((prev) => (prev === null ? prev : null));
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
        };

        setContact((prev) => (sameContact(prev, apiContact) ? prev : apiContact));
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
  }, [user?.username]);

  return contact;
}
