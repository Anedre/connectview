import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  matchingWorkflows,
  runFromStart,
  shouldEnroll,
  asJourneyDef,
  startNodeId,
  type WorkflowDef,
  type WorkflowEvent,
  type EventCtx,
} from "../_shared/workflowEngine";
import { planAdvance, type JourneyEffect } from "../_shared/journeys";
import { evaluateLeadFilter, type FilterRule } from "../_shared/leadFilter";

/**
 * workflow-engine — el MOTOR UNIFICADO de "Flujos" (Fase 2). UN solo motor +
 * UNA tabla que colapsa lo que hoy hacen `automation-engine` (reacción a eventos)
 * y `journey-runner` (poll 5 min con estado). La ejecución de los pasos la
 * resuelve `planAdvance` (reutilizado); el matching por evento y la idempotencia
 * de enrollment viven en `_shared/workflowEngine` (puro, testeado).
 *
 * ⚠️ BUILD-AHEAD INERTE (Fase 2, sin switchover). Este Lambda se despliega
 * DESCONECTADO: ningún producer lo invoca y no tiene tick de EventBridge. Además
 * arranca en DRY_RUN (default true) → corre TODA la orquestación (match, enroll,
 * advance, y persiste el estado del enrollment en su tabla AISLADA
 * `connectview-workflow-enrollments`) pero NO ejecuta efectos reales (no envía
 * WhatsApp/email): los registra. Los senders reales son un FAIL-SAFE hasta el
 * switchover — si alguien pone DRY_RUN=false sin cablearlos, aborta en vez de
 * enviar basura. Así se prueba el motor de reemplazo sin tocar ejecución en vivo.
 */
const dynamo = new DynamoDBClient({});
const WORKFLOWS_TABLE = process.env.WORKFLOWS_TABLE || "connectview-workflows";
const ENROLLMENTS_TABLE =
  process.env.WORKFLOW_ENROLLMENTS_TABLE || "connectview-workflow-enrollments";
const LEADS_TABLE = process.env.LEADS_TABLE || "connectview-leads";
const SEGMENTS_TABLE = process.env.SEGMENTS_TABLE || "connectview-segments";
const INTERNAL_SECRET = process.env.VOX_INTERNAL_SECRET || "";
/** Inerte por default: solo `DRY_RUN=false` explícito habilitaría envíos reales
 *  (que todavía NO están cableados → fail-safe). */
const DRY_RUN_DEFAULT = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const MAX_ENROLL_PER_WORKFLOW = 200;

type LeadRec = Record<string, unknown> & { leadId?: string; tenantId?: string };

interface WorkflowEnrollment {
  workflowId: string;
  leadId: string;
  tenantId?: string;
  currentNodeId: string;
  status: "active" | "done" | "exited";
  enteredAt: string;
  nextRunAt: string;
  history: { node: string; at: string; note?: string }[];
}

/** Traza de lo que el motor haría/hizo (dry-run o real) — para la respuesta/log. */
interface RunTrace {
  matched: number;
  enrolled: number;
  advanced: number;
  effects: string[];
  dryRun: boolean;
}

// ── Loaders ───────────────────────────────────────────────────────────────────

async function scanActiveWorkflows(): Promise<WorkflowDef[]> {
  const out: WorkflowDef[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new ScanCommand({
        TableName: WORKFLOWS_TABLE,
        FilterExpression: "#st = :active",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: { ":active": { S: "active" } },
        ExclusiveStartKey: lastKey as never,
      }),
    );
    for (const it of res.Items || []) out.push(unmarshall(it) as WorkflowDef);
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return out;
}

async function loadLead(leadId: string): Promise<LeadRec | null> {
  const r = await dynamo.send(
    new GetItemCommand({ TableName: LEADS_TABLE, Key: { leadId: { S: leadId } } }),
  );
  return r.Item ? (unmarshall(r.Item) as LeadRec) : null;
}

async function scanLeads(): Promise<LeadRec[]> {
  const out: LeadRec[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new ScanCommand({ TableName: LEADS_TABLE, ExclusiveStartKey: lastKey as never }),
    );
    for (const it of res.Items || []) out.push(unmarshall(it) as LeadRec);
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return out;
}

async function loadSegmentRules(
  tenantId: string,
  segmentId: string,
): Promise<{ rules: FilterRule[]; match: "all" | "any" } | null> {
  const r = await dynamo.send(
    new GetItemCommand({
      TableName: SEGMENTS_TABLE,
      Key: { tenantId: { S: tenantId }, segmentId: { S: segmentId } },
    }),
  );
  if (!r.Item) return null;
  const seg = unmarshall(r.Item) as { rules?: FilterRule[]; match?: "all" | "any" };
  return { rules: seg.rules || [], match: seg.match === "any" ? "any" : "all" };
}

async function enrollmentFor(
  workflowId: string,
  leadId: string,
): Promise<WorkflowEnrollment | null> {
  const r = await dynamo.send(
    new GetItemCommand({
      TableName: ENROLLMENTS_TABLE,
      Key: { workflowId: { S: workflowId }, leadId: { S: leadId } },
    }),
  );
  return r.Item ? (unmarshall(r.Item) as WorkflowEnrollment) : null;
}

