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

/** Monitoreo en vivo por agente (B): cuántos marcando/en llamada + a quién. */
export interface CampaignAgentLive {
  userId: string;
  username: string;
  queueId: string;
  queueName: string;
  dialing: number;
  connected: number;
  liveNames: string[];
}
/** Monitoreo en vivo por cola (B): agentes + actividad en vivo. */
export interface CampaignQueueLive {
  queueId: string;
  queueName: string;
  agents: number;
  dialing: number;
  connected: number;
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
    /** Pilar 3 — contactos gateados por el motor de supresión (DNC /
     *  no-tras-conversión / opt-out SF). Opcional: campañas/backends
     *  antiguos pueden no incluirlo. */
    suppressed?: number;
  };
  liveContacts: LiveContact[];
  byAgent?: CampaignAgentLive[];
  byQueue?: CampaignQueueLive[];
}

export function useCampaignStats(campaignId: string | null, refreshIntervalMs = 3000) {
  const [data, setData] = useState<CampaignStatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!campaignId) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.getCampaignStats) return;
    try {
      const r = await fetch(
        `${endpoints.getCampaignStats}?campaignId=${encodeURIComponent(campaignId)}`,
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
