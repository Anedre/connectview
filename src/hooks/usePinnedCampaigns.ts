import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import type { CampaignStatsData } from "./useCampaignStats";

/**
 * Pinned campaigns = campaigns the admin explicitly kept visible in the
 * Queue Manager, even after they transitioned out of RUNNING/PAUSED. This
 * hook fetches `get-campaign-stats` for each pinned id so a historical
 * summary card can render beside the live ones.
 *
 * Polls less frequently than live data (10s) since a COMPLETED campaign
 * doesn't change much — but still refreshes to catch late-arriving retries
 * or final reason updates.
 */
export function usePinnedCampaigns(
  campaignIds: string[],
  refreshIntervalMs = 10_000
) {
  const [data, setData] = useState<Map<string, CampaignStatsData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // We depend on a serialized key so the effect doesn't re-run on every new
  // array instance (React creates a fresh one on every parent render).
  const idsKey = campaignIds.slice().sort().join(",");

  const refresh = useCallback(async () => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) {
      setData(new Map());
      return;
    }
    const endpoints = getApiEndpoints();
    if (!endpoints?.getCampaignStats) return;
    try {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const r = await fetch(
              `${endpoints.getCampaignStats}?campaignId=${encodeURIComponent(id)}`
            );
            if (!r.ok) return null;
            return (await r.json()) as CampaignStatsData;
          } catch {
            return null;
          }
        })
      );
      const next = new Map<string, CampaignStatsData>();
      for (const stats of results) {
        if (stats?.campaign?.campaignId) {
          next.set(stats.campaign.campaignId, stats);
        }
      }
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [idsKey]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (refreshIntervalMs <= 0) return;
    const id = setInterval(refresh, refreshIntervalMs);
    return () => clearInterval(id);
  }, [refresh, refreshIntervalMs]);

  return { data, loading, error, refresh };
}
