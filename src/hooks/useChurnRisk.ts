import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface AtRiskCustomer {
  customerPhone: string;
  name: string;
  contactCount: number;
  lastSentiment: string;
  daysSinceContact: number;
  riskScore: number;
}

export interface ChurnRiskData {
  rangeDays: number;
  totalCustomersAnalyzed: number;
  atRisk: AtRiskCustomer[];
}

export function useChurnRisk(days = 30, limit = 5, minRisk = 40) {
  const [data, setData] = useState<ChurnRiskData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.getChurnRisk) return;

    let cancelled = false;
    setLoading(true);
    fetch(
      `${endpoints.getChurnRisk}?days=${days}&limit=${limit}&minRisk=${minRisk}`
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: ChurnRiskData) => {
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
  }, [days, limit, minRisk]);

  return { data, loading, error };
}
