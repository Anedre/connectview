import { useEffect, useState, useCallback } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface Campaign {
  campaignId: string;
  name: string;
  description?: string;
  sourcePhoneNumber: string;
  contactFlowId: string;
  contactFlowName?: string;
  dialMode: string;
  concurrency: number;
  timezone: string;
  windowStartHour: number;
  windowEndHour: number;
  status: "DRAFT" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED";
  createdAt: string;
  createdBy?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  totalContacts: number;
  pendingCount: number;
  dialingCount: number;
  connectedCount: number;
  doneCount: number;
  failedCount: number;
  noAnswerCount: number;
  skippedCount?: number;
}

export function useCampaigns(refreshIntervalMs = 5000) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.listCampaigns) return;
    try {
      const r = await fetch(endpoints.listCampaigns);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setCampaigns(j.campaigns || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
    if (refreshIntervalMs > 0) {
      const id = setInterval(refresh, refreshIntervalMs);
      return () => clearInterval(id);
    }
  }, [refresh, refreshIntervalMs]);

  return { campaigns, loading, error, refresh };
}
