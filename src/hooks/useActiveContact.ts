import { useState, useEffect } from "react";

interface ActiveContact {
  contactId: string;
  channel: string;
  state: string;
  customerPhone: string | null;
  queueName: string;
}

export function useActiveContact() {
  const [contact, setContact] = useState<ActiveContact | null>(null);

  useEffect(() => {
    if (typeof connect === "undefined" || !connect.contact) return;

    connect.contact((c) => {
      const updateContact = () => {
        try {
          const contactId = c.getContactId();
          const channel = c.getType();
          const state = c.getState().type;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const queue = (c.getQueue?.() as any)?.name || "";

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const conn = (c as any).getInitialConnection?.();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const endpoint = conn?.getEndpoint?.();
          const customerPhone = endpoint?.phoneNumber || null;

          setContact({
            contactId,
            channel,
            state,
            customerPhone,
            queueName: queue,
          });
        } catch {
          // ignore
        }
      };

      updateContact();
      c.onConnecting(updateContact);
      c.onConnected(updateContact);
      c.onACW(updateContact);
      c.onEnded(() => setContact(null));
      c.onDestroy(() => setContact(null));
    });
  }, []);

  return contact;
}
