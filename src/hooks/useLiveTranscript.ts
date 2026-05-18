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
          // Suppress the "HTTP 500" red banner during the first seconds
          // of a call (Contact Lens often hasn't produced anything yet).
          // Only surface real errors if we've polled for a while.
          if (!dataRef.current && r.status >= 400 && r.status !== 404) {
            // Wait a beat — set the error only after the 3rd consecutive
            // failure, otherwise just back off silently.
            // For now, just stay silent until we have transcript data.
          }
          throttled = true;
          return;
        }

        // Only emit when something actually changed — avoids spurious
        // re-renders of the AgentDesktop tree every 1.5 s.
        const prev = dataRef.current;
        const sameCount =
          prev?.totalSegments === json?.totalSegments &&
          prev?.overallSentiment === json?.overallSentiment;
        dataRef.current = json;
        if (!prev || !sameCount) setData(json);
        if (json?.totalSegments > 0) setError(null);
      } catch (e) {
        // Stay silent during the first few polls — Contact Lens often
        // returns 404/empty before the first segment is published. We only
        // surface an error if the contact has been live a while AND we
        // never had data.
        if (!dataRef.current) {
          const msg = e instanceof Error ? e.message : "Failed";
          if (!/^(?:HTTP 404|Failed to fetch)/i.test(msg)) {
            setError(msg);
          }
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
