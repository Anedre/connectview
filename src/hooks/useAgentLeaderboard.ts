import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface LeaderboardAgent {
  rank: number;
  agentId: string;
  username: string;
  contactCount: number;
  totalMinutes: number;
  sentimentScore: number | null;
  changePct: number;
}

export interface LeaderboardBadges {
  onFire: number;
  topCsat: number;
  risingStar: number;
}

export interface LeaderboardData {
  rangeDays: number;
  totalAgents: number;
  totalContacts: number;
  leaderboard: LeaderboardAgent[];
  badges: LeaderboardBadges;
}

export function useAgentLeaderboard(days = 7, limit = 10) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.getAgentLeaderboard) return;

    let cancelled = false;
    setLoading(true);
    fetch(
      `${endpoints.getAgentLeaderboard}?days=${days}&limit=${limit}`
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: LeaderboardData) => {
        if (!cancelled) {
          setData(j);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days, limit]);

  return { data, loading, error };
}
