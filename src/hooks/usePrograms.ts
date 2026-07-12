import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

export type ProgramStatus = "borrador" | "activo" | "pausado" | "cerrado" | "archivado";

export interface ProgramMetrics {
  leads: number;
  byStage: Record<string, number>;
  lastActivityAt?: string;
}

export interface Program {
  programId: string;
  code: string;
  name: string;
  faculty?: string;
  description?: string;
  // Detalles comerciales — el Agente IA los cita como fuente rica [P] (RAG).
  modality?: string; // Presencial / Virtual / Semipresencial…
  duration?: string; // ej. "10 ciclos"
  price?: string; // ej. "S/ 1200 por ciclo"
  requirements?: string; // requisitos de admisión
  status: ProgramStatus;
  color?: string;
  startDate?: string;
  endDate?: string;
  autoArchive?: boolean;
  defaultQueueId?: string;
  defaultContactFlowId?: string;
  defaultStageId?: string;
  /** Taxonomía de etapas propia del programa (vacío = usa la default global). */
  taxonomyId?: string;
  kpiTargets?: { contactRate?: number; conversion?: number; leadsGoal?: number };
  metricsSnapshot?: ProgramMetrics;
  /** Conteo de leads (membership) que devuelve el GET de lista. */
  leadCount?: number;
  /** Salud en vivo (leads + byStage) que devuelve el GET de lista (Fase C). */
  health?: ProgramMetrics;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  archivedAt?: string;
}

async function fetchPrograms(includeArchived: boolean): Promise<Program[]> {
  const endpoints = getApiEndpoints();
  if (!endpoints?.managePrograms) return [];
  const url = endpoints.managePrograms + (includeArchived ? "?includeArchived=1" : "");
  const r = await authedFetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.programs as Program[]) || [];
}

async function errText(r: Response, fallback: string): Promise<string> {
  try {
    const j = await r.json();
    return (j as { error?: string }).error || fallback;
  } catch {
    return fallback;
  }
}

/**
 * usePrograms — lista de programas + mutaciones (Pilar 1). TanStack Query con
 * queryKey ["programs"] compartida (mismo patrón que useCampaigns). Las mutaciones
 * POST/DELETE invalidan la caché para refrescar a todos los consumidores
 * (incluido el ProgramSwitcher del top-bar vía ProgramContext).
 */
export function usePrograms(opts?: { includeArchived?: boolean; refreshIntervalMs?: number }) {
  const includeArchived = !!opts?.includeArchived;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["programs", { includeArchived }],
    queryFn: () => fetchPrograms(includeArchived),
    refetchInterval:
      opts?.refreshIntervalMs && opts.refreshIntervalMs > 0 ? opts.refreshIntervalMs : false,
  });

  const endpoints = getApiEndpoints();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["programs"] });
  const post = async (body: Record<string, unknown>, fallback: string) => {
    if (!endpoints?.managePrograms) throw new Error("managePrograms endpoint no configurado");
    const r = await authedFetch(endpoints.managePrograms, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await errText(r, fallback));
    await invalidate();
    return r.json();
  };

  return {
    programs: q.data ?? [],
    loading: q.isLoading,
    error: q.error ? (q.error instanceof Error ? q.error.message : "Failed") : null,
    refresh: q.refetch,

    saveProgram: (p: Partial<Program> & { code: string; name: string }) =>
      post(p as Record<string, unknown>, "no se pudo guardar el programa"),

    transitionProgram: (programId: string, to: ProgramStatus) =>
      post({ action: "transition", programId, to }, "no se pudo cambiar el estado"),

    importPrograms: (rows: Array<Partial<Program>>) =>
      post({ action: "importExcel", rows }, "no se pudo importar"),

    removeProgram: async (programId: string) => {
      if (!endpoints?.managePrograms) throw new Error("managePrograms endpoint no configurado");
      const r = await authedFetch(
        endpoints.managePrograms + "?programId=" + encodeURIComponent(programId),
        { method: "DELETE" },
      );
      if (!r.ok) throw new Error(await errText(r, "no se pudo borrar"));
      await invalidate();
      return r.json();
    },
  };
}
