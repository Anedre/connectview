/**
 * leadFilter — predicado de LEAD SERIALIZABLE (Fase 2 · F2.3). Un segmento es
 * una lista de reglas `{field, op, value}` + `match` (all|any). El MISMO predicado
 * se evalúa en el front (vista de Leads) y en el back (manage-leads ?segment=,
 * audiencia de campaña, entrada de journey en Fase 3, filtro de export). Antes la
 * lógica vivía inline en LeadsPage (`passesFilters`), no reutilizable.
 *
 * Campos soportados (los del item del lead + score/grade de Fase 2): source,
 * stageId, grade, assignedAgent (string); score, montoEstimado, golpesCount
 * (numérico); email, company, phone (existencia/contains); sfLeadId (synced);
 * createdAt/updatedAt (fecha ISO); attributes.<k> (utm, etc.).
 */

export type FilterOp = "eq" | "neq" | "contains" | "gte" | "lte" | "in" | "exists" | "notexists";

export interface FilterRule {
  field: string;
  op: FilterOp;
  value?: string | number | string[];
}

export interface SegmentDef {
  segmentId: string;
  tenantId?: string;
  name: string;
  description?: string;
  match: "all" | "any";
  rules: FilterRule[];
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** Lead genérico evaluable (subconjunto laxo — cualquier objeto con estos campos). */
export type FilterableLead = Record<string, unknown> & {
  attributes?: Record<string, unknown>;
};

/** Lee el valor de un campo del lead, con soporte de `attributes.<k>` y alias. */
function fieldValue(lead: FilterableLead, field: string): unknown {
  if (field.startsWith("attributes.")) {
    return lead.attributes?.[field.slice("attributes.".length)];
  }
  // Alias de conveniencia.
  if (field === "synced") return lead.sfLeadId ? "sf" : "local";
  return lead[field];
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ¿Este lead cumple UNA regla? */
export function matchesRule(lead: FilterableLead, rule: FilterRule): boolean {
  const v = fieldValue(lead, rule.field);
  const { op, value } = rule;
  switch (op) {
    case "exists":
      return v != null && v !== "";
    case "notexists":
      return v == null || v === "";
    case "eq":
      return String(v ?? "") === String(value ?? "");
    case "neq":
      return String(v ?? "") !== String(value ?? "");
    case "contains":
      return String(v ?? "")
        .toLowerCase()
        .includes(String(value ?? "").toLowerCase());
    case "in":
      return Array.isArray(value) && value.map(String).includes(String(v ?? ""));
    case "gte": {
      const a = toNum(v);
      const b = toNum(value);
      return a != null && b != null && a >= b;
    }
    case "lte": {
      const a = toNum(v);
      const b = toNum(value);
      return a != null && b != null && a <= b;
    }
    default:
      return true;
  }
}

/** ¿El lead cumple el segmento? `match:"all"` = AND, `"any"` = OR. Sin reglas = todos. */
export function evaluateLeadFilter(
  lead: FilterableLead,
  rules: FilterRule[],
  match: "all" | "any" = "all",
): boolean {
  if (!rules || rules.length === 0) return true;
  return match === "any"
    ? rules.some((r) => matchesRule(lead, r))
    : rules.every((r) => matchesRule(lead, r));
}

/** Filtra una lista de leads por el segmento. */
export function filterLeads<T extends FilterableLead>(
  leads: T[],
  rules: FilterRule[],
  match: "all" | "any" = "all",
): T[] {
  return leads.filter((l) => evaluateLeadFilter(l, rules, match));
}
