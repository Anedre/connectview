import { useEffect, useState, useCallback } from "react";
import { getApiEndpoints } from "@/lib/api";
import type { Campaign } from "./useCampaigns";

export interface LiveContact {
  rowId: string;
  phone: string;
  customerName: string;
  agentUsername?: string;
  connectContactId?: string;
  status: string;
}

export interface CampaignStatsData {
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

export function useCampaignStats(
  campaignId: string | null,
  refreshIntervalMs = 3000
) {
  const [data, setData] = useState<CampaignStatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!campaignId) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.getCampaignStats) return;
    try {
      const r = await fetch(
        `${endpoints.getCampaignStats}?campaignId=${encodeURIComponent(campaignId)}`
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [campaignId]);

  useEffect(() => {
    if (!campaignId) {
      setData(null);
      return;
    }
    setLoading(true);
    refresh().finally(() => setLoading(false));
    if (refreshIntervalMs > 0) {
      const id = setInterval(refresh, refreshIntervalMs);
      return () => clearInterval(id);
    }
  }, [campaignId, refresh, refreshIntervalMs]);

  return { data, loading, error, refresh };
}
