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
    const contactId = c.getContactId();
    const channel = c.getType();
    const state = c.getState().type;
    const queue = c.getQueue?.()?.name || "";

    const conn = c.getInitialConnection?.();
    const endpoint = conn?.getEndpoint?.();
    const customerPhone = endpoint?.phoneNumber || null;

    return {
      contactId,
      channel,
      state,
      customerPhone,
      queueName: queue,
    };
  } catch {
    return null;
  }
}

export function useActiveContact() {
  const [contact, setContact] = useState<ActiveContact | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (typeof connect === "undefined") return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscribe = (c: any) => {
      const update = () => {
        const info = extractContact(c);
        if (info) setContact(info);
      };

      update();
      try { c.onConnecting?.(update); } catch { /* noop */ }
      try { c.onConnected?.(update); } catch { /* noop */ }
      try { c.onACW?.(update); } catch { /* noop */ }
      try { c.onRefresh?.(update); } catch { /* noop */ }
      try { c.onEnded?.(() => setContact(null)); } catch { /* noop */ }
      try { c.onDestroy?.(() => setContact(null)); } catch { /* noop */ }
    };

    // Register handler for NEW contacts that arrive
    try {
      connect.contact?.(subscribe);
    } catch {
      /* noop */
    }

    // ALSO pick up any EXISTING contact the agent already has
    // (important when we navigate to /agent while a call is in progress)
    try {
      connect.agent?.((agent) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contacts = (agent as any).getContacts?.() as any[] | undefined;
        if (contacts && contacts.length > 0) {
          contacts.forEach(subscribe);
        }
      });
    } catch {
      /* noop */
    }

    // Additionally, poll the agent every 2s while we don't have a contact
    // (catch-all for any missed events during CCP init / page navigation)
    intervalRef.current = setInterval(() => {
      try {
        connect.agent?.((agent) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const contacts = (agent as any).getContacts?.() as any[] | undefined;
          if (contacts && contacts.length > 0) {
            const info = extractContact(contacts[0]);
            if (info) setContact(info);
          }
        });
      } catch {
        /* noop */
      }
    }, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return contact;
}
