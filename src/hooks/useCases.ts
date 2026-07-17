import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * useCases — capa de datos de la primitiva Case/Ticket (eje C ·
 * design/case-primitiva.md). CRUD + transiciones sobre `manage-cases`. El objeto
 * canónico y su lógica (SLA, máquina de estados) viven en el backend
 * (`_shared/cases.ts`); este hook solo lo administra desde el panel de casos.
 *
 * Build-ahead: si `manageCases` no está en los endpoints (Lambda no desplegada),
 * `configured=false` → el panel degrada al deep-link de Amazon Connect Cases.
 */
export type CaseStatus = "new" | "open" | "pending" | "on_hold" | "solved" | "closed";
export type CasePriority = "low" | "normal" | "high" | "urgent";

export interface CaseSla {
  policyId?: string;
  firstResponseDueAt?: string;
  resolutionDueAt?: string;
  firstRespondedAt?: string;
  resolvedAt?: string;
  breached?: { firstResponse?: boolean; resolution?: boolean };
  pausedMs?: number;
  pausedSince?: string;
}

export interface CaseEvent {
  ts: string;
  type:
    | "created"
    | "status_change"
    | "assign"
    | "note"
    | "sla_breach"
    | "csat"
    | "linked"
    | "external_sync";
  from?: string;
  to?: string;
  agent?: string;
  note?: string;
  meta?: Record<string, string>;
}

export interface CaseRecord {
  caseId: string;
  tenantId: string;
  number: number;
  subject: string;
  description?: string;
  status: CaseStatus;
  priority: CasePriority;
  queueId?: string;
  assigneeAgentId?: string;
  assigneeAgentName?: string;
  leadId?: string;
  phone?: string;
  conversationIds?: string[];
  contactId?: string;
  channel?: string;
  programId?: string;
  sla?: CaseSla;
  history?: CaseEvent[];
  csat?: { score?: number; comment?: string; sentAt?: string; respondedAt?: string };
  createdAt: string;
  updatedAt: string;
}

/** Etiqueta + clase de chip por estado (espejo de la máquina del backend). */
export const CASE_STATUS_META: Record<CaseStatus, { label: string; chip: string }> = {
  new: { label: "Nuevo", chip: "chip--cyan" },
  open: { label: "Abierto", chip: "chip--amber" },
  pending: { label: "Esperando cliente", chip: "chip--violet" },
  on_hold: { label: "En espera", chip: "chip--violet" },
  solved: { label: "Resuelto", chip: "chip--green" },
  closed: { label: "Cerrado", chip: "chip--green" },
};

export const CASE_PRIORITY_META: Record<CasePriority, { label: string; chip: string }> = {
  urgent: { label: "Urgente", chip: "chip--red" },
  high: { label: "Alta", chip: "chip--amber" },
  normal: { label: "Normal", chip: "chip--cyan" },
  low: { label: "Baja", chip: "chip--green" },
};

/** Próximos estados ofrecidos en el detalle (subconjunto usable de la máquina). */
export const CASE_NEXT_STATES: Record<CaseStatus, CaseStatus[]> = {
  new: ["open", "pending", "solved"],
  open: ["pending", "on_hold", "solved"],
  pending: ["open", "solved"],
  on_hold: ["open", "solved"],
  solved: ["open", "closed"],
  closed: ["open"],
};

export interface CreateCaseArgs {
  subject: string;
  priority?: CasePriority;
  description?: string;
  leadId?: string;
  contactId?: string;
  channel?: string;
  agent?: string;
}

export function useCases(phone: string | null) {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const endpoint = getApiEndpoints()?.manageCases;

  const load = useCallback(async () => {
    if (!endpoint) {
      setLoading(false);
      return;
    }
    if (!phone) {
      setCases([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await authedFetch(`${endpoint}?phone=${encodeURIComponent(phone)}`);
      const j = await r.json();
      setCases(Array.isArray(j.cases) ? j.cases : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los casos");
    } finally {
      setLoading(false);
    }
  }, [endpoint, phone]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(
    async (input: CreateCaseArgs): Promise<CaseRecord | null> => {
      if (!endpoint || !phone) return null;
      const r = await authedFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, phone }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await load();
      return (j.case as CaseRecord) || null;
    },
    [endpoint, phone, load],
  );

  const transition = useCallback(
    async (
      caseId: string,
      status: CaseStatus,
      opts?: { note?: string; agent?: string },
    ): Promise<CaseRecord | null> => {
      if (!endpoint) return null;
      const r = await authedFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "transition", caseId, status, ...opts }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await load();
      return (j.case as CaseRecord) || null;
    },
    [endpoint, load],
  );

  const assign = useCallback(
    async (caseId: string, agentId: string, agentName?: string): Promise<CaseRecord | null> => {
      if (!endpoint) return null;
      const r = await authedFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", caseId, agentId, agentName }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await load();
      return (j.case as CaseRecord) || null;
    },
    [endpoint, load],
  );

  return {
    cases,
    loading,
    error,
    configured: !!endpoint,
    reload: load,
    create,
    transition,
    assign,
  };
}

/** Chip de SLA de resolución: tiempo restante / vencido. null si resuelto/cerrado
 *  o sin vencimiento. Formaliza en el caso la señal que en el inbox era heurística. */
export function caseSlaChip(
  c: CaseRecord,
): { label: string; level: "ok" | "warn" | "breach" } | null {
  if (c.status === "solved" || c.status === "closed") return null;
  const due = c.sla?.resolutionDueAt;
  if (!due) return null;
  const mins = Math.round((Date.parse(due) - Date.now()) / 60000);
  if (Number.isNaN(mins)) return null;
  if (mins < 0) return { label: `Vencido hace ${fmtDur(-mins)}`, level: "breach" };
  if (mins < 60) return { label: `Vence en ${fmtDur(mins)}`, level: "warn" };
  return { label: `Vence en ${fmtDur(mins)}`, level: "ok" };
}

function fmtDur(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
