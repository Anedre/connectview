import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import type { FilterRule } from "@/hooks/useSegments";

/**
 * useJourneys — capa de datos del motor de journeys (Fase 3). El CRUD + el enrol
 * manual están folded en `manage-leads` (GET ?journeys=1, POST saveJourney/
 * deleteJourney/enrollJourney). El AVANCE lo corre el `journey-runner` (tick).
 */
export type JourneyNodeKind =
  | "entry"
  | "send"
  | "wait"
  | "branch"
  | "split"
  | "action"
  | "exit"
  // Fase 2 — bloques nuevos (send/action quedan como back-compat, notInPalette)
  | "send_whatsapp"
  | "send_email"
  | "move_stage"
  | "tag"
  | "set_field"
  | "notify_agent"
  | "enqueue_dialer"
  | "webhook"
  | "start_journey"
  | "leave"
  | "goal";
export interface JourneyNode {
  id: string;
  kind: JourneyNodeKind;
  params?: Record<string, unknown>;
  /** Posición en el lienzo — se persiste (saveJourney guarda los nodos tal cual). */
  position?: { x: number; y: number };
}
export interface JourneyEdge {
  from: string;
  to: string;
  /** Salida: branch→"yes"/"no", split A/B→"a"/"b", lineal→undefined. */
  on?: string;
}
export interface Journey {
  journeyId: string;
  name: string;
  status: "draft" | "active" | "paused";
  entry?: { trigger?: string; segmentId?: string; manual?: boolean };
  reenroll?: boolean;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  goal?: { segmentId?: string; stageId?: string };
  updatedAt?: string;
  /** Conteo de inscritos (lo agrega ?journeys=1 en 3C). */
  stats?: { total: number; active: number; done: number };
}
/** Observabilidad detallada de un journey (embudo por nodo + timeline). */
export interface JourneyStats {
  total: number;
  byStatus: Record<string, number>;
  byNode: Record<string, number>;
  recent: { leadId: string; node: string; at: string; note?: string }[];
}
export type { FilterRule };

export function useJourneys() {
  const [journeys, setJourneys] = useState<Journey[]>([]);
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
      const r = await authedFetch(`${url}?journeys=1`);
      const j = await r.json();
      setJourneys(Array.isArray(j.journeys) ? j.journeys : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los journeys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (journey: Partial<Journey>, actor?: string) => {
      const url = getApiEndpoints()?.manageLeads;
      if (!url) return null;
      const r = await authedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveJourney", journey, actor }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await load();
      return j.journey as Journey;
    },
    [load],
  );

  const remove = useCallback(
    async (journeyId: string) => {
      const url = getApiEndpoints()?.manageLeads;
      if (!url) return false;
      const r = await authedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteJourney", journeyId }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
      return true;
    },
    [load],
  );

  /** Inscribe un lead manualmente en un journey. */
  const enroll = useCallback(async (journeyId: string, leadId: string) => {
    const url = getApiEndpoints()?.manageLeads;
    if (!url) return null;
    const r = await authedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "enrollJourney", journeyId, leadId }),
    });
    return r.json();
  }, []);

  /** Observabilidad de un journey: embudo por nodo + estado + timeline (3C). */
  const stats = useCallback(async (journeyId: string): Promise<JourneyStats | null> => {
    const url = getApiEndpoints()?.manageLeads;
    if (!url) return null;
    const r = await authedFetch(`${url}?journeyStats=${encodeURIComponent(journeyId)}`);
    const j = await r.json();
    return (j?.stats as JourneyStats) || null;
  }, []);

  return { journeys, loading, error, reload: load, save, remove, enroll, stats };
}