async function dueEnrollments(nowIso: string): Promise<WorkflowEnrollment[]> {
  const out: WorkflowEnrollment[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new ScanCommand({
        TableName: ENROLLMENTS_TABLE,
        FilterExpression: "#st = :active AND nextRunAt <= :now",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: { ":active": { S: "active" }, ":now": { S: nowIso } },
        ExclusiveStartKey: lastKey as never,
      }),
    );
    for (const it of res.Items || []) out.push(unmarshall(it) as WorkflowEnrollment);
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return out;
}

// ── Efectos (dry-run: registra; real: fail-safe hasta el switchover) ──────────

function describeEffect(e: JourneyEffect): string {
  if (e.type === "send") {
    const ch = e.channel === "email" ? "email" : "whatsapp";
    const t = String(e.params.templateName || e.params.subject || "?");
    return `send:${ch}:${t}`;
  }
  return `action:${e.action}:${JSON.stringify(e.params)}`;
}

async function executeEffect(e: JourneyEffect, dryRun: boolean): Promise<string> {
  if (dryRun) return `[dry] ${describeEffect(e)}`;
  // Fail-safe: los senders reales se cablean en el SWITCHOVER (refactor de los del
  // journey-runner a _shared). Hasta entonces, abortar > enviar algo indefinido.
  throw new Error(
    "workflow-engine: efectos reales aún no cableados (switchover pendiente). " +
      "Mantené DRY_RUN=true.",
  );
}

// ── Persistencia de enrollment ─────────────────────────────────────────────────

async function putEnrollment(enr: WorkflowEnrollment, isNew: boolean): Promise<boolean> {
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: ENROLLMENTS_TABLE,
        Item: marshall(enr, { removeUndefinedValues: true }),
        ...(isNew ? { ConditionExpression: "attribute_not_exists(workflowId)" } : {}),
      }),
    );
    return true;
  } catch (e) {
    // Ya inscrito (carrera) → idempotente, no es error.
    if (e instanceof Error && e.name === "ConditionalCheckFailedException") return false;
    throw e;
  }
}

// ── Disparo por EVENTO ─────────────────────────────────────────────────────────

/**
 * Un workflow (trigger por evento) reacciona a un evento: corre desde la entrada.
 * Si TERMINA sin descansar (reflejo) → ejecuta los efectos y no persiste estado
 * (cada evento dispara, como una regla). Si DESCANSA en una espera (recorrido) →
 * persiste un enrollment idempotente (no re-inscribe si ya está activo).
 */
async function fireWorkflowForEvent(
  w: WorkflowDef,
  ctx: EventCtx,
  nowMs: number,
  dryRun: boolean,
  trace: RunTrace,
): Promise<void> {
  // Lead fresco para evaluar branches/waits (por leadId; si no, el ctx del evento).
  const lead: LeadRec = ctx.leadId ? (await loadLead(ctx.leadId)) || { ...ctx } : { ...ctx };
  const plan = runFromStart(w, lead, nowMs);
  if (!plan) return;
  for (const e of plan.effects) trace.effects.push(await executeEffect(e, dryRun));

  if (plan.done) return; // reflejo: ejecutó y terminó, sin estado.

  // Recorrido disparado por evento: idempotente por lead (como start_journey).
  const leadId = String(ctx.leadId || lead.leadId || "");
  if (!leadId) return;
  const existing = await enrollmentFor(w.workflowId, leadId);
  if (!shouldEnroll(existing, w.reenroll)) return;
  const nowIso = new Date(nowMs).toISOString();
  const start = startNodeId(w) || "";
  const enr: WorkflowEnrollment = {
    workflowId: w.workflowId,
    leadId,
    tenantId: w.tenantId,
    currentNodeId: plan.nextNodeId,
    status: "active",
    enteredAt: nowIso,
    nextRunAt: plan.nextRunAt,
    history: [{ node: start, at: nowIso, note: "inscrito por evento" }],
  };
  if (await putEnrollment(enr, !existing)) trace.enrolled++;
}

async function processEvent(ev: WorkflowEvent, dryRun: boolean): Promise<RunTrace> {
  const trace: RunTrace = { matched: 0, enrolled: 0, advanced: 0, effects: [], dryRun };
  const nowMs = Date.now();
  const workflows = await scanActiveWorkflows();
  const matched = matchingWorkflows(
    workflows.filter((w) => !w.tenantId || w.tenantId === ev.tenantId),
    ev,
  );
  trace.matched = matched.length;
  for (const w of matched) await fireWorkflowForEvent(w, ev.ctx, nowMs, dryRun, trace);
  return trace;
}

// ── Tick: auto-enroll por segmento + avance de enrollments vencidos ────────────

