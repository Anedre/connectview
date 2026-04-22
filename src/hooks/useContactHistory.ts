import { useState, useEffect } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface HistoricalContact {
  contactId: string;
  channel: string;
  // e.g. "WhatsApp/SMS", "Messaging API", "Outbound" — derived from Connect's
  // initiationMethod + customerEndpoint.type for CHAT contacts.
  subChannel?: string;
  initiationTimestamp: string;
  disconnectTimestamp: string;
  duration: number;
  agentUsername: string;
  queueName: string;
  initiationMethod?: string;
  disconnectReason?: string;
  customerEndpoint?: string;
  hasRecording: boolean;
}

// Connect SearchContacts API limits time range to 1345 hours (~56 days)
export function useContactHistory(phone: string | null, days = 30) {
  const [contacts, setContacts] = useState<HistoricalContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!phone) {
      setContacts([]);
      return;
    }

    const endpoints = getApiEndpoints();
    if (!endpoints?.getContactHistory) return;

    setLoading(true);
    setError(null);

    fetch(
      `${endpoints.getContactHistory}?phone=${encodeURIComponent(phone)}&days=${days}`
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setContacts(data.contacts || []))
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed");
        setContacts([]);
      })
      .finally(() => setLoading(false));
  }, [phone, days]);

  return { contacts, loading, error };
}
