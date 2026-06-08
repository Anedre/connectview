import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

/**
 * A single campaign lead the agent owns (manual mode). Returned by the
 * MyCampaignLeadsPanel; one entry per pending contact pre-assigned to
 * this agent across all of their manual-mode campaigns.
 */
export interface MyLead {
  campaignId: string;
  campaignName: string;
  rowId: string;
  phone: string;
  customerName: string;
  attributes: Record<string, string>;
  /** ISO timestamp the row was created — used to sort FIFO. */
  createdAt: string;
}

interface CampaignSummary {
  campaignId: string;
  name: string;
  status: string;
  dialMode: string;
}

/**
 * Collects all `pending` contacts that are pre-assigned to the logged-in
 * agent across every RUNNING manual-mode campaign. Polls on a short
 * interval so the panel feels live as the dialer fills buckets in the
 * background.
 *
 * Implementation note: there's no single endpoint that returns "my
 * leads" — we fan out: listCampaigns (filtered manual+running) then
 * one getCampaignContacts call per campaign with status=pending. For
 * small campaign counts (<20) this is fine; if it scales up we'll need
 * a dedicated Lambda with a GSI on (assignedAgentUserId, status).
 */
export function useMyCampaignLeads(refreshMs = 5000) {
  const { user } = useAuth();
  const userId = user?.userId;
  const [leads, setLeads] = useState<MyLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.listCampaigns || !endpoints?.getCampaignContacts) return;

    try {
      // 1. Get RUNNING campaigns. We filter manual mode client-side so
      //    we don't need a new server-side endpoint just for this view.
      const r = await fetch(`${endpoints.listCampaigns}?status=RUNNING`);
      if (!r.ok) throw new Error(`listCampaigns HTTP ${r.status}`);
      const j = await r.json();
      const campaigns = (j.campaigns || []) as CampaignSummary[];
      const manual = campaigns.filter((c) => c.dialMode === "manual");

      // 2. For each manual campaign, pull pending contacts and keep
      //    only the ones pre-assigned to this agent.
      const out: MyLead[] = [];
      for (const camp of manual) {
        const rr = await fetch(
          `${endpoints.getCampaignContacts}?campaignId=${encodeURIComponent(camp.campaignId)}&status=pending&limit=200`
        );
        if (!rr.ok) continue;
        const jj = await rr.json();
        const rows = (jj.contacts || []) as Array<{
          rowId: string;
          phone: string;
          customerName?: string;
          attributes?: Record<string, string>;
          assignedAgentUserId?: string;
          createdAt?: string;
          nextRetryAt?: string;
        }>;
        const nowIso = new Date().toISOString();
        for (const c of rows) {
          if (c.assignedAgentUserId !== userId) continue;
          // Reagendados: ocultos hasta su hora (nextRetryAt futuro).
          if (c.nextRetryAt && c.nextRetryAt > nowIso) continue;
          out.push({
            campaignId: camp.campaignId,
            campaignName: camp.name,
            rowId: c.rowId,
            phone: c.phone,
            customerName: c.customerName || "",
            attributes: c.attributes || {},
            createdAt: c.createdAt || "",
          });
        }
      }
      // FIFO within a campaign, but interleave by createdAt so the
      // oldest leads bubble up regardless of campaign.
      out.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      setLeads(out);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setLeads([]);
      return;
    }
    setLoading(true);
    refresh().finally(() => setLoading(false));
    if (refreshMs > 0) {
      const id = setInterval(refresh, refreshMs);
      return () => clearInterval(id);
    }
  }, [userId, refresh, refreshMs]);

  /** Tell the backend to mark a lead as dialing + return its phone so
   *  the caller can pipe it into the Streams placeCall flow. */
  const callLead = useCallback(
    async (lead: MyLead): Promise<string> => {
      const endpoints = getApiEndpoints();
      if (!endpoints?.editCampaignContacts)
        throw new Error("editCampaignContacts endpoint missing");
      if (!userId) throw new Error("no userId");
      const r = await fetch(endpoints.editCampaignContacts, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "manual-call",
          campaignId: lead.campaignId,
          rowId: lead.rowId,
          userId,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      // Refresh so the row drops out of the panel (now `dialing`).
      refresh();
      return j.phone as string;
    },
    [userId, refresh]
  );

  /** Mark a lead as skipped. Terminal status, no retry. */
  const skipLead = useCallback(
    async (lead: MyLead, reason = ""): Promise<void> => {
      const endpoints = getApiEndpoints();
      if (!endpoints?.editCampaignContacts)
        throw new Error("editCampaignContacts endpoint missing");
      if (!userId) throw new Error("no userId");
      const r = await fetch(endpoints.editCampaignContacts, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "manual-skip",
          campaignId: lead.campaignId,
          rowId: lead.rowId,
          userId,
          reason,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      refresh();
    },
    [userId, refresh]
  );

  /** Reagendar — el lead vuelve a la lista del agente a partir de nextRetryAt. */
  const rescheduleLead = useCallback(
    async (lead: MyLead, nextRetryAt: string): Promise<void> => {
      const endpoints = getApiEndpoints();
      if (!endpoints?.editCampaignContacts)
        throw new Error("editCampaignContacts endpoint missing");
      if (!userId) throw new Error("no userId");
      const r = await fetch(endpoints.editCampaignContacts, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "manual-reschedule",
          campaignId: lead.campaignId,
          rowId: lead.rowId,
          userId,
          nextRetryAt,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      refresh();
    },
    [userId, refresh]
  );

  return { leads, loading, error, refresh, callLead, skipLead, rescheduleLead };
}
