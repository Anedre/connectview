import { useEffect, useRef, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

/**
 * useWaitingPriority — for the supervision "Contactos en espera" table, derive a
 * REAL customer-based priority per phone from Customer Profiles history.
 *
 * There is no VIP field in the data (the profile object type only maps
 * callDisposition / custID / iframeUrl / phone), so "priority" is derived from
 * the customer's CTR history instead — a returning caller, or one who abandoned
 * before, is operationally more important than a first-time unknown number:
 *   - crit  → ≥3 contacts in 30d, OR abandoned before (with prior history)
 *   - high  → known customer with any prior contact
 *   - normal→ unknown / first-time caller
 *
 * Reuses the existing `lookup-customer-profile` endpoint (already permissioned),
 * so no extra IAM/backend is needed. Results are cached process-wide by phone —
 * a waiting contact keeps the same number across polls, so each phone is fetched
 * at most once (with a TTL so long-lived tabs refresh eventually).
 */

export type PrioritySeverity = 0 | 1 | 2; // normal | high | crit

export interface CustomerSignal {
  known: boolean;
  total: number;
  recent30d: number;
  abandonedBefore: boolean;
  severity: PrioritySeverity;
  /** Short human reason (Spanish) for why it's prioritized; "" when normal. */
  reason: string;
}

interface CacheEntry {
  signal: CustomerSignal;
  at: number;
}

const TTL_MS = 10 * 60 * 1000;
const signalCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CustomerSignal>>();

const UNKNOWN: CustomerSignal = {
  known: false,
  total: 0,
  recent30d: 0,
  abandonedBefore: false,
  severity: 0,
  reason: "",
};

function deriveSignal(stats: {
  total?: number;
  in30d?: number;
  abandonedCount?: number;
} | null): CustomerSignal {
  if (!stats) return { ...UNKNOWN, known: true };
  const total = stats.total ?? 0;
  const recent30d = stats.in30d ?? 0;
  const abandonedBefore = (stats.abandonedCount ?? 0) > 0;

  let severity: PrioritySeverity = 0;
  let reason = "";
  if (recent30d >= 3) {
    severity = 2;
    reason = `${recent30d}º contacto este mes`;
  } else if (abandonedBefore && total >= 1) {
    severity = 2;
    reason = "Abandonó una llamada antes";
  } else if (total >= 1) {
    severity = 1;
    reason = total === 1 ? "Cliente recurrente" : `Cliente recurrente · ${total} contactos`;
  }
  return { known: true, total, recent30d, abandonedBefore, severity, reason };
}

function fresh(phone: string): CustomerSignal | undefined {
  const e = signalCache.get(phone);
  if (e && Date.now() - e.at < TTL_MS) return e.signal;
  return undefined;
}

async function fetchSignal(phone: string, endpoint: string): Promise<CustomerSignal> {
  const cached = fresh(phone);
  if (cached) return cached;
  let pending = inflight.get(phone);
  if (!pending) {
    pending = (async () => {
      let signal = UNKNOWN;
      try {
        const res = await fetch(`${endpoint}?phone=${encodeURIComponent(phone)}`);
        if (res.ok) {
          const data = await res.json();
          signal = data?.profile ? deriveSignal(data?.stats ?? null) : UNKNOWN;
        }
      } catch {
        signal = UNKNOWN;
      } finally {
        inflight.delete(phone);
      }
      signalCache.set(phone, { signal, at: Date.now() });
      return signal;
    })();
    inflight.set(phone, pending);
  }
  return pending;
}

export function useWaitingPriority(phones: string[]): Record<string, CustomerSignal> {
  const [resolved, setResolved] = useState<Record<string, CustomerSignal>>(() => {
    const seed: Record<string, CustomerSignal> = {};
    for (const ph of phones) {
      const s = fresh(ph);
      if (s) seed[ph] = s;
    }
    return seed;
  });
  const versionRef = useRef(0);

  useEffect(() => {
    const endpoint = getApiEndpoints()?.lookupCustomerProfile;
    if (!endpoint) return;
    const unique = Array.from(new Set(phones.filter(Boolean)));
    if (unique.length === 0) return;

    // Surface any already-cached signals immediately.
    setResolved((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const p of unique) {
        const s = fresh(p);
        if (s && next[p] !== s) { next[p] = s; changed = true; }
      }
      return changed ? next : prev;
    });

    const todo = unique.filter((p) => !fresh(p));
    if (todo.length === 0) return;

    versionRef.current += 1;
    const myVersion = versionRef.current;
    let cancelled = false;
    const queue = [...todo];
    let inflightCount = 0;

    const drain = () => {
      while (queue.length > 0 && inflightCount < 4) {
        const phone = queue.shift()!;
        inflightCount += 1;
        fetchSignal(phone, endpoint)
          .then((signal) => {
            if (cancelled || versionRef.current !== myVersion) return;
            setResolved((prev) => ({ ...prev, [phone]: signal }));
          })
          .finally(() => {
            inflightCount -= 1;
            if (!cancelled && versionRef.current === myVersion) drain();
          });
      }
    };
    drain();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phones.join("|")]);

  return resolved;
}
