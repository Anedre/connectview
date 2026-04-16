import { useState, useEffect, useRef } from "react";
import type { LiveTranscriptData } from "@/types/live-transcript";
import { getApiEndpoints } from "@/lib/api";

// Adaptive polling: aim for near-real-time, back off on throttling.
const POLL_FAST_MS = 1500;   // happy path — feels live
const POLL_SLOW_MS = 5000;   // back off when Contact Lens is rate-limiting

export function useLiveTranscript(contactId: string | null) {
  const [data, setData] = useState<LiveTranscriptData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Track latest data via ref so the fetch closure can decide whether to surface errors
  const dataRef = useRef<LiveTranscriptData | null>(null);

  useEffect(() => {
    if (!contactId) {
      setData(null);
      dataRef.current = null;
      setError(null);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return;
    }

    const endpoints = getApiEndpoints();
    if (!endpoints?.getLiveTranscript) return;

    let cancelled = false;
    let nextDelay = POLL_FAST_MS;

    const fetchTranscript = async () => {
      let throttled = false;
      try {
        const r = await fetch(
          `${endpoints.getLiveTranscript}?contactId=${encodeURIComponent(contactId)}`
        );
        const json = await r.json().catch(() => ({}));

        // Backend returns 200 with {throttled: true} when Contact Lens is rate-limiting.
        // Keep showing the previous transcript and slow down the next poll.
        if (json?.throttled) {
          throttled = true;
          setError(null);
          return;
        }

        if (!r.ok) {
          // Only surface the error if we never had transcript data — otherwise keep what we have.
          if (!dataRef.current) {
            setError(`HTTP ${r.status}`);
          }
          // Treat any non-OK as throttled-like for backoff purposes.
          throttled = true;
          return;
        }

        dataRef.current = json;
        setData(json);
        setError(null);
      } catch (e) {
        if (!dataRef.current) {
          setError(e instanceof Error ? e.message : "Failed");
        }
        throttled = true;
      } finally {
        setLoading(false);
        // Adaptive: speed up on success, slow down on throttling/error.
        nextDelay = throttled ? POLL_SLOW_MS : POLL_FAST_MS;
        if (!cancelled) {
          timeoutRef.current = setTimeout(fetchTranscript, nextDelay);
        }
      }
    };

    setLoading(true);
    fetchTranscript();

    return () => {
      cancelled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [contactId]);

  return { data, loading, error };
}
