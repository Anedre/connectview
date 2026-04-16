import { useState, useEffect, useRef } from "react";

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

// Poll the DataProvider synchronously
function pollCurrentContact(): ActiveContact | null {
  try {
    if (typeof connect === "undefined") return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core = (connect as any).core;
    if (core?.getAgentDataProvider) {
      try {
        const dp = core.getAgentDataProvider();
        const data = dp?.getAgentData?.();
        const snapshot = data?.snapshot || data;
        const contacts = snapshot?.contacts || [];
        if (contacts.length > 0) {
          const c = contacts[0];

          // Extract customer phone from connections
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
            contactId: c.contactId || "",
            channel: c.type || "VOICE",
            state: c.state?.type || "",
            customerPhone,
            queueName: c.queue?.name || "",
          };
        }
      } catch {
        // fall through
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function useActiveContact() {
  const [contact, setContact] = useState<ActiveContact | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const subscribedContactIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof connect === "undefined") return;

    // Subscribe to a single contact's events
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscribeToContact = (c: any) => {
      const contactId = c.getContactId?.();
      if (!contactId || subscribedContactIds.current.has(contactId)) return;
      subscribedContactIds.current.add(contactId);

      const refresh = () => {
        const info = extractContact(c);
        if (info) setContact(info);
      };

      // Try to read immediately
      refresh();

      // Attach all lifecycle events
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

    // 1. Register for NEW contacts
    try {
      connect.contact?.(subscribeToContact);
    } catch { /* noop */ }

    // 2. Subscribe to the event bus for contact state changes
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
              if (info) setContact(info);
            });
          } catch { /* noop */ }
        });
      }
    } catch { /* noop */ }

    // 3. Aggressive polling fallback (every 800ms)
    //    Uses the DataProvider which is synchronous and always current
    intervalRef.current = setInterval(() => {
      const current = pollCurrentContact();
      setContact((prev) => {
        if (!current && !prev) return prev;
        if (!current && prev) return null;
        if (
          current &&
          prev &&
          prev.contactId === current.contactId &&
          prev.state === current.state &&
          prev.customerPhone === current.customerPhone
        ) {
          return prev;
        }
        return current;
      });
    }, 800);

    // 4. Initial poll on mount
    const initial = pollCurrentContact();
    if (initial) setContact(initial);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      subscribedContactIds.current.clear();
    };
  }, []);

  return contact;
}
