import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * useSuppression — capa de datos del motor de supresión (Pilar 3 · R6). La
 * _enforcement_ (gate por el que pasa cada envío) vive en el backend
 * (`_shared/suppression.ts`); este hook administra la lista DNC + la política
 * (reglas) desde Configuración → Supresión. Ver `SuppressionManager.tsx`.
 */
export interface SuppressionEntry {
  phone: string; // dígitos normalizados (PK)
  e164?: string;
  status: "opted_out" | "quarantined" | "dnc" | "converted";
  channels: string[]; // ["whatsapp"] | ["all"] | …
  reason?: string;
  source: "inbound_keyword" | "status_webhook" | "manual" | "import" | "conversion";
  tenantId?: string;
  leadId?: string;
  createdAt: string;
  createdBy?: string;
  expiresAt?: string;
}

export interface FreqCap {
  channel: string;
  max: number;
  windowDays: number;
}
export interface QuietHours {
  channel: string;
  startHour: number;
  endHour: number;
  timezone: string;
  daysOfWeek?: number[];
}
export interface SuppressionRules {
  tenantId?: string;
  dedupWindowDays?: number;
  freqCaps?: FreqCap[];
  quietHours?: QuietHours[];
  suppressAfterConversion?: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export interface BatchSummary {
  total: number;
  willSend: number;
  excluded: {
    optOut: number;
    quarantine: number;
    dnc: number;
    dedupWindow: number;
    frequency: number;
    quietHours: number;
    converted: number;
  };
}

/** Preview honesto: corre la lista contra el motor → "de N se excluyen M".
 *  Standalone (no hook) para que el wizard de campañas lo llame directo. */
export async function previewSuppression(
  phones: string[],
  opts: { channel?: string; programId?: string } = {},
): Promise<BatchSummary | null> {
  const url = getApiEndpoints()?.manageSuppression;
  if (!url || phones.length === 0) return null;
  const r = await authedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "previewBatch",
      phones,
      channel: opts.channel || "whatsapp",
      programId: opts.programId,
    }),
  });
  const j = await r.json();
  return j.summary || null;
}

export function useSuppression() {
  const [entries, setEntries] = useState<SuppressionEntry[]>([]);
  const [rules, setRules] = useState<SuppressionRules | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const url = getApiEndpoints()?.manageSuppression;
    if (!url) {
      setError("Endpoint de supresión no configurado");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [le, lr] = await Promise.all([
        authedFetch(url).then((r) => r.json()),
        authedFetch(`${url}?rules=1`).then((r) => r.json()),
      ]);
      setEntries(Array.isArray(le.entries) ? le.entries : []);
      setRules(lr.rules || null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la lista");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(
    async (input: {
      phone: string;
      channels?: string[];
      reason?: string;
      status?: SuppressionEntry["status"];
      actor?: string;
    }) => {
      const url = getApiEndpoints()?.manageSuppression;
      if (!url) return false;
      const r = await authedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await load();
      return true;
    },
    [load],
  );

  const remove = useCallback(
    async (phone: string) => {
      const url = getApiEndpoints()?.manageSuppression;
      if (!url) return false;
      const r = await authedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", phone }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await load();
      return true;
    },
    [load],
  );

  /** Guarda la política (reglas). Devuelve las reglas guardadas. */
  const saveRules = useCallback(async (patch: Partial<SuppressionRules>, actor?: string) => {
    const url = getApiEndpoints()?.manageSuppression;
    if (!url) return null;
    const r = await authedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveRules", rules: patch, actor }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
    setRules(j.rules || null);
    return j.rules as SuppressionRules;
  }, []);

  return { entries, rules, loading, error, reload: load, add, remove, saveRules };
}
