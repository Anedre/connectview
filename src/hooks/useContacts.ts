import { useState, useCallback } from "react";
import type { ContactRecord, ContactFilters } from "@/types/monitoring";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

export function useContacts() {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingLiveData, setUsingLiveData] = useState(false);

  const searchContacts = useCallback(async (filters: ContactFilters) => {
    setLoading(true);
    setError(null);

    try {
      const endpoints = getApiEndpoints();

      if (endpoints?.queryContacts) {
        const params = new URLSearchParams();
        if (filters.startDate) params.set("startDate", filters.startDate);
        if (filters.endDate) params.set("endDate", filters.endDate);
        if (filters.agentUsername)
          params.set("agentUsername", filters.agentUsername);
        if (filters.queueName) params.set("queueName", filters.queueName);
        if (filters.sentiment) params.set("sentiment", filters.sentiment);

        const response = await authedFetch(
          `${endpoints.queryContacts}?${params.toString()}`
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        setContacts(data.contacts || []);
        setUsingLiveData(true);
      } else {
        throw new Error("API not configured");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch contacts"
      );
      setContacts([]);
      setUsingLiveData(false);
    } finally {
      setLoading(false);
    }
  }, []);

  return { contacts, loading, error, usingLiveData, searchContacts };
}
