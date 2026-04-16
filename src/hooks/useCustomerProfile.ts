import { useState, useEffect } from "react";
import type { CustomerProfile } from "@/types/customer-profile";
import { getApiEndpoints } from "@/lib/api";

export function useCustomerProfile(phone: string | null) {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!phone) {
      setProfile(null);
      return;
    }

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
        setProfile(data.profile);
      })
      .catch((err) => {
        setError(err.message);
        setProfile(null);
      })
      .finally(() => setLoading(false));
  }, [phone]);

  return { profile, loading, error };
}