async function autoEnroll(workflows: WorkflowDef[], nowMs: number, trace: RunTrace): Promise<void> {
  const needsLeads = workflows.filter(
    (w) => w.trigger.kind === "segment" || w.trigger.kind === "new_lead",
  );
  if (!needsLeads.length) return;
  const leads = await scanLeads();
  const nowIso = new Date(nowMs).toISOString();
  for (const w of needsLeads) {
    let candidates: LeadRec[] = [];
    if (w.trigger.kind === "segment") {
      const seg = await loadSegmentRules(w.tenantId || "", w.trigger.segmentId);
      if (!seg) continue;
      candidates = leads.filter((l) => evaluateLeadFilter(l, seg.rules, seg.match));
    }
    // (new_lead con marca de agua = paridad con journey-runner; se cablea en el
    //  switchover junto al scan de lead_inactive/score. Build-ahead: segmento.)
    if (w.tenantId) candidates = candidates.filter((l) => !l.tenantId || l.tenantId === w.tenantId);

    let count = 0;
    for (const l of candidates) {
      if (count >= MAX_ENROLL_PER_WORKFLOW) break;
      const leadId = String(l.leadId || "");
      if (!leadId) continue;
      const existing = await enrollmentFor(w.workflowId, leadId);
      if (!shouldEnroll(existing, w.reenroll)) continue;
      const start = startNodeId(w) || "";
      const enr: WorkflowEnrollment = {
        workflowId: w.workflowId,
        leadId,
        tenantId: w.tenantId,
        currentNodeId: start,
        status: "active",
        enteredAt: nowIso,
        nextRunAt: nowIso,
        history: [{ node: start, at: nowIso, note: "auto-enroll segmento" }],
      };
      if (await putEnrollment(enr, !existing)) {
        count++;
        trace.enrolled++;
      }
    }
  }
}

async function advanceDue(
  workflows: WorkflowDef[],
  nowMs: number,
  dryRun: boolean,
  trace: RunTrace,
): Promise<void> {
  const byId = new Map(workflows.map((w) => [w.workflowId, w]));
  const nowIso = new Date(nowMs).toISOString();
  const due = await dueEnrollments(nowIso);
  for (const enr of due) {
    const w = byId.get(enr.workflowId);
    if (!w) continue; // workflow borrado/pausado → no avanza
    const lead: LeadRec = (await loadLead(enr.leadId)) || { leadId: enr.leadId };
    const plan = planAdvance(asJourneyDef(w), enr.currentNodeId, lead, nowMs);
    for (const e of plan.effects) trace.effects.push(await executeEffect(e, dryRun));
    const next: WorkflowEnrollment = {
      ...enr,
      currentNodeId: plan.nextNodeId,
      status: plan.done ? "done" : "active",
      nextRunAt: plan.nextRunAt,
      history: [...(enr.history || []), { node: plan.nextNodeId, at: nowIso }],
    };
    await putEnrollment(next, false);
    trace.advanced++;
  }
}

async function processTick(dryRun: boolean): Promise<RunTrace> {
  const trace: RunTrace = { matched: 0, enrolled: 0, advanced: 0, effects: [], dryRun };
  const nowMs = Date.now();
  const workflows = await scanActiveWorkflows();
  await autoEnroll(workflows, nowMs, trace);
  await advanceDue(workflows, nowMs, dryRun, trace);
  return trace;
}

// ── Handler ────────────────────────────────────────────────────────────────────

function bad(code: number, msg: string) {
  return {
    statusCode: code,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: msg }),
  };
}
function ok(obj: unknown) {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  // 1. HTTP (Function URL): evento de un producer — exige el secreto interno.
  if (event?.requestContext?.http) {
    const method = event.requestContext.http.method || "POST";
    if (method === "OPTIONS") return { statusCode: 200, headers: {}, body: "" };
    if (method !== "POST") return bad(405, "POST only");
    const hdrs = (event.headers || {}) as Record<string, string>;
    const secret = hdrs["x-vox-internal"] || hdrs["X-Vox-Internal"] || "";
    if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) return bad(401, "No autorizado");
    let body: { event?: WorkflowEvent; dryRun?: boolean };
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return bad(400, "JSON inválido");
    }
    if (!body.event?.type || !body.event?.tenantId)
      return bad(400, "event.type y event.tenantId requeridos");
    const dryRun = DRY_RUN_DEFAULT || body.dryRun === true;
    try {
      const res = await processEvent(body.event, dryRun);
      return ok({ ok: true, ...res });
    } catch (err) {
      console.error("processEvent failed", err);
      return bad(500, err instanceof Error ? err.message : "error");
    }
  }

  // 2. Invoke directo con {event:{...}} (testing/dry-run manual).
  if (event?.event?.type) {
    const dryRun = DRY_RUN_DEFAULT || event.dryRun === true;
    const res = await processEvent(event.event as WorkflowEvent, dryRun);
    return { ok: true, ...res };
  }

  // 3. Tick (EventBridge scheduled o invoke pelado): auto-enroll + avance.
  const dryRun = DRY_RUN_DEFAULT || event?.dryRun === true;
  const res = await processTick(dryRun);
  console.log(
    `workflow tick${dryRun ? " [DRY]" : ""}: matched=${res.matched} enrolled=${res.enrolled} advanced=${res.advanced} effects=${res.effects.length}`,
  );
  return { ok: true, ...res };
};
