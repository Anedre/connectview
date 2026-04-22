import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface WellnessData {
  agentKey: string;
  contactsToday: number;
  focusMinutes: number;
  moodScore: number;
  energy: number;
  negativeContactCount: number;
  needsBreak: boolean;
}

// Pass the Connect agent's userId (UUID). process-contact-event stores the
// agent UUID (from the agent ARN) as the GSI partition key in DynamoDB, so
// username won't match.
export function useAgentWellness(userId: string | null) {
  const [data, setData] = useState<WellnessData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setData(null);
      return;
    }
    const endpoints = getApiEndpoints();
    if (!endpoints?.getAgentWellness) return;

    let cancelled = false;
    setLoading(true);
    fetch(
      `${endpoints.getAgentWellness}?userId=${encodeURIComponent(userId)}`
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: WellnessData) => {
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
  }, [userId]);

  return { data, loading, error };
}
