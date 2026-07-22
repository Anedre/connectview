import { useQuery } from "@tanstack/react-query";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

export interface Campaign {
  campaignId: string;
  name: string;
  description?: string;
  /** Canal de la campaña: "voice" (default) o "whatsapp". */
  campaignType?: string;
  sourcePhoneNumber: string;
  contactFlowId: string;
  contactFlowName?: string;
  campaignQueueId?: string;
  campaignQueueName?: string;
  dialMode: string;
  concurrency: number;
  timezone: string;
  windowStartHour: number;
  windowEndHour: number;
  windowDaysOfWeek?: string;
  retryNoAnswerMinutes?: number;
  retryMaxAttempts?: number;
  /** Per-agent contact bucket capacity. The dialer pre-assigns up to N
   *  pending contacts to each assigned agent and only dials from their
   *  bucket — making the agent's queue visible and predictable. When the
   *  agent's bucket has room, more contacts are claimed from the general
   *  pool. */
  maxContactsPerAgent?: number;
  status: "DRAFT" | "SCHEDULED" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED";
  /** ISO UTC. Con status SCHEDULED, cuándo arranca sola la campaña: el dialer
   *  la promueve a RUNNING en el tick siguiente a esa fecha. */
  scheduledStartAt?: string | null;
  /** ISO UTC. Fin de vigencia: al pasar, el dialer completa la campaña aunque
   *  queden contactos pendientes. */
  scheduledEndAt?: string | null;
  /** Programa (unidad comercial) al que pertenece la campaña. Se elige al crear
   *  y propaga la membership a los leads; aquí alimenta el badge + filtro por
   *  programa de la lista. Vacío/undefined = "Sin programa". */
  programId?: string;
  createdAt: string;
  createdBy?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  totalContacts: number;
  pendingCount: number;
  dialingCount: number;
  connectedCount: number;
  doneCount: number;
  failedCount: number;
  noAnswerCount: number;
  skippedCount?: number;
  // Pilar 7 — orquestación
  priority?: number;
  weight?: number;
  goalType?: string;
  goalTarget?: number;
  conversionsCount?: number;
  // Control total (2026-07)
  /** "shared" (default) | "exclusive" — exclusivo: cada llamada va SOLO a la
   *  cola personal del agente asignado (asignación = ruteo real). */
  agentRouting?: string;
  /** Conexión directa: sin saludo ni música de espera (flow ARIA-Outbound-Direct). */
  directConnect?: boolean;
  /** Auto-contestar aplicado a los agentes asignados mientras corre. */
  autoAccept?: boolean;
}

async function fetchCampaigns(): Promise<Campaign[]> {
  const endpoints = getApiEndpoints();
  if (!endpoints?.listCampaigns) return [];
  const r = await authedFetch(endpoints.listCampaigns);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.campaigns as Campaign[]) || [];
}

/**
 * useCampaigns — lista de campañas con polling.
 *
 * Migrado a TanStack Query (antes era fetch + setInterval + useState a mano):
 * - queryKey ["campaigns"]: varios componentes que lo usen comparten UNA sola
 *   request y una sola caché (antes cada hook abría su propio fetch + timer).
 * - refetchInterval: el polling lo maneja Query; con varios consumidores a
 *   distinto intervalo, gana el más frecuente sobre la query compartida.
 * - dedupe + reintento + estados de carga/error vienen de Query.
 *
 * Mantiene la MISMA interfaz { campaigns, loading, error, refresh } para no
 * tocar los consumidores existentes.
 */
export function useCampaigns(refreshIntervalMs = 5000) {
  const q = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
    refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
  });

  return {
    campaigns: q.data ?? [],
    loading: q.isLoading,
    error: q.error ? (q.error instanceof Error ? q.error.message : "Failed") : null,
    refresh: q.refetch,
  };
}
