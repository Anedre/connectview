import { useState, useEffect, useRef } from "react";
import type { CustomerProfile } from "@/types/customer-profile";
import { getApiEndpoints } from "@/lib/api";

export function useCustomerProfile(phone: string | null) {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track which phone the current profile was fetched for. Lets us
  // distinguish "phone went null briefly during a poll cycle" (keep
  // current profile, the next non-null phone will refresh it) from
  // "phone genuinely changed to a different customer" (must clear).
  const fetchedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!phone) {
      // Don't aggressively reset profile when phone goes null — the
      // upstream activeContact can briefly oscillate to null between
      // polls and we don't want the customer card to flash "Sin
      // contacto" every time. The next non-null phone will either
      // re-fetch (if different) or just no-op (if same).
      return;
    }

    // Phone changed to a different customer → drop the old profile so
    // we don't show last customer's data while fetching the new one.
    if (fetchedForRef.current && fetchedForRef.current !== phone) {
      setProfile(null);
    }
    fetchedForRef.current = phone;

    const endpoints = getApiEndpoints();
    if (!endpoints?.lookupCustomerProfile) return;

    setLoading(true);
    setError(null);

    fetch(
      `${endpoints.lookupCustomerProfile}?phone=${encodeURIComponent(phone)}`
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        // Only commit if we're still on this phone (avoids out-of-order
        // responses overwriting a newer customer).
        if (fetchedForRef.current === phone) {
          setProfile(data.profile);
        }
      })
      .catch((err) => {
        if (fetchedForRef.current === phone) {
          setError(err.message);
          // Don't clear profile on transient error — keep last good data.
        }
      })
      .finally(() => setLoading(false));
  }, [phone]);

  return { profile, loading, error };
}
