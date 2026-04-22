import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface ContactFlowSummary {
  id: string;
  name: string;
  type: string;
  state: string;
}

export interface SourcePhone {
  phoneNumber: string;
  phoneNumberId: string;
  countryCode?: string;
  type?: string;
  description?: string;
}

export function useContactFlows() {
  const [flows, setFlows] = useState<ContactFlowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.listContactFlows) return;
    setLoading(true);
    fetch(endpoints.listContactFlows)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => setFlows(j.flows || []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  return { flows, loading, error };
}

export function useSourcePhones() {
  const [phones, setPhones] = useState<SourcePhone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.listSourcePhones) return;
    setLoading(true);
    fetch(endpoints.listSourcePhones)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => setPhones(j.phones || []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  return { phones, loading, error };
}
