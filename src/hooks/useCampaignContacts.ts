import { useEffect, useState, useCallback } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface CampaignContactRow {
  campaignId: string;
  rowId: string;
  phone: string;
  customerName: string;
  customAttributes: Record<string, string>;
  status: "pending" | "dialing" | "connected" | "done" | "no_answer" | "failed";
  attempts: number;
  createdAt: string;
  lastAttemptAt?: string;
  nextRetryAt?: string;
  connectContactId?: string;
  /** Username of the agent who took the call (set when status=connected/done).
   *  Legacy rows may have a UUID here instead — the table render handles
   *  that gracefully. */
  agentUsername?: string;
  /** When the campaign uses the per-agent-bucket dialing strategy, this is
   *  the user ID the row was pre-assigned to (still a UUID, not a name —
   *  it's the Connect user identifier from the agent assignment table). */
  assignedAgentUserId?: string;
  disconnectReason?: string;
  lastError?: string;
}

export function useCampaignContacts(
  campaignId: string | null,
  statusFilter?: string | null,
  refreshIntervalMs = 5000
) {
  const [contacts, setContacts] = useState<CampaignContactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!campaignId) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.getCampaignContacts) return;
    try {
      const qs = new URLSearchParams({ campaignId });
      if (statusFilter) qs.set("status", statusFilter);
      const r = await fetch(`${endpoints.getCampaignContacts}?${qs.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setContacts(j.contacts || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [campaignId, statusFilter]);

  useEffect(() => {
    if (!campaignId) {
      setContacts([]);
      return;
    }
    setLoading(true);
    refresh().finally(() => setLoading(false));
    if (refreshIntervalMs > 0) {
      const id = setInterval(refresh, refreshIntervalMs);
      return () => clearInterval(id);
    }
  }, [campaignId, statusFilter, refresh, refreshIntervalMs]);

  return { contacts, loading, error, refresh };
}
