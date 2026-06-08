import { useEffect, useRef, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

/**
 * Bulk-resolve customer names by phone for the campaign contacts
 * table. Given a list of phones, fetch the Customer Profiles record
 * for each one and return a `{ phone → name }` map. Cached globally
 * across the session so navigating between campaigns doesn't re-fire
 * lookups for the same numbers.
 *
 * Used by `CampaignDetailPage` to fill the "Nombre" column even when
 * the user imported contacts as phone-only (no name field set on the
 * campaign row).
 */

// Process-wide cache. The same phone may appear in many campaigns;
// resolving it once is fine. Negative results (no profile found) are
// also cached as null so we don't retry them every render.
const nameCache = new Map<string, string | null>();
// In-flight requests so we don't double-fetch the same phone when
// it appears multiple times in the input list during the same tick.
const inflight = new Map<string, Promise<string | null>>();

async function fetchName(
  phone: string,
  endpoint: string
): Promise<string | null> {
  if (nameCache.has(phone)) return nameCache.get(phone) ?? null;
  let pending = inflight.get(phone);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(
          `${endpoint}?phone=${encodeURIComponent(phone)}`
        );
        if (!res.ok) {
          nameCache.set(phone, null);
          return null;
        }
        const data = await res.json();
        const p = data?.profile;
        if (!p) {
          nameCache.set(phone, null);
          return null;
        }
        // Preferir el nombre de PERSONA; ignorar la empresa default basura.
        const biz = p.businessName && p.businessName !== "Lead sin empresa" ? p.businessName : "";
        const name =
          [p.firstName, p.middleName, p.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() ||
          biz ||
          null;
        nameCache.set(phone, name);
        return name;
      } catch {
        nameCache.set(phone, null);
        return null;
      } finally {
        inflight.delete(phone);
      }
    })();
    inflight.set(phone, pending);
  }
  return pending;
}

export function useCustomerNamesByPhone(
  phones: string[]
): Record<string, string> {
  const [resolved, setResolved] = useState<Record<string, string>>(() => {
    // Seed from cache so the first render already has whatever we
    // resolved in a previous session within this tab.
    const seed: Record<string, string> = {};
    for (const ph of phones) {
      const cached = nameCache.get(ph);
      if (cached) seed[ph] = cached;
    }
    return seed;
  });
  // Track the latest set of phones so a slow response from a previous
  // render doesn't pollute the new state when contacts have changed.
  const versionRef = useRef(0);

  useEffect(() => {
    const endpoints = getApiEndpoints();
    const endpoint = endpoints?.lookupCustomerProfile;
    if (!endpoint) return;
    if (phones.length === 0) return;

    // Dedup phones; skip ones already cached as known (positive or null).
    const unique = Array.from(new Set(phones));
    const todo = unique.filter((p) => !nameCache.has(p));
    if (todo.length === 0) {
      // Everything cached — surface positive hits.
      setResolved((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const p of unique) {
          const v = nameCache.get(p);
          if (v && next[p] !== v) {
            next[p] = v;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      return;
    }

    versionRef.current += 1;
    const myVersion = versionRef.current;

    // Throttled batch: 4 concurrent at a time so we don't hammer the
    // Lambda when the table has 100 rows.
    let cancelled = false;
    const queue = [...todo];
    const next: Record<string, string> = {};
    let inflightCount = 0;

    const drain = () => {
      while (queue.length > 0 && inflightCount < 4) {
        const phone = queue.shift()!;
        inflightCount += 1;
        fetchName(phone, endpoint)
          .then((name) => {
            if (cancelled || versionRef.current !== myVersion) return;
            if (name) {
              next[phone] = name;
              setResolved((prev) => ({ ...prev, [phone]: name }));
            }
          })
          .finally(() => {
            inflightCount -= 1;
            if (!cancelled && versionRef.current === myVersion) drain();
          });
      }
    };
    drain();

    return () => {
      cancelled = true;
    };
    // Stringify so identical-content arrays don't trigger re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phones.join("|")]);

  return resolved;
}
