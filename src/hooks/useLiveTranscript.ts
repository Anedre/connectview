import { useState, useEffect, useRef } from "react";
import type { LiveTranscriptData } from "@/types/live-transcript";
import { getApiEndpoints } from "@/lib/api";

const POLL_MS = 3000; // Poll every 3 seconds during active contact

export function useLiveTranscript(contactId: string | null) {
  const [data, setData] = useState<LiveTranscriptData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (!contactId) {
      setData(null);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    const endpoints = getApiEndpoints();
    if (!endpoints?.getLiveTranscript) return;

    const fetchTranscript = async () => {
      try {
        const r = await fetch(
          `${endpoints.getLiveTranscript}?contactId=${encodeURIComponent(contactId)}`
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        setData(json);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      } finally {
        setLoading(false);
      }
    };

    setLoading(true);
    fetchTranscript();
    intervalRef.current = setInterval(fetchTranscript, POLL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [contactId]);

  return { data, loading, error };
}
