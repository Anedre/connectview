import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * useCallHistory — trae el historial de contactos de voz/omnicanal de un cliente
 * (get-contact-history) y lo expone como filas crudas. Compartido por la vista
 * de Llamadas (calendario + reproductor), el mapa de actividad y la línea de
 * tiempo del Resumen.
 *
 * PERF (#grabaciones): el Resumen pedía este endpoint 3× en paralelo (conteos en
 * useLeadOverview + heatmap + línea de tiempo en ConversationCanvas). Ahora todos
 * pasan por `fetchContactHistory`, que DEDUPLICA las llamadas en vuelo (1 sola
 * request real) y cachea el resultado 60s (volver a un contacto = instantáneo).
 */
export interface CallHistoryRow {
  contactId: string;
  channel: string;
  initiationTimestamp: string;
  disconnectTimestamp?: string;
  subChannel?: string;
  duration: number;
  agentUsername: string;
  queueName: string;
  initiationMethod?: string;
  disconnectReason?: string;
  hasRecording: boolean;
  /** Sentimiento de Contact Lens (POSITIVE/NEGATIVE/MIXED/NEUTRAL) — para el heatmap por tono. */
  sentiment?: string;
}

const TTL_MS = 60_000;
const cache = new Map<string, { ts: number; rows: CallHistoryRow[] }>();
const inflight = new Map<string, Promise<CallHistoryRow[]>>();

/** Fetch compartido con dedup de requests en vuelo + caché por teléfono (60s).
 *  `fresh` saltea ambos cachés (frontend y backend, con ?fresh=1) → recálculo real. */
export async function fetchContactHistory(phone: string, opts?: { fresh?: boolean }): Promise<CallHistoryRow[]> {
  if (!opts?.fresh) {
    const cached = cache.get(phone);
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.rows;
    const existing = inflight.get(phone);
    if (existing) return existing;
  }

  const url = getApiEndpoints()?.getContactHistory;
  if (!url) throw new Error("Endpoint getContactHistory no configurado");

  const p = (async () => {
    const r = await authedFetch(`${url}?phone=${encodeURIComponent(phone)}&limit=200${opts?.fresh ? "&fresh=1" : ""}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`);
    const rows: CallHistoryRow[] = Array.isArray(j.contacts) ? j.contacts : [];
    cache.set(phone, { ts: Date.now(), rows });
    return rows;
  })();
  if (!opts?.fresh) inflight.set(phone, p);
  try {
    return await p;
  } finally {
    if (!opts?.fresh) inflight.delete(phone);
  }
}

/** Invalida el caché (un teléfono o todo) — para forzar un refresh real. */
export function invalidateContactHistory(phone?: string) {
  if (phone) cache.delete(phone);
  else cache.clear();
}

export function useCallHistory(phone: string | null) {
  const [rows, setRows] = useState<CallHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows([]); setError(null);
    if (!phone) return;
    let alive = true;
    setLoading(true);
    fetchContactHistory(phone)
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Error"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [phone]);

  return { rows, loading, error };
}
