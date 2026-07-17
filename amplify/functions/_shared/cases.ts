/**
 * cases — la primitiva Case/Ticket (eje C · design/case-primitiva.md). Unidad de
 * trabajo con SLA, cola, prioridad y estado de resolución. NO reemplaza el inbox
 * (Pilar 6): un caso REFERENCIA conversaciones + lead. Tabla `connectview-cases`
 * (PK=tenantId, SK=caseId), con un item contador (SK="__counter__") para el
 * correlativo legible por tenant. Modelo espejo de conversations.ts.
 *
 * B1 (este): objeto + CRUD + transiciones de estado + cómputo de vencimiento SLA.
 * El reaper de breach (emite case_sla_breach) y el sync a Zendesk/Jira son B2/B4.
 */
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "node:crypto";

const CASES_TABLE = process.env.CASES_TABLE || "connectview-cases";
const COUNTER_SK = "__counter__";

export type CaseStatus = "new" | "open" | "pending" | "on_hold" | "solved" | "closed";
export type CasePriority = "low" | "normal" | "high" | "urgent";

export const CASE_STATUSES: CaseStatus[] = [
  "new",
  "open",
  "pending",
  "on_hold",
  "solved",
  "closed",
];
export const CASE_PRIORITIES: CasePriority[] = ["low", "normal", "high", "urgent"];

/** Estados en los que el reloj de RESOLUCIÓN está pausado (esperando a un tercero
 *  o al cliente). Estándar Zendesk/JSM. */
const PAUSED_STATES: Set<CaseStatus> = new Set(["pending", "on_hold"]);
/** Estados terminales/resueltos (el reloj no corre). */
const RESOLVED_STATES: Set<CaseStatus> = new Set(["solved", "closed"]);

export interface CaseSla {
  policyId?: string;
  firstResponseDueAt?: string;
  resolutionDueAt?: string;
  firstRespondedAt?: string;
  resolvedAt?: string;
  breached?: { firstResponse?: boolean; resolution?: boolean };
  /** Acumulado (ms) en estados pausados — el reaper lo descuenta del reloj. */
  pausedMs?: number;
  /** Instante en que entró al estado pausado actual (para acumular al reanudar). */
  pausedSince?: string;
}

