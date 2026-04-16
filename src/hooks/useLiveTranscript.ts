import { useState, useEffect, useRef } from "react";
import type { LiveTranscriptData } from "@/types/live-transcript";
import { getApiEndpoints } from "@/lib/api";

const POLL_MS = 5000; // Poll every 5 seconds — Connect ListRealtimeContactAnalysisSegments is throttled

export function useLiveTranscript(contactId: string | null) {
  const [data, setData] = useState<LiveTranscriptData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  // Track latest data via ref so the fetch closure can decide whether to surface errors
  const dataRef = useRef<LiveTranscriptData | null>(null);

  useEffect(() => {
    if (!contactId) {
      setData(null);
      dataRef.current = null;
      setError(null);
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
        const json = await r.json().catch(() => ({}));

        // Backend returns 200 with {throttled: true} when Contact Lens is rate-limiting.
        // Keep showing the previous transcript instead of flashing an error.
        if (json?.throttled) {
          setError(null);
          return;
        }

        if (!r.ok) {
          // Only surface the error if we never had transcript data — otherwise keep what we have.
          if (!dataRef.current) {
            setError(`HTTP ${r.status}`);
          }
          return;
        }

        dataRef.current = json;
        setData(json);
        setError(null);
      } catch (e) {
        if (!dataRef.current) {
          setError(e instanceof Error ? e.message : "Failed");
        }
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
