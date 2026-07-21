/**
 * workflowEngine — el CEREBRO del motor unificado de "Flujos" (Fase 2). Un solo
 * modelo `WorkflowDef` que colapsa Automatización + Journey: la ejecución de los
 * PASOS ya la resuelve `planAdvance` (de ./journeys), que este módulo reutiliza
 * tal cual. Lo NUEVO de la Fase 2 vive acá y es PURO/testeable:
 *
 *   · `matchTrigger`  — ¿este workflow (trigger por EVENTO) reacciona a este
 *      evento? Espejo exacto del matching del automation-engine (type + params +
 *      conditions), pero sobre el modelo unificado.
 *   · `startNodeId`   — desde qué nodo arranca un enrollment nuevo.
 *   · `runFromStart`  — corre `planAdvance` desde la entrada: demuestra que UN
 *      solo motor cubre las 3 formas — un "reflejo" (sin esperas) TERMINA en el
 *      primer tick (done=true, sin descansar); un "recorrido" DESCANSA en el
 *      primer `wait`; el "split" desaparece como concepto (es un evento que
 *      arranca un enrollment con esperas).
 *
 * El modelo unificado colapsa las 3 formas de la fachada (Fase 1) en UNA sola
 * abstracción ejecutable. Este módulo es el prerequisito del spec: "demostrar
 * que el modelo unificado cubre todo". Sin AWS, sin efectos — el Lambda
 * `connectview-workflow-engine` le conecta DynamoDB + los senders reales.
 */
import {
  planAdvance,
  entryNodeId,
  type JourneyDef,
  type JourneyNode,
  type JourneyEdge,
  type AdvancePlan,
} from "./journeys";
import { type FilterableLead } from "./leadFilter";

/** Condición de filtro (a nivel trigger o rama de acción) — igual que la regla. */
export interface WorkflowCond {
  field: string;
  op: "eq" | "neq" | "contains" | "exists" | "notexists";
  value?: string;
}

/**
 * La entrada unificada. `event` = uno de los disparadores instantáneos (lo que
 * hoy es una regla). `segment`/`new_lead`/`manual` = auto-enroll con estado (lo
 * que hoy es un journey). El motor decide el enrollment por esto; los PASOS son
 * siempre los mismos nodos.
 */
export type WorkflowTrigger =
  | { kind: "event"; type: string; params?: Record<string, unknown>; conditions?: WorkflowCond[] }
  | { kind: "segment"; segmentId: string }
  | { kind: "new_lead" }
  | { kind: "manual" };

/**
 * Un flujo unificado. Nodos/edges IDÉNTICOS a un journey (por eso `planAdvance`
 * lo ejecuta sin cambios); `trigger` reemplaza al `entry` como forma de entrada.
 */
export interface WorkflowDef {
  tenantId?: string;
  workflowId: string;
  name: string;
  status: "draft" | "active" | "paused";
  trigger: WorkflowTrigger;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  reenroll?: boolean;
  goal?: { segmentId?: string; stageId?: string };
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** Contexto normalizado de un evento (los campos que matchean triggers/condiciones). */
export interface EventCtx {
  tenantId?: string;
  leadId?: string;
  phone?: string;
  name?: string;
  email?: string;
  stageId?: string;
  source?: string;
  valoracion?: string;
  channel?: string;
  flowName?: string;
  tag?: string;
}

/** Un evento entrante normalizado (lo que hoy recibe el automation-engine). */
export interface WorkflowEvent {
  type: string;
  tenantId: string;
  ctx: EventCtx;
}

// ── Condiciones (espejo de conditionHolds del automation-engine) ──────────────

function conditionHolds(actual: string, op: WorkflowCond["op"], expected: string): boolean {
  switch (op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "contains":
      return actual.includes(expected);
    case "exists":
      return actual !== "";
    case "notexists":
      return actual === "";
    default:
      return false;
  }
}

/** ¿El contexto del evento cumple TODAS las condiciones del trigger? (AND). */
export function evalConditions(conditions: WorkflowCond[] | undefined, ctx: EventCtx): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const c of conditions) {
    const actual = String((ctx as Record<string, unknown>)[c.field] ?? "").toLowerCase();
    const expected = String(c.value ?? "").toLowerCase();
    if (!conditionHolds(actual, c.op, expected)) return false;
  }
  return true;
}

// ── Matching de triggers por evento (espejo de matchesTrigger) ────────────────