export interface CaseExternalRef {
  connectorId: string;
  objectType: string;
  id: string;
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

export interface Case {
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
  externalRefs?: CaseExternalRef[];
  csat?: { score?: number; comment?: string; sentAt?: string; respondedAt?: string };
  createdAt: string;
  updatedAt: string;
  closedReason?: "solved" | "duplicate" | "not_reproducible" | "manual";
}

// ───────────────────────── SLA (políticas por prioridad) ────────────────────
export interface SlaPolicy {
  priority: CasePriority;
  firstResponseMins: number;
  resolutionMins: number;
}

/** Política SLA por defecto (24/7, MVP). El tenant la sobreescribe en B2
 *  (connectview-connections.cases.slaPolicies). Minutos por prioridad. */
export const DEFAULT_SLA: Record<
  CasePriority,
  { firstResponseMins: number; resolutionMins: number }
> = {
  urgent: { firstResponseMins: 15, resolutionMins: 240 },
  high: { firstResponseMins: 60, resolutionMins: 480 },
  normal: { firstResponseMins: 240, resolutionMins: 1440 },
  low: { firstResponseMins: 480, resolutionMins: 2880 },
};

function addMinutes(iso: string, mins: number): string {
  return new Date(new Date(iso).getTime() + mins * 60_000).toISOString();
}

/** Inicializa el SLA de un caso nuevo a partir de la política de su prioridad. */
export function initialSla(
  priority: CasePriority,
  createdAt: string,
  policies?: SlaPolicy[],
): CaseSla {
  const p =
    policies?.find((x) => x.priority === priority) ??
    ({ priority, ...DEFAULT_SLA[priority] } as SlaPolicy);
  return {
    firstResponseDueAt: addMinutes(createdAt, p.firstResponseMins),
    resolutionDueAt: addMinutes(createdAt, p.resolutionMins),
    pausedMs: 0,
  };
}

/**
 * Avanza el reloj SLA ante una transición `from → to` (función PURA, testeable):
 *  · entrar a pending/on_hold → marca `pausedSince` (el reloj de resolución pausa).
 *  · salir de un estado pausado → acumula el tiempo en `pausedMs`.
 *  · llegar a solved/closed → registra `resolvedAt`.
 *  · reabrir → limpia `resolvedAt` (el reloj vuelve a correr).
 * `now` se inyecta (ISO) para no depender del reloj real en los tests.
 */
export function advanceSla(
  prev: CaseSla | undefined,
  from: CaseStatus,
  to: CaseStatus,
  now: string,
): CaseSla {
  const sla: CaseSla = { ...(prev || {}) };
  if (PAUSED_STATES.has(from) && !PAUSED_STATES.has(to) && sla.pausedSince) {
    const delta = new Date(now).getTime() - new Date(sla.pausedSince).getTime();
    sla.pausedMs = (sla.pausedMs || 0) + Math.max(0, delta);
    sla.pausedSince = undefined;
  }
  if (!PAUSED_STATES.has(from) && PAUSED_STATES.has(to)) {
    sla.pausedSince = now;
  }
  if (RESOLVED_STATES.has(to) && !sla.resolvedAt) sla.resolvedAt = now;
  if (!RESOLVED_STATES.has(to) && sla.resolvedAt) sla.resolvedAt = undefined;
  return sla;
}

// ───────────────────────── helpers de tabla ─────────────────────────────────
function isValidStatus(s: unknown): s is CaseStatus {
  return typeof s === "string" && (CASE_STATUSES as string[]).includes(s);
}
function isValidPriority(p: unknown): p is CasePriority {
  return typeof p === "string" && (CASE_PRIORITIES as string[]).includes(p);
}

/** Correlativo atómico por tenant (item SK="__counter__", atributo `caseSeq`). */
async function nextCaseNumber(dynamo: DynamoDBClient, tenantId: string): Promise<number> {
  const r = await dynamo.send(
    new UpdateItemCommand({
      TableName: CASES_TABLE,
      Key: { tenantId: { S: tenantId }, caseId: { S: COUNTER_SK } },
      UpdateExpression: "ADD caseSeq :one",
      ExpressionAttributeValues: { ":one": { N: "1" } },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  const n = r.Attributes?.caseSeq?.N;
  return n ? parseInt(n, 10) : 1;
}

export interface CreateCaseInput {
  tenantId: string;
  subject: string;
  description?: string;
  priority?: CasePriority;
  status?: CaseStatus; // default "new" (o "open" si viene assignee)
  queueId?: string;
  assigneeAgentId?: string;
  assigneeAgentName?: string;
  leadId?: string;
  phone?: string;
  conversationIds?: string[];
  contactId?: string;
  channel?: string;
  programId?: string;
  externalRefs?: CaseExternalRef[];
  /** origen del alta (para el CaseEvent inicial): manual|automation|inbound|<agent>. */
  createdBy?: string;
  slaPolicies?: SlaPolicy[];
}

/** Alta de un caso: asigna correlativo, inicializa SLA y escribe el item + el
 *  CaseEvent "created". Devuelve el caso creado. */
export async function createCase(dynamo: DynamoDBClient, input: CreateCaseInput): Promise<Case> {
  if (!input.tenantId) throw new Error("createCase: tenantId requerido");
  const now = new Date().toISOString();
  const caseId = randomUUID();
  const priority: CasePriority = isValidPriority(input.priority) ? input.priority : "normal";
  const status: CaseStatus = isValidStatus(input.status)
    ? input.status
    : input.assigneeAgentId
      ? "open"
      : "new";
  const number = await nextCaseNumber(dynamo, input.tenantId);
  const c: Case = {
    caseId,
    tenantId: input.tenantId,
    number,
    subject: (input.subject || "").trim() || `Caso #${number}`,
    description: input.description?.trim() || undefined,
    status,
    priority,
    queueId: input.queueId,
    assigneeAgentId: input.assigneeAgentId,
    assigneeAgentName: input.assigneeAgentName,
    leadId: input.leadId,
    phone: input.phone,
    conversationIds: input.conversationIds?.length ? input.conversationIds : undefined,
    contactId: input.contactId,
    channel: input.channel,
    programId: input.programId,
    sla: initialSla(priority, now, input.slaPolicies),
    history: [{ ts: now, type: "created", agent: input.createdBy, to: status }],
    externalRefs: input.externalRefs?.length ? input.externalRefs : undefined,
    createdAt: now,
    updatedAt: now,
  };
  await dynamo.send(
    new PutItemCommand({
      TableName: CASES_TABLE,
      Item: marshall(c, { removeUndefinedValues: true }),
    }),
  );
  return c;
}

export async function getCase(
  dynamo: DynamoDBClient,
  tenantId: string,
  caseId: string,
): Promise<Case | null> {
  if (!tenantId || !caseId) return null;
  try {
    const r = await dynamo.send(
      new GetItemCommand({
        TableName: CASES_TABLE,
        Key: { tenantId: { S: tenantId }, caseId: { S: caseId } },
      }),
    );
    return r.Item ? (unmarshall(r.Item) as Case) : null;
  } catch {
    return null;
  }
}

export interface ListCasesOpts {
  status?: CaseStatus;
  priority?: CasePriority;
  queueId?: string;
  assigneeAgentId?: string;
  programId?: string;
  /** Teléfono del cliente (E.164) — para el panel de casos por-contacto. */
  phone?: string;
  limit?: number;
}

/** Casos del tenant (Query PK=tenantId), filtrados en memoria por los opts y
 *  ordenados por updatedAt desc. Excluye el item contador. */
export async function listCases(
  dynamo: DynamoDBClient,
  tenantId: string,
  opts: ListCasesOpts = {},
): Promise<Case[]> {
  if (!tenantId) return [];
  const out: Case[] = [];
  let ESK: Record<string, unknown> | undefined;
  try {
    do {
      const r = await dynamo.send(
        new QueryCommand({
          TableName: CASES_TABLE,
          KeyConditionExpression: "tenantId = :t",
          ExpressionAttributeValues: marshall({ ":t": tenantId }),
          ExclusiveStartKey: ESK as never,
        }),
      );
      for (const it of r.Items || []) {
        const row = unmarshall(it) as Case & { caseId?: string };
        if (!row.caseId || row.caseId === COUNTER_SK) continue; // saltar el contador
        if (opts.status && row.status !== opts.status) continue;
        if (opts.priority && row.priority !== opts.priority) continue;
        if (opts.queueId && row.queueId !== opts.queueId) continue;
        if (opts.assigneeAgentId && row.assigneeAgentId !== opts.assigneeAgentId) continue;
        if (opts.programId && row.programId !== opts.programId) continue;
        if (opts.phone && row.phone !== opts.phone) continue;
        out.push(row);
      }
      ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ESK && out.length < (opts.limit || 500));
  } catch {
    /* tabla nueva / vacía */
  }
  return out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

/** ¿La transición de estado es válida? Máquina de estados fija (design/case-primitiva §4).
 *  reopen (→open) desde solved/closed lo permite un inbound del cliente. */
const ALLOWED_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  new: ["open", "pending", "on_hold", "solved", "closed"],
  open: ["pending", "on_hold", "solved", "closed"],
  pending: ["open", "on_hold", "solved", "closed"],
  on_hold: ["open", "pending", "solved", "closed"],
  solved: ["open", "closed"], // reabrir o cerrar definitivo
  closed: ["open"], // reabrir por inbound del cliente
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

/**
 * Transición de estado con manejo del reloj SLA:
 *  · al entrar a pending/on_hold → registra `pausedSince`.
 *  · al salir de un estado pausado → acumula el tiempo en `pausedMs`.
 *  · al llegar a solved → set `resolvedAt`.
 * Escribe el CaseEvent (status_change) + updatedAt. Devuelve el caso o null.
 */
export async function transitionCase(
  dynamo: DynamoDBClient,
  tenantId: string,
  caseId: string,
  to: CaseStatus,
  opts: { agent?: string; note?: string; closedReason?: Case["closedReason"] } = {},
): Promise<Case | null> {
  const c = await getCase(dynamo, tenantId, caseId);
  if (!c) return null;
  if (!isValidStatus(to)) throw new Error(`estado inválido: ${to}`);
  if (!canTransition(c.status, to)) {
    throw new Error(`transición no permitida: ${c.status} → ${to}`);
  }
  const now = new Date().toISOString();
  const sla = advanceSla(c.sla, c.status, to, now);

  const ev: CaseEvent = { ts: now, type: "status_change", from: c.status, to, agent: opts.agent };
  if (opts.note) ev.note = opts.note;

  const next: Case = {
    ...c,
    status: to,
    sla,
    closedReason:
      to === "closed" || to === "solved" ? (opts.closedReason ?? c.closedReason) : c.closedReason,
    history: [...(c.history || []), ev],
    updatedAt: now,
  };
  await dynamo.send(
    new PutItemCommand({
      TableName: CASES_TABLE,
      Item: marshall(next, { removeUndefinedValues: true }),
    }),
  );
  return next;
}

/** Asigna (o reasigna) un caso a un agente. Si estaba "new", pasa a "open". */
export async function assignCase(
  dynamo: DynamoDBClient,
  tenantId: string,
  caseId: string,
  agentId: string,
  agentName?: string,
): Promise<Case | null> {
  const c = await getCase(dynamo, tenantId, caseId);
  if (!c) return null;
  const now = new Date().toISOString();
  const ev: CaseEvent = {
    ts: now,
    type: "assign",
    from: c.assigneeAgentId,
    to: agentId,
    agent: agentId,
  };
  const next: Case = {
    ...c,
    assigneeAgentId: agentId || undefined,
    assigneeAgentName: agentName || (agentId ? c.assigneeAgentName : undefined),
    status: c.status === "new" && agentId ? "open" : c.status,
    history: [...(c.history || []), ev],
    updatedAt: now,
  };
  await dynamo.send(
    new PutItemCommand({
      TableName: CASES_TABLE,
      Item: marshall(next, { removeUndefinedValues: true }),
    }),
  );
  return next;
}

/** Actualiza campos "planos" del caso (subject/description/priority/queue/programa)
 *  + escribe un CaseEvent "note" si viene nota. Recalcula el vencimiento SLA si
 *  cambió la prioridad (sobre createdAt, MVP simple). */
export async function patchCase(
  dynamo: DynamoDBClient,
  tenantId: string,
  caseId: string,
  patch: {
    subject?: string;
    description?: string;
    priority?: CasePriority;
    queueId?: string;
    programId?: string;
    note?: string;
    agent?: string;
  },
): Promise<Case | null> {
  const c = await getCase(dynamo, tenantId, caseId);
  if (!c) return null;
  const now = new Date().toISOString();
  let sla = c.sla;
  if (patch.priority && isValidPriority(patch.priority) && patch.priority !== c.priority) {
    // Recalcular vencimientos sobre la fecha de creación (MVP; B2 lo hará fino).
    const fresh = initialSla(patch.priority, c.createdAt);
    sla = {
      ...c.sla,
      firstResponseDueAt: fresh.firstResponseDueAt,
      resolutionDueAt: fresh.resolutionDueAt,
    };
  }
  const history = [...(c.history || [])];
  if (patch.note) history.push({ ts: now, type: "note", note: patch.note, agent: patch.agent });
  const next: Case = {
    ...c,
    subject: patch.subject?.trim() || c.subject,
    description:
      patch.description !== undefined ? patch.description.trim() || undefined : c.description,
    priority: patch.priority && isValidPriority(patch.priority) ? patch.priority : c.priority,
    queueId: patch.queueId !== undefined ? patch.queueId || undefined : c.queueId,
    programId: patch.programId !== undefined ? patch.programId || undefined : c.programId,
    sla,
    history,
    updatedAt: now,
  };
  await dynamo.send(
    new PutItemCommand({
      TableName: CASES_TABLE,
      Item: marshall(next, { removeUndefinedValues: true }),
    }),
  );
  return next;
}
