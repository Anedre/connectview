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

// Poll the DataProvider directly - doesn't require waiting for agent callback
function pollCurrentContact(): ActiveContact | null {
  try {
    if (typeof connect === "undefined") return null;

    // Method 1: try core.getAgentDataProvider (most reliable)
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
          return {
            contactId: c.contactId || "",
            channel: c.type || "VOICE",
            state: c.state?.type || "",
            customerPhone:
              c.connections?.find(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (conn: any) => conn.type === "inbound" || conn.initial
              )?.endpoint?.phoneNumber ||
              c.connections?.[0]?.endpoint?.phoneNumber ||
              null,
            queueName: c.queue?.name || "",
          };
        }
      } catch {
        // fall through to method 2
      }
    }

    // Method 2: Fallback with agent().getContacts()
    let result: ActiveContact | null = null;
    try {
      connect.agent?.((a) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contacts = (a as any).getContacts?.() as any[] | undefined;
        if (contacts && contacts.length > 0) {
          result = extractContact(contacts[0]);
        }
      });
    } catch {
      // ignore
    }
    return result;
  } catch {
    return null;
  }
}

export function useActiveContact() {
  const [contact, setContact] = useState<ActiveContact | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (typeof connect === "undefined") return;

    // Register handler for NEW contacts
    try {
      connect.contact?.((c) => {
        const update = () => {
          const info = extractContact(c);
          if (info) setContact(info);
        };
        update();
        try { c.onConnecting?.(update); } catch { /* noop */ }
        try { c.onConnected?.(update); } catch { /* noop */ }
        try { c.onACW?.(update); } catch { /* noop */ }
        try { c.onEnded?.(() => setContact(null)); } catch { /* noop */ }
        try { c.onDestroy?.(() => setContact(null)); } catch { /* noop */ }
      });
    } catch {
      /* noop */
    }

    // Poll every 1.5s using the data provider (catches existing contacts)
    intervalRef.current = setInterval(() => {
      const current = pollCurrentContact();
      if (current) {
        setContact((prev) => {
          if (prev?.contactId === current.contactId && prev?.state === current.state) {
            return prev;
          }
          return current;
        });
      } else {
        setContact((prev) => (prev ? null : prev));
      }
    }, 1500);

    // Initial poll
    const initial = pollCurrentContact();
    if (initial) setContact(initial);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return contact;
}
