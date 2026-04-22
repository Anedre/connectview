import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import type { Campaign } from "./useCampaigns";
import type { LiveContact, CampaignStatsData } from "./useCampaignStats";

// Combined view shown in Queue Manager: every RUNNING/PAUSED campaign together
// with its live counts and the contacts currently on-air / dialing.
export interface ActiveCampaignView {
  campaign: Campaign;
  counts: {
    pending: number;
    dialing: number;
    connected: number;
    done: number;
    no_answer: number;
    failed: number;
  };
  liveContacts: LiveContact[];
}

export interface ActiveCampaignsData {
  campaigns: ActiveCampaignView[];
  // Map of connectContactId → {campaignId, campaignName} so callers can attach
  // a badge to any agent card whose active contact belongs to a campaign.
  contactToCampaign: Map<
    string,
    { campaignId: string; campaignName: string }
  >;
  lastUpdatedAt: string;
}

async function fetchJson(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export function useActiveCampaigns(refreshMs = 3000) {
  const [data, setData] = useState<ActiveCampaignsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.listCampaigns || !endpoints.getCampaignStats) return;
    try {
      const listRes = await fetchJson(endpoints.listCampaigns);
      const all: Campaign[] = listRes.campaigns || [];
      // Only campaigns worth showing in a live view
      const active = all.filter(
        (c) => c.status === "RUNNING" || c.status === "PAUSED"
      );

      // Pull stats for each active campaign in parallel
      const statsResults = await Promise.all(
        active.map(async (c) => {
          try {
            return (await fetchJson(
              `${endpoints.getCampaignStats}?campaignId=${encodeURIComponent(
                c.campaignId
              )}`
            )) as CampaignStatsData;
          } catch {
            return null;
          }
        })
      );

      const views: ActiveCampaignView[] = [];
      const contactToCampaign = new Map<
        string,
        { campaignId: string; campaignName: string }
      >();

      for (let i = 0; i < active.length; i++) {
        const stats = statsResults[i];
        if (!stats) continue;
        views.push({
          campaign: stats.campaign,
          counts: stats.counts,
          liveContacts: stats.liveContacts || [],
        });
        for (const lc of stats.liveContacts || []) {
          if (lc.connectContactId) {
            contactToCampaign.set(lc.connectContactId, {
              campaignId: stats.campaign.campaignId,
              campaignName: stats.campaign.name,
            });
          }
        }
      }

      // Sort: RUNNING first, then by newest
      views.sort((a, b) => {
        if (a.campaign.status !== b.campaign.status) {
          return a.campaign.status === "RUNNING" ? -1 : 1;
        }
        return (
          new Date(b.campaign.createdAt).getTime() -
          new Date(a.campaign.createdAt).getTime()
        );
      });

      setData({
        campaigns: views,
        contactToCampaign,
        lastUpdatedAt: new Date().toISOString(),
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
    if (refreshMs > 0) {
      const id = setInterval(refresh, refreshMs);
      return () => clearInterval(id);
    }
  }, [refresh, refreshMs]);

  return { data, loading, error, refresh };
}