/**
 * ¿Este workflow reacciona a este evento? Solo aplica a workflows con trigger
 * por evento y estado `active`. Replica EXACTAMENTE el matching del
 * automation-engine: type + filtros por param (stageId/flowName/channel/tag) +
 * las condiciones. Un mapeo distinto acá = reacción de más o de menos.
 */
export function matchTrigger(w: WorkflowDef, ev: WorkflowEvent): boolean {
  if (w.status !== "active") return false;
  if (w.trigger.kind !== "event") return false;
  if (w.trigger.type !== ev.type) return false;
  const params = w.trigger.params || {};
  const ctx = ev.ctx;
  if (ev.type === "lead_stage_changed") {
    const want = String(params.stageId || "");
    if (want && want !== String(ctx.stageId || "")) return false;
  }
  if (ev.type === "whatsapp_flow_completed") {
    const want = String(params.flowName || "").toLowerCase();
    if (want && want !== String(ctx.flowName || "").toLowerCase()) return false;
  }
  if (ev.type === "message_inbound") {
    const want = String(params.channel || "").toLowerCase();
    if (want && want !== String(ctx.channel || "").toLowerCase()) return false;
  }
  if (ev.type === "tag_applied") {
    const want = String(params.tag || "").toLowerCase();
    if (want && want !== String(ctx.tag || "").toLowerCase()) return false;
  }
  return evalConditions(w.trigger.conditions, ctx);
}

/** Todos los workflows-por-evento (activos) que reaccionan a este evento. */
export function matchingWorkflows(workflows: WorkflowDef[], ev: WorkflowEvent): WorkflowDef[] {
  return workflows.filter((w) => matchTrigger(w, ev));
}

// ── Ejecución (reutiliza planAdvance sobre el mismo grafo del journey) ─────────

/** Vista `JourneyDef` de un workflow (mismos nodos/edges) para `planAdvance`. */
export function asJourneyDef(w: WorkflowDef): JourneyDef {
  return {
    tenantId: w.tenantId,
    journeyId: w.workflowId,
    name: w.name,
    status: w.status,
    nodes: w.nodes,
    edges: w.edges,
    goal: w.goal,
  };
}

/** Nodo desde el que arranca un enrollment nuevo (la Entrada del grafo). */
export function startNodeId(w: WorkflowDef): string | undefined {
  return entryNodeId(asJourneyDef(w));
}

/**
 * Corre el flujo desde la entrada para un lead. `planAdvance` encadena los pasos
 * instantáneos y se detiene en el primer `wait` (o termina). El resultado revela
 * la FORMA en ejecución:
 *   · `done:true`  sin descansar        → reflejo (equivalente a una regla).
 *   · `done:false` con `nextRunAt` futuro → recorrido (descansa en la espera).
 * Es el MISMO motor para ambas — la unificación real de la Fase 2.
 */
export function runFromStart(
  w: WorkflowDef,
  lead: FilterableLead,
  nowMs: number = Date.now(),
): AdvancePlan | null {
  const start = startNodeId(w);
  if (!start) return null;
  return planAdvance(asJourneyDef(w), start, lead, nowMs);
}

/** ¿Este workflow es "instantáneo" (sin esperas) para un lead dado? Útil para
 *  telemetría/UX: un instantáneo corre y termina en un solo tick. */
export function isInstant(
  w: WorkflowDef,
  lead: FilterableLead,
  nowMs: number = Date.now(),
): boolean {
  const plan = runFromStart(w, lead, nowMs);
  return !!plan && plan.done;
}

// ── Idempotencia de enrollment (el "exactamente una vez") ─────────────────────

/** Estado mínimo de un enrollment existente que la decisión necesita. */
export interface ExistingEnrollment {
  status?: "active" | "done" | "exited";
}

/**
 * ¿Se debe inscribir a este lead? La garantía de "exactamente una vez" del motor.
 * Espejo EXACTO de la guarda del journey-runner (`existing && (active || !reenroll)
 * → skip`), unificada para ambos caminos de entrada (evento y segmento):
 *   · sin enrollment previo        → inscribir.
 *   · ya activo                    → NO (evita el doble envío / nurture duplicado).
 *   · terminado/salido + reenroll  → re-inscribir.
 *   · terminado/salido sin reenroll→ NO (una vez por lead de por vida).
 * La UNICIDAD física la refuerza el `PutItem` condicional del Lambda (PK
 * workflowId+leadId); esta función es la política, testeable sin AWS.
 */
export function shouldEnroll(
  existing: ExistingEnrollment | null | undefined,
  reenroll = false,
): boolean {
  if (!existing) return true;
  if (existing.status === "active") return false;
  // done | exited → solo si se permite re-inscripción.
  return reenroll;
}
