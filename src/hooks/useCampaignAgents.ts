import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export interface CampaignAgent {
  userId: string;
  username: string;
  routingProfileId: string;
  queueId: string;
  addedQueueToRoutingProfile: boolean;
  priority: number;
  delay: number;
  addedAt: string;
  addedBy: string;
}

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      (json && (json.error || json.message)) || `HTTP ${r.status}`
    );
  return json;
}

export function useCampaignAgents(campaignId: string | null, refreshMs = 10000) {
  const [agents, setAgents] = useState<CampaignAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const { user } = useAuth();

  const refresh = useCallback(async () => {
    if (!campaignId) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.getCampaignAgents) return;
    try {
      const r = await fetch(
        `${endpoints.getCampaignAgents}?campaignId=${encodeURIComponent(campaignId)}`
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setAgents(j.agents || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [campaignId]);

  useEffect(() => {
    if (!campaignId) {
      setAgents([]);
      return;
    }
    setLoading(true);
    refresh().finally(() => setLoading(false));
    if (refreshMs > 0) {
      const id = setInterval(refresh, refreshMs);
      return () => clearInterval(id);
    }
  }, [campaignId, refresh, refreshMs]);

  const assign = useCallback(
    async (
      add: string[] = [],
      remove: string[] = [],
      opts: {
        /** Per-agent queue assignment. When the campaign's flow routes
         *  to multiple queues, the UI lets the admin pick which queue
         *  each agent will service. Keys are userIds, values queueIds.
         *  When absent for a user, backend falls back to the campaign's
         *  campaignQueueId. */
        queueByUserId?: Record<string, string>;
        priority?: number;
        delay?: number;
      } = {}
    ) => {
      if (!campaignId) throw new Error("campaignId missing");
      const endpoints = getApiEndpoints();
      if (!endpoints?.assignCampaignAgents) throw new Error("No endpoint");
      setMutating(true);
      try {
        const res = await postJson(endpoints.assignCampaignAgents, {
          campaignId,
          add,
          remove,
          queueByUserId: opts.queueByUserId,
          priority: opts.priority ?? 5,
          delay: opts.delay ?? 0,
          actor: user?.username || "unknown",
        });
        await refresh();
        return res;
      } finally {
        setMutating(false);
      }
    },
    [campaignId, user?.username, refresh]
  );

  return { agents, loading, error, mutating, refresh, assign };
}
