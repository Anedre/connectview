import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * useSegments — capa de datos de los SEGMENTOS dinámicos de leads (Fase 2 · F2.3).
 * Un segmento = predicado reutilizable (audiencia de campaña, entrada de journey,
 * filtro de export). El CRUD vive en `manage-leads` (folded): GET ?segments=1,
 * POST {action:saveSegment|deleteSegment}, GET ?segment=<id> (preview).
 */
export type FilterOp = "eq" | "neq" | "contains" | "gte" | "lte" | "in" | "exists" | "notexists";
export interface FilterRule {
  field: string;
  op: FilterOp;
  value?: string | number | string[];
}
export interface Segment {
  segmentId: string;
  name: string;
  description?: string;
  match: "all" | "any";
  rules: FilterRule[];
  updatedAt?: string;
  updatedBy?: string;
}

export function useSegments() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const url = getApiEndpoints()?.manageLeads;
    if (!url) {
      setError("Endpoint no configurado");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await authedFetch(`${url}?segments=1`);
      const j = await r.json();
      setSegments(Array.isArray(j.segments) ? j.segments : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los segmentos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (segment: Partial<Segment>, actor?: string) => {
      const url = getApiEndpoints()?.manageLeads;
      if (!url) return null;
      const r = await authedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveSegment", segment, actor }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await load();
      return j.segment as Segment;
    },
    [load],
  );

  const remove = useCallback(
    async (segmentId: string) => {
      const url = getApiEndpoints()?.manageLeads;
      if (!url) return false;
      const r = await authedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteSegment", segmentId }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
      return true;
    },
    [load],
  );

  /** Cuenta cuántos leads matchean un segmento guardado (preview honesto). */
  const preview = useCallback(async (segmentId: string): Promise<number | null> => {
    const url = getApiEndpoints()?.manageLeads;
    if (!url) return null;
    const r = await authedFetch(`${url}?segment=${encodeURIComponent(segmentId)}`);
    const j = await r.json();
    return typeof j?.segment?.total === "number" ? j.segment.total : (j?.leads?.length ?? null);
  }, []);

  return { segments, loading, error, reload: load, save, remove, preview };
}
