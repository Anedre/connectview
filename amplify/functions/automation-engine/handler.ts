import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { CustomerProfilesClient } from "@aws-sdk/client-customer-profiles";
import { isLegacyTenant } from "../_shared/cognitoAuth";
import { getTenantConnect } from "../_shared/tenantConnect";
import {
  appendLeadHistory,
  propagateLead,
  resetTaxonomyCache,
  setActiveDynamo,
  setActiveProfiles,
  stageIdToLabel,
} from "../_shared/leadSync";
import { setActiveTenant } from "../_shared/salesforceClient";
import { evaluateSend, recordSuppression } from "../_shared/suppression";
import { entryNodeId, type JourneyDef } from "../_shared/journeys";

/**
 * automation-engine — el motor de reglas (#15, "Digital Pipeline" de ARIA):
 * evalúa las reglas de `connectview-automation-rules` y ejecuta sus acciones.
 *
 * DOS entradas en un handler:
 *  · HTTP (Function URL): eventos de los hooks (manage-leads, save-agent-notes,
 *    web-form-capture) → body {event:{type,tenantId,lead?,wrapup?}}, protegido
 *    con header `x-vox-internal` (mismo patrón dialer→send-whatsapp-template).
 *  · Tick EventBridge rate(5 min): evalúa los triggers `lead_inactive`.
 *  · Invoke directo (aws lambda invoke con {event:{...}}): para testing; está
 *    gateado por IAM, no requiere el secreto.
 *
 * ANTI-LOOP: las acciones escriben DIRECTO a DDB (no pasan por manage-leads
 * HTTP) → no re-disparan hooks; las reglas NO se encadenan entre sí.
 *
 * MULTI-TENANT (estricto, sin fallback legacy — G5): novasys/default → tablas
 * pooled; tenant real → getTenantConnect (su Data Plane); si falla → SKIP de
 * ese tenant (nunca evaluar sus reglas contra datos de Novasys). Por cada
 * cambio de tenant: setActiveDynamo + setActiveProfiles + setActiveTenant +
 * resetTaxonomyCache (el cache de taxonomía no está keyeado por tenant — G4).
 */

const RULES_TABLE = process.env.RULES_TABLE || "connectview-automation-rules";
const LEADS_TABLE = process.env.LEADS_TABLE || "connectview-leads";
const CALLBACKS_TABLE = process.env.CALLBACKS_TABLE || "connectview-callbacks";
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const JOURNEYS_TABLE = process.env.JOURNEYS_TABLE || "connectview-journeys";
const JOURNEY_ENROLLMENTS_TABLE =
  process.env.JOURNEY_ENROLLMENTS_TABLE || "connectview-journey-enrollments";
const SEND_WA_URL = process.env.SEND_WHATSAPP_TEMPLATE_URL || "";
const INTERNAL_SECRET = process.env.VOX_INTERNAL_SECRET || "";
// #17: cola de entrega durable de webhooks. Si está vacía, actWebhook cae al
// intento único legacy (rollout seguro: sin la cola, el comportamiento no cambia).
const WEBHOOK_QUEUE_URL = process.env.WEBHOOK_QUEUE_URL || "";
const sqs = new SQSClient({});
// send_email: SES v2 (mismo cliente/patrón que journey-runner). From verificado
// del proyecto (novasys.com.pe en producción). Si SES fallara, la acción registra
// el error y la regla sigue con la próxima acción (retry envuelve la llamada).
const ses = new SESv2Client({});
const FROM_EMAIL = process.env.FROM_EMAIL || "ARIA <notificaciones@novasys.com.pe>";
const RUN_TTL_DAYS = Number(process.env.RUN_TTL_DAYS || 60);
/** Tope de disparos por regla por tick (paracaídas anti-blast de WhatsApp). */
const MAX_FIRES_PER_TICK = Number(process.env.MAX_FIRES_PER_TICK || 25);

// Las REGLAS viven SIEMPRE en la cuenta de Vox (config del producto, pooled).
const rulesDynamo = new DynamoDBClient({});
// Leads/callbacks: pooled para novasys; el Data Plane del tenant para BYO.
const legacyDynamo = new DynamoDBClient({});
let leadsDynamo: DynamoDBClient = legacyDynamo;

const HDRS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: HDRS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({
  statusCode: c,
  headers: HDRS,
  body: JSON.stringify({ error: e }),
});

/** Comparación constant-time de secretos (SEC-C4/M4): evita el timing leak de
 *  `===` sobre strings sensibles. Chequea longitud antes de timingSafeEqual (que
 *  lanza si difieren) y nunca tira. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ───────────────────────── tipos ─────────────────────────
type TriggerType =
  | "lead_created"
  | "lead_stage_changed"
  | "lead_inactive"
  | "score_threshold"
  | "wrapup_saved"
  | "whatsapp_flow_completed"
  | "message_inbound"
  | "appointment_scheduled"
  | "tag_applied";
type ActionType =
  | "send_whatsapp_template"
  | "move_stage"
  | "schedule_callback"
  | "enqueue_dialer"
  | "webhook"
  | "send_email"
  | "apply_tag"
  | "remove_tag"
  | "apply_attribute"
  | "apply_score"
  | "set_program"
  | "unsubscribe"
  | "add_note"
  | "mark_salesforce_sync"
  | "unenroll_journey"
  | "notify_agent"
  | "start_journey";

interface Rule {
  tenantId: string;
  sk: string;
  ruleId: string;
  name: string;
  enabled: boolean;
  trigger: { type: TriggerType; params?: Record<string, unknown> };
  conditions?: Cond[];
  actions: Array<{ type: ActionType; params?: Record<string, unknown>; conditions?: Cond[] }>;
}

/** Condición (regla o rama de acción). `op` = eq/neq/contains/exists/notexists. */
type Cond = { field: string; op: string; value: string };

export interface AutomationEvent {
  type: Exclude<TriggerType, "lead_inactive">;
  tenantId: string;
  lead?: {
    leadId?: string;
    phone?: string;
    name?: string;
    email?: string;
    stageId?: string;
    source?: string;
  };
  wrapup?: {
    contactId?: string;
    stage?: string;
    valoracion?: string;
    channel?: string;
    phone?: string;
    customerName?: string;
  };
  /** Para whatsapp_flow_completed (#10): nombre del Flow de Meta. */
  flow?: { name?: string };
  /** Para message_inbound (#15): canal del mensaje entrante. */
  message?: { channel?: string; text?: string };
  /** Para tag_applied (#15): la etiqueta que se aplicó. */
  tag?: string;
}

/** Contexto normalizado sobre el que corren condiciones y acciones. */
interface Ctx {
  tenantId: string;
  leadId?: string;
  contactId?: string;
  phone?: string;
  name?: string;
  email?: string;
  stageId?: string;
  source?: string;
  valoracion?: string;
  channel?: string;
  flowName?: string;
  /** tag_applied: la etiqueta del evento (para matchear condiciones/trigger). */
  tag?: string;
}

interface LeadItem {
  leadId: string;
  phone?: string;
  name?: string;
  email?: string;
  stageId?: string;
  source?: string;
  /** Score numérico del lead (calificación) — lo mueve apply_score / journey adjustScore. */
  score?: number;
  /** Programa/unidad asignada (Pilar 1) — lo setea set_program. */
  programId?: string;
  attributes?: Record<string, string>;
  updatedAt?: string;
  createdAt?: string;
}

// ───────────────────────── helpers ─────────────────────────

async function loadTenantRules(tenantId: string): Promise<Rule[]> {
  const out: Rule[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await rulesDynamo.send(
      new QueryCommand({
        TableName: RULES_TABLE,
        KeyConditionExpression: "tenantId = :t AND begins_with(sk, :p)",
        ExpressionAttributeValues: marshall({ ":t": tenantId, ":p": "rule#" }),
        ExclusiveStartKey: lastKey as never,
      }),
    );
    for (const it of res.Items || []) out.push(unmarshall(it) as Rule);
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return out.filter((r) => r.enabled !== false);
}

/** Todas las reglas habilitadas de todos los tenants (para el tick). */
async function loadAllRules(): Promise<Rule[]> {
  const out: Rule[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await rulesDynamo.send(
      new ScanCommand({
        TableName: RULES_TABLE,
        // Excluir los run# (G9): el log convive en la tabla pero no se evalúa.
        FilterExpression: "begins_with(sk, :p)",
        ExpressionAttributeValues: marshall({ ":p": "rule#" }),
        ExclusiveStartKey: lastKey as never,
      }),
    );
    for (const it of res.Items || []) out.push(unmarshall(it) as Rule);
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return out.filter((r) => r.enabled !== false);
}

// CP "fail-closed" para tenants reales sin rol: domain "" = el upsert del
// Cliente 360° se saltea (client=null caería al dominio LEGACY de Novasys).
const cpFailClosed = new CustomerProfilesClient({ maxAttempts: 1 });

/**
 * Activa el contexto del tenant para TODOS los helpers (leads DDB, Customer
 * Profiles, Salesforce, cache de taxonomía).
 *
 * `strict` (el TICK): tenant real sin Data Plane utilizable → throw → SKIP
 * del tenant (G5: escanear los leads POOLED con reglas de otro tenant sería
 * un leak). `strict=false` (EVENTOS de hooks): el evento ya viene scoped al
 * tenant → fallback al pooled con CP fail-closed — consistente con el
 * whatsapp-meta-webhook, que escribe las sesiones/leads de tenants meta sin
 * Data Plane en el pooled. Acciones sin DDB (webhook, plantilla) corren igual.
 */
async function setupTenant(tenantId: string, strict = true): Promise<void> {
  resetTaxonomyCache(); // G4: el cache no está keyeado por tenant
  setActiveTenant(tenantId); // SF: legacy/master → JWT-bearer; real → su OAuth
  if (isLegacyTenant(tenantId)) {
    leadsDynamo = legacyDynamo;
    setActiveDynamo(null);
    setActiveProfiles(null, null);
    return;
  }
  let tc: Awaited<ReturnType<typeof getTenantConnect>> = null;
  try {
    tc = await getTenantConnect(tenantId);
  } catch {
    tc = null;
  }
  if (tc?.dynamo) {
    leadsDynamo = tc.dynamo;
    setActiveDynamo(tc.dynamo);
    // CP del cliente; domain "" = fail-closed (skip del upsert de perfil).
    setActiveProfiles(tc.customerProfiles ?? null, tc.customerProfilesDomain ?? "");
    return;
  }
  if (strict) throw new Error(`tenant ${tenantId} sin Connect/Data Plane configurado`);
  console.warn(
    `automation: tenant ${tenantId} sin Data Plane — evento procesado contra pooled (CP off)`,
  );
  leadsDynamo = legacyDynamo;
  setActiveDynamo(null);
  setActiveProfiles(cpFailClosed, "");
}

function matchesConditions(rule: Rule, ctx: Ctx): boolean {
  return firstFailedCondition(rule, ctx) === null;
}

/** Evalúa UNA condición (todo en minúsculas). eq/neq/contains comparan contra
 *  `expected`; exists/notexists sólo miran si `actual` tiene valor. Réplica
 *  espejo en manage-automations (dry-run) — mantener ambas en sync. */
function conditionHolds(actual: string, op: string, expected: string): boolean {
  switch (op) {
    case "neq":
      return actual !== expected;
    case "contains":
      return expected === "" || actual.includes(expected);
    case "exists":
      return actual.trim() !== "";
    case "notexists":
      return actual.trim() === "";
    case "eq":
    default:
      return actual === expected;
  }
}

/** Igual que matchesConditions pero devuelve la PRIMERA condición que falla (o
 *  null si todas pasan) — para el detalle de debug del run "skipped". */
function firstFailedCondition(
  rule: Rule,
  ctx: Ctx,
): { field: string; op: string; value: string; actual: string } | null {
  for (const c of rule.conditions || []) {
    const actual = String((ctx as unknown as Record<string, unknown>)[c.field] ?? "").toLowerCase();
    const expected = String(c.value ?? "").toLowerCase();
    if (!conditionHolds(actual, c.op, expected))
      return { field: c.field, op: c.op, value: c.value, actual };
  }
  return null;
}

/** ¿Se cumplen TODAS las condiciones de RAMA de una acción? (mismo eval que la regla).
 *  Sin condiciones → true (la acción corre siempre). */
function actionConditionsMet(conds: Cond[] | undefined, ctx: Ctx): boolean {
  for (const c of conds || []) {
    const actual = String((ctx as unknown as Record<string, unknown>)[c.field] ?? "").toLowerCase();
    const expected = String(c.value ?? "").toLowerCase();
    if (!conditionHolds(actual, c.op, expected)) return false;
  }
  return true;
}

function matchesTrigger(rule: Rule, ev: AutomationEvent): boolean {
  if (rule.trigger.type !== ev.type) return false;
  // lead_stage_changed admite filtrar por etapa destino en los params.
  if (ev.type === "lead_stage_changed") {
    const want = String(rule.trigger.params?.stageId || "");
    if (want && want !== String(ev.lead?.stageId || "")) return false;
  }
  // whatsapp_flow_completed admite filtrar por nombre del Flow.
  if (ev.type === "whatsapp_flow_completed") {
    const want = String(rule.trigger.params?.flowName || "").toLowerCase();
    if (want && want !== String(ev.flow?.name || "").toLowerCase()) return false;
  }
  // message_inbound admite filtrar por canal (whatsapp/instagram/messenger).
  if (ev.type === "message_inbound") {
    const want = String(rule.trigger.params?.channel || "").toLowerCase();
    if (want && want !== String(ev.message?.channel || "").toLowerCase()) return false;
  }
  // tag_applied admite filtrar por la etiqueta específica.
  if (ev.type === "tag_applied") {
    const want = String(rule.trigger.params?.tag || "").toLowerCase();
    if (want && want !== String(ev.tag || "").toLowerCase()) return false;
  }
  // appointment_scheduled: sin params → siempre matchea si el type coincide.
  return true;
}

function ctxFromEvent(ev: AutomationEvent): Ctx {
  if (ev.type === "wrapup_saved") {
    return {
      tenantId: ev.tenantId,
      contactId: ev.wrapup?.contactId,
      phone: ev.wrapup?.phone,
      name: ev.wrapup?.customerName,
      stageId: ev.wrapup?.stage,
      valoracion: ev.wrapup?.valoracion,
      channel: ev.wrapup?.channel,
    };
  }
  return {
    tenantId: ev.tenantId,
    leadId: ev.lead?.leadId,
    phone: ev.lead?.phone,
    name: ev.lead?.name,
    email: ev.lead?.email,
    stageId: ev.lead?.stageId,
    source: ev.lead?.source,
    flowName: ev.flow?.name,
    // message_inbound: el canal del mensaje entra como `channel` (matcheable).
    channel: ev.message?.channel || undefined,
    tag: ev.tag || undefined,
  };
}

/** Tokens {{name}}/{{phone}}/{{stage}}/{{email}} en variables, notas y emails.
 *  Acepta también [[name]] (el formato que muestra la UI de Automatizaciones):
 *  normalizamos [[token]] → {{token}} antes de reemplazar. */
function fillTokens(s: string, ctx: Ctx): string {
  return s
    .replace(/\[\[\s*(\w+)\s*\]\]/g, "{{$1}}")
    .replace(/\{\{\s*name\s*\}\}/gi, ctx.name || "")
    .replace(/\{\{\s*phone\s*\}\}/gi, ctx.phone || "")
    .replace(/\{\{\s*stage\s*\}\}/gi, ctx.stageId || "")
    .replace(/\{\{\s*email\s*\}\}/gi, ctx.email || "");
}

async function findLeadByPhone(phone: string): Promise<LeadItem | null> {
  if (!phone) return null;
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await leadsDynamo.send(
      new ScanCommand({ TableName: LEADS_TABLE, ExclusiveStartKey: lastKey as never }),
    );
    for (const it of res.Items || []) {
      const l = unmarshall(it) as LeadItem;
      if ((l.phone || "").trim() === phone.trim()) return l;
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return null;
}

async function getLead(leadId: string): Promise<LeadItem | null> {
  const r = await leadsDynamo.send(
    new GetItemCommand({ TableName: LEADS_TABLE, Key: { leadId: { S: leadId } } }),
  );
  return r.Item ? (unmarshall(r.Item) as LeadItem) : null;
}

// ───────────────────────── acciones ─────────────────────────

async function actSendTemplate(ctx: Ctx, params: Record<string, unknown>): Promise<string | null> {
  if (!SEND_WA_URL) return "SEND_WHATSAPP_TEMPLATE_URL no configurado";
  const phone = (ctx.phone || "").trim();
  if (!phone) return "lead sin teléfono";
  const templateName = String(params.templateName || "");
  if (!templateName) return "templateName requerido";
  const variables = (Array.isArray(params.variables) ? params.variables : []).map((v) =>
    fillTokens(String(v), ctx),
  );
  const r = await fetch(SEND_WA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-vox-internal": INTERNAL_SECRET },
    body: JSON.stringify({
      phone,
      templateName,
      language: String(params.language || "es"),
      variables,
      tenantId: ctx.tenantId, // BYO: manda desde el número del CLIENTE
    }),
  });
  const body = (await r.json().catch(() => ({}))) as {
    sent?: boolean;
    error?: string;
    suppressed?: boolean;
    blockedBy?: string;
  };
  // Pilar 3: el gate suprimió el envío (opt-out/DNC/dedup/frecuencia). NO es un
  // error — la regla simplemente no manda a ese número. No reintentar ni alarmar.
  if (body.suppressed) {
    console.log(`automation: WhatsApp suprimido (${body.blockedBy || "?"})`);
    return null;
  }
  if (!r.ok || !body.sent) return body.error || `send falló (HTTP ${r.status})`;
  return null;
}

async function actMoveStage(ctx: Ctx, params: Record<string, unknown>): Promise<string | null> {
  const stageId = String(params.stageId || "");
  if (!stageId) return "stageId requerido";
  // Resolver el lead: por id, o por teléfono (eventos de wrap-up).
  let leadId = ctx.leadId;
  if (!leadId && ctx.phone) leadId = (await findLeadByPhone(ctx.phone))?.leadId;
  if (!leadId) return "lead no encontrado";

  const now = new Date().toISOString();
  await leadsDynamo.send(
    new UpdateItemCommand({
      TableName: LEADS_TABLE,
      Key: { leadId: { S: leadId } },
      UpdateExpression: "SET stageId = :s, updatedAt = :t",
      ExpressionAttributeValues: { ":s": { S: stageId }, ":t": { S: now } },
      ConditionExpression: "attribute_exists(leadId)",
    }),
  );
  const stageLabel = await stageIdToLabel(stageId, ctx.programId);
  await appendLeadHistory(leadId, {
    ts: now,
    type: "stage_change",
    stageId,
    stageLabel,
    notes: "Automatización",
  });
  // Propagar a Customer Profile + Salesforce (mismo efecto que manage-leads).
  try {
    const l = await getLead(leadId);
    if (l?.phone) {
      await propagateLead(
        {
          phone: l.phone,
          name: l.name,
          programId: ctx.programId,
          stageId: l.stageId,
          source: l.source || "Vox Leads",
          attributes: l.attributes,
        },
        { origin: "vox" },
      );
    }
  } catch (err) {
    console.warn("automation move_stage propagate failed", err);
  }
  return null;
}

async function actScheduleCallback(
  ctx: Ctx,
  params: Record<string, unknown>,
): Promise<string | null> {
  // G6: el callback-dispatcher es pooled/legacy hoy → solo tenant fundador.
  if (!isLegacyTenant(ctx.tenantId)) return "schedule_callback aún no soportado para tenants BYO";
  const phone = (ctx.phone || "").trim();
  if (!phone) return "lead sin teléfono";
  const offsetHours = Number(params.offsetHours ?? 24);
  const channel = String(params.channel || "voice");
  const scheduledAt = new Date(Date.now() + offsetHours * 3600_000).toISOString();
  const nowIso = new Date().toISOString();
  // Shape EXACTO que pesca el dispatcher (incluye actionType + GSI status/scheduledAt).
  const item: Record<string, { S: string } | { N: string }> = {
    callbackId: { S: randomUUID() },
    phone: { S: phone },
    customerName: { S: ctx.name || "" },
    scheduledAt: { S: scheduledAt },
    assignedAgentUserId: { S: String(params.assignedAgentUserId || "") },
    notes: { S: fillTokens(String(params.notes || "Seguimiento automático"), ctx) },
    channel: { S: channel },
    actionType: { S: channel === "voice" ? "auto-dispatch" : "manual-action" },
    campaignId: { S: "" },
    contactFlowId: { S: "" },
    sourcePhoneNumber: { S: "" },
    customAttributes: { S: JSON.stringify({ automation: "1" }) },
    status: { S: "SCHEDULED" },
    attempts: { N: "0" },
    createdAt: { S: nowIso },
    updatedAt: { S: nowIso },
  };
  if (channel === "whatsapp" && params.templateName)
    item.templateName = { S: String(params.templateName) };
  await legacyDynamo.send(new PutItemCommand({ TableName: CALLBACKS_TABLE, Item: item }));
  return null;
}

/** Encola una llamada saliente AHORA por una campaña de voz (auto-dispatch).
 *  Espejo de journey-runner enqueueDialer: resuelve el flow/número de la campaña y
 *  escribe un callback voice que pesca el dispatcher (pooled/legacy → gate legacy). */
async function actEnqueueDialer(ctx: Ctx, params: Record<string, unknown>): Promise<string | null> {
  if (!isLegacyTenant(ctx.tenantId)) return "enqueue_dialer aún no soportado para tenants BYO";
  const phone = (ctx.phone || "").trim();
  if (!phone) return "lead sin teléfono";
  const campaignId = String(params.campaignId || "");
  let contactFlowId = "";
  let sourcePhoneNumber = "";
  if (campaignId) {
    try {
      const c = await legacyDynamo.send(
        new GetItemCommand({ TableName: CAMPAIGNS_TABLE, Key: { campaignId: { S: campaignId } } }),
      );
      if (c.Item) {
        const camp = unmarshall(c.Item) as { contactFlowId?: string; sourcePhoneNumber?: string };
        contactFlowId = String(camp.contactFlowId || "");
        sourcePhoneNumber = String(camp.sourcePhoneNumber || "");
      }
    } catch {
      /* cae al flow por defecto del dispatcher (fail-open) */
    }
  }
  const nowIso = new Date().toISOString();
  const item = marshall(
    {
      callbackId: randomUUID(),
      phone,
      customerName: ctx.name || "",
      scheduledAt: nowIso, // inmediato: el dispatcher lo toma en su próximo tick
      assignedAgentUserId: "", // sin agente fijo: la cola de la campaña/flow rutea
      notes: fillTokens(String(params.notes || "Automatización: llamada"), ctx).slice(0, 1024),
      channel: "voice",
      actionType: "auto-dispatch",
      campaignId,
      contactFlowId, // ← el dispatcher enruta por este flow (cola de la campaña)
      sourcePhoneNumber, // ← número saliente de la campaña (o default)
      customAttributes: JSON.stringify({ automation: "1", kind: "dialer", campaignId }),
      status: "SCHEDULED",
      attempts: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    { removeUndefinedValues: true },
  );
  await legacyDynamo.send(new PutItemCommand({ TableName: CALLBACKS_TABLE, Item: item }));
  return null;
}

async function actWebhook(
  ctx: Ctx,
  params: Record<string, unknown>,
  ruleName: string,
  ruleId?: string,
): Promise<string | null> {
  const url = String(params.url || "");
  if (!/^https?:\/\//.test(url)) return "url inválida";
  const payload = {
    source: "aria-automation",
    rule: ruleName,
    tenantId: ctx.tenantId,
    leadId: ctx.leadId,
    contactId: ctx.contactId,
    phone: ctx.phone,
    name: ctx.name,
    stageId: ctx.stageId,
    at: new Date().toISOString(),
  };

  // #17: entrega DURABLE. Encolamos a SQS; el webhook-dispatcher reintenta con
  // backoff exponencial multi-día y lo registra en connectview-webhook-deliveries.
  // Devolvemos null (encolado) — el resultado real de la entrega vive en la tabla.
  if (WEBHOOK_QUEUE_URL) {
    try {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: WEBHOOK_QUEUE_URL,
          MessageBody: JSON.stringify({
            kind: "new",
            url,
            payload,
            tenantId: ctx.tenantId,
            ruleId,
            ruleName,
          }),
        }),
      );
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "no se pudo encolar el webhook";
    }
  }

  // Fallback legacy (sin cola configurada aún): 1 intento directo.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!r.ok) return `webhook HTTP ${r.status}`;
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "webhook falló";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resuelve el lead objetivo de una acción que necesita el item (email/tags/attrs):
 * por leadId directo, o por teléfono (eventos de wrap-up / message_inbound). null
 * si no se puede resolver.
 */
async function resolveLead(ctx: Ctx): Promise<LeadItem | null> {
  if (ctx.leadId) {
    const l = await getLead(ctx.leadId);
    if (l) return l;
  }
  if (ctx.phone) return findLeadByPhone(ctx.phone);
  return null;
}

async function actSendEmail(ctx: Ctx, params: Record<string, unknown>): Promise<string | null> {
  const subject = fillTokens(String(params.subject || ""), ctx).trim();
  const bodyText = fillTokens(String(params.body || ""), ctx);
  if (!subject) return "subject requerido";
  if (!bodyText.trim()) return "body requerido";
  // El "para" = email del lead. Si el ctx no lo trae (wrap-up), lo cargamos.
  let to = (ctx.email || "").trim();
  let leadId = ctx.leadId;
  if (!to) {
    const lead = await resolveLead(ctx);
    to = (lead?.email || "").trim();
    leadId = leadId || lead?.leadId;
  }
  if (!to) return "lead sin email";
  // Gate de supresión channel-scoped (email) — igual que journey-runner. Best-effort.
  const phone = (ctx.phone || "").trim();
  if (phone) {
    try {
      const v = await evaluateSend(leadsDynamo, {
        phone,
        channel: "email",
        tenantId: ctx.tenantId,
      });
      if (!v.allowed) {
        console.log(`automation: email suprimido (${v.blockedBy || "?"})`);
        return null; // suprimido no es error (mismo criterio que actSendTemplate)
      }
    } catch {
      /* gate best-effort: si falla la evaluación, seguimos con el envío */
    }
  }
  const brandEmailHtml = (bodyHtml: string) =>
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e9f0;border-radius:12px;overflow:hidden">` +
    `<div style="background:linear-gradient(135deg,#2c5698,#158a8c);padding:16px 22px"><span style="color:#ffffff;font-weight:800;font-size:18px;letter-spacing:-0.02em">ARIA</span><span style="color:rgba(255,255,255,0.72);font-size:11px;margin-left:7px">by Novasys</span></div>` +
    `<div style="padding:22px;color:#141c2b;font-size:14px;line-height:1.62">${bodyHtml}</div>` +
    `<div style="padding:12px 22px;background:#fbfaf9;border-top:1px solid #e7e9f0;color:#7c879e;font-size:11px">Enviado por ARIA · by Novasys</div>` +
    `</div>`;
  const html = brandEmailHtml(bodyText.replace(/\n/g, "<br>"));
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: bodyText, Charset: "UTF-8" },
            Html: { Data: html, Charset: "UTF-8" },
          },
        },
      },
    }),
  );
  // El envío es un golpe (Pilar 2). Best-effort — no aborta si falla el historial.
  if (leadId) {
    try {
      await appendLeadHistory(leadId, {
        ts: new Date().toISOString(),
        type: "email_out",
        channel: "Correo",
        direction: "out",
        summary: subject,
        notes: "Automatización",
      });
    } catch {
      /* best-effort */
    }
  }
  return null;
}

/**
 * Aplica una etiqueta al lead. Convención: `attributes.tags` = CSV (dedup
 * case-insensitive), el mismo shape que edita el bot-runtime (state.vars.tags).
 * Escritura DIRECTA a DDB (anti-loop): NO re-dispara `tag_applied`.
 */
async function actApplyTag(ctx: Ctx, params: Record<string, unknown>): Promise<string | null> {
  const tag = fillTokens(String(params.tag || ""), ctx).trim();
  if (!tag) return "tag requerido";
  const lead = await resolveLead(ctx);
  if (!lead) return "lead no encontrado";
  const current = String(lead.attributes?.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (current.some((t) => t.toLowerCase() === tag.toLowerCase())) return null; // ya lo tiene
  const next = [...current, tag].join(", ").slice(0, 1024);
  // Dos pasos (attributes puede no existir) — mismo patrón que writeFiredMarker.
  await leadsDynamo
    .send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: lead.leadId } },
        UpdateExpression: "SET attributes = if_not_exists(attributes, :empty)",
        ExpressionAttributeValues: { ":empty": { M: {} } },
      }),
    )
    .catch(() => {});
  await leadsDynamo.send(
    new UpdateItemCommand({
      TableName: LEADS_TABLE,
      Key: { leadId: { S: lead.leadId } },
      UpdateExpression: "SET attributes.#k = :v, updatedAt = :t",
      ExpressionAttributeNames: { "#k": "tags" },
      ExpressionAttributeValues: { ":v": { S: next }, ":t": { S: new Date().toISOString() } },
    }),
  );
  return null;
}

/**
 * Setea un atributo arbitrario del lead: `attributes[field] = value`. Escritura
 * DIRECTA a DDB (anti-loop). El nombre del campo se sanea (sin puntos, ≤64).
 */
async function actApplyAttribute(
  ctx: Ctx,
  params: Record<string, unknown>,
): Promise<string | null> {
  const field = String(params.field || "")
    .trim()
    .replace(/[^\w.-]/g, "_")
    .slice(0, 64);
  if (!field) return "field requerido";
  const value = fillTokens(String(params.value ?? ""), ctx).slice(0, 512);
  const lead = await resolveLead(ctx);
  if (!lead) return "lead no encontrado";
  await leadsDynamo
    .send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: lead.leadId } },
        UpdateExpression: "SET attributes = if_not_exists(attributes, :empty)",
        ExpressionAttributeValues: { ":empty": { M: {} } },
      }),
    )
    .catch(() => {});
  await leadsDynamo.send(
    new UpdateItemCommand({
      TableName: LEADS_TABLE,
      Key: { leadId: { S: lead.leadId } },
      UpdateExpression: "SET attributes.#k = :v, updatedAt = :t",
      ExpressionAttributeNames: { "#k": field },
      ExpressionAttributeValues: { ":v": { S: value }, ":t": { S: new Date().toISOString() } },
    }),
  );
  return null;
}

/**
 * Quita una etiqueta del lead (inverso de actApplyTag). Lee el CSV
 * `attributes.tags`, filtra la etiqueta (case-insensitive) y reescribe. Si el
 * lead no la tenía → no-op. Escritura DIRECTA a DDB (anti-loop).
 */
async function actRemoveTag(ctx: Ctx, params: Record<string, unknown>): Promise<string | null> {
  const tag = fillTokens(String(params.tag || ""), ctx).trim();
  if (!tag) return "tag requerido";
  const lead = await resolveLead(ctx);
  if (!lead) return "lead no encontrado";
  const current = String(lead.attributes?.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const next = current.filter((t) => t.toLowerCase() !== tag.toLowerCase());
  if (next.length === current.length) return null; // no la tenía (incluye lista vacía)
  // Sólo llegamos aquí si tenía tags → attributes.tags existe → el SET del path es seguro.
  await leadsDynamo.send(
    new UpdateItemCommand({
      TableName: LEADS_TABLE,
      Key: { leadId: { S: lead.leadId } },
      UpdateExpression: "SET attributes.#k = :v, updatedAt = :t",
      ExpressionAttributeNames: { "#k": "tags" },
      ExpressionAttributeValues: {
        ":v": { S: next.join(", ").slice(0, 1024) },
        ":t": { S: new Date().toISOString() },
      },
    }),
  );
  return null;
}

/**
 * Suma/resta puntos al `score` del lead (calificación). Espejo de
 * journey-runner adjustScore. Escritura DIRECTA a DDB (anti-loop).
 */
async function actScore(ctx: Ctx, params: Record<string, unknown>): Promise<string | null> {
  const d = Number(params.delta || 0);
  if (!d) return "puntos requeridos (≠ 0)";
  const lead = await resolveLead(ctx);
  if (!lead) return "lead no encontrado";
  const next = (Number(lead.score ?? 0) || 0) + d;
  await leadsDynamo.send(
    new UpdateItemCommand({
      TableName: LEADS_TABLE,
      Key: { leadId: { S: lead.leadId } },
      UpdateExpression: "SET #s = :v, updatedAt = :t",
      ExpressionAttributeNames: { "#s": "score" },
      ExpressionAttributeValues: {
        ":v": { N: String(next) },
        ":t": { S: new Date().toISOString() },
      },
    }),
  );
  return null;
}

/**
 * Asigna el lead a un programa/unidad (Pilar 1). Espejo de journey-runner
 * setProgram. Escritura DIRECTA a DDB (anti-loop).
 */
async function actSetProgram(ctx: Ctx, params: Record<string, unknown>): Promise<string | null> {
  const programId = String(params.programId || "").trim();
  if (!programId) return "programa requerido";
  const lead = await resolveLead(ctx);
  if (!lead) return "lead no encontrado";
  await leadsDynamo.send(
    new UpdateItemCommand({
      TableName: LEADS_TABLE,
      Key: { leadId: { S: lead.leadId } },
      UpdateExpression: "SET programId = :p, updatedAt = :t",
      ExpressionAttributeValues: {
        ":p": { S: programId },
        ":t": { S: new Date().toISOString() },
      },
    }),
  );
  return null;
}

/**
 * Da de baja al lead: supresión REAL (opted_out) por canal, respetando el mismo
 * store que el gate de envío (evaluateSend). Espejo del branch unsubscribe de
 * journey-runner setSubscription. Requiere teléfono (clave de supresión).
 */
async function actUnsubscribe(ctx: Ctx, params: Record<string, unknown>): Promise<string | null> {
  const channel = String(params.channel || "all");
  const channels = channel === "all" ? ["whatsapp", "email"] : [channel];
  const lead = await resolveLead(ctx);
  const phone = (ctx.phone || lead?.phone || "").trim();
  if (!phone) return "lead sin teléfono";
  // La tabla de supresión es de PLATAFORMA (cuenta Novasys): escribir con el
  // cliente base (legacyDynamo), NO con leadsDynamo (rol del tenant en BYO →
  // cuenta equivocada). Mismo criterio que journey-runner (usa su cliente base).
  await recordSuppression(legacyDynamo, phone, {
    status: "opted_out",
    channels,
    reason: "Automatización: baja de suscripción",
    source: "manual",
    tenantId: ctx.tenantId || undefined,
    leadId: lead?.leadId,
  });
  return null;
}

/**
 * Crea una notificación in-app para un agente. Best-effort: reusa
 * `connectview-callbacks` con canal "notification" (no hay tabla dedicada limpia
 * hoy; el bubble de "Tareas" ya lee de esta tabla). El dispatcher IGNORA este
 * tipo (actionType "none" + channel "notification" ≠ auto-dispatch/manual-action),
 * así que no genera llamadas ni WhatsApp: solo aparece como tarea del agente.
 */
async function actNotifyAgent(ctx: Ctx, params: Record<string, unknown>): Promise<string | null> {
  const message = fillTokens(String(params.message || ""), ctx).trim();
  if (!message) return "message requerido";
  const nowIso = new Date().toISOString();
  // assignedAgentUserId es KEY del GSI agent-scheduledAt-index → NO puede ser ""
  // (rompe el PutItem con "parameter values are not valid"). Sin agente asignado se
  // OMITE (aviso general, visible para admins/supervisores en la campana). Los demás
  // campos vacíos también se omiten vía removeUndefinedValues.
  const item = marshall(
    {
      callbackId: randomUUID(),
      phone: (ctx.phone || "").trim() || undefined,
      customerName: ctx.name || undefined,
      scheduledAt: nowIso, // "ahora": es un aviso, no un futuro
      assignedAgentUserId: String(params.agent || "").trim() || undefined,
      notes: message.slice(0, 1024),
      channel: "notification",
      actionType: "none", // el dispatcher no la toca (ni voz ni wa)
      customAttributes: JSON.stringify({ automation: "1", kind: "notification" }),
      status: "SCHEDULED",
      attempts: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    { removeUndefinedValues: true },
  );
  // La notificación (channel="notification") vive en la tabla de callbacks del
  // DATA PLANE del tenant (leadsDynamo, igual que apply_tag/apply_attribute):
  // pooled para Novasys/default, la cuenta del cliente para BYO. Antes estaba
  // gateada a solo-fundador; ya no. Si la tabla no existe en el BYO, el PutItem
  // tira y el motor lo registra como error de acción (degrada, no rompe la regla).
  await leadsDynamo.send(new PutItemCommand({ TableName: CALLBACKS_TABLE, Item: item }));
  return null;
}

/**
 * Inscribe al lead en un Journey (Engagement Studio): crea un enrollment activo en
 * connectview-journey-enrollments y el journey-runner lo hace avanzar en su tick.
 * Idempotente (no re-inscribe si ya existe, por ConditionExpression). Tablas
 * pooled (founder) hoy — mismo alcance que actNotifyAgent/actScheduleCallback.
 */
async function actStartJourney(ctx: Ctx, params: Record<string, unknown>): Promise<string | null> {
  if (!isLegacyTenant(ctx.tenantId)) return "start_journey aún no soportado para tenants BYO";
  const journeyId = String(params.journeyId || "").trim();
  if (!journeyId) return "journeyId requerido";
  if (!ctx.leadId) return "el disparador no tiene lead (start_journey necesita uno)";
  const jr = await legacyDynamo.send(
    new GetItemCommand({
      TableName: JOURNEYS_TABLE,
      Key: { tenantId: { S: ctx.tenantId || "" }, journeyId: { S: journeyId } },
    }),
  );
  if (!jr.Item) return "journey no encontrado";
  const journey = unmarshall(jr.Item) as JourneyDef;
  if (journey.status !== "active") return `el journey "${journey.name}" no está activo`;
  const entry = entryNodeId(journey) || "";
  const nowIso = new Date().toISOString();
  try {
    await legacyDynamo.send(
      new PutItemCommand({
        TableName: JOURNEY_ENROLLMENTS_TABLE,
        Item: marshall(
          {
            journeyId,
            leadId: ctx.leadId,
            tenantId: journey.tenantId || ctx.tenantId || undefined,
            currentNodeId: entry,
            status: "active",
            enteredAt: nowIso,
            nextRunAt: nowIso,
            history: [{ node: entry, at: nowIso, note: "inscrito por automatización" }],
          },
          { removeUndefinedValues: true },
        ),
        ConditionExpression: "attribute_not_exists(journeyId)",
      }),
    );
  } catch (e) {
    // Ya inscrito → idempotente, no es error de negocio.
    if (e instanceof Error && e.name === "ConditionalCheckFailedException") return null;
    throw e; // transitorio → executeRule reintenta
  }
  return null;
}

/** Deja una nota interna en el historial del lead. Espejo de journey-runner addNote. */
async function actAddNote(ctx: Ctx, params: Record<string, unknown>): Promise<string | null> {
  const text = fillTokens(String(params.text || ""), ctx).trim();
  if (!text) return "texto requerido";
  const lead = await resolveLead(ctx);
  const leadId = ctx.leadId || lead?.leadId;
  if (!leadId) return "lead no encontrado";
  await appendLeadHistory(leadId, {
    ts: new Date().toISOString(),
    type: "note",
    notes: `Automatización: ${text}`,
  });
  return null;
}

/** Marca el lead para sincronizar a Salesforce (lo levanta el sync de SF).
 *  Espejo de journey-runner markSalesforceSync. Escritura DIRECTA a DDB (anti-loop). */
async function actMarkSalesforceSync(ctx: Ctx): Promise<string | null> {
  const lead = await resolveLead(ctx);
  const leadId = ctx.leadId || lead?.leadId;
  if (!leadId) return "lead no encontrado";
  const now = new Date().toISOString();
  await leadsDynamo.send(
    new UpdateItemCommand({
      TableName: LEADS_TABLE,
      Key: { leadId: { S: leadId } },
      UpdateExpression: "SET sfSyncPending = :t, updatedAt = :u",
      ExpressionAttributeValues: { ":t": { S: now }, ":u": { S: now } },
    }),
  );
  return null;
}

/** Saca al lead de un journey (enrollment status=exited). Espejo de journey-runner
 *  unenrollFrom. Enrollments = tabla de PLATAFORMA (legacyDynamo); gate a tenants
 *  legacy, igual que start_journey. */
async function actUnenrollJourney(
  ctx: Ctx,
  params: Record<string, unknown>,
): Promise<string | null> {
  if (!isLegacyTenant(ctx.tenantId)) return "unenroll_journey aún no soportado para tenants BYO";
  const journeyId = String(params.journeyId || "").trim();
  if (!journeyId) return "journeyId requerido";
  const lead = await resolveLead(ctx);
  const leadId = ctx.leadId || lead?.leadId;
  if (!leadId) return "lead no encontrado";
  try {
    await legacyDynamo.send(
      new UpdateItemCommand({
        TableName: JOURNEY_ENROLLMENTS_TABLE,
        Key: { journeyId: { S: journeyId }, leadId: { S: leadId } },
        UpdateExpression: "SET #st = :s, updatedAt = :u",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":s": { S: "exited" },
          ":u": { S: new Date().toISOString() },
        },
        ConditionExpression: "attribute_exists(journeyId)",
      }),
    );
  } catch {
    // No estaba inscrito → no-op silencioso.
  }
  return null;
}

// ───────────────────────── ejecución + log ─────────────────────────

/** Resumen corto y SIN PII de los params de una acción (para depurar el run). */
function actionDetail(action: string, params: Record<string, unknown>): string | undefined {
  switch (action) {
    case "send_whatsapp_template":
      return `plantilla ${String(params.templateName || "?")}`;
    case "move_stage":
      return `→ etapa ${String(params.stageId || "?")}`;
    case "schedule_callback":
      return `callback ${String(params.channel || "voice")} +${Number(params.offsetHours ?? 24)}h`;
    case "enqueue_dialer":
      return `dialer campaña ${String(params.campaignId || "default")}`;
    case "webhook":
      return "POST webhook";
    case "send_email":
      return `email: ${String(params.subject || "").slice(0, 60)}`;
    case "apply_tag":
      return `tag ${String(params.tag || "?")}`;
    case "remove_tag":
      return `quita tag ${String(params.tag || "?")}`;
    case "apply_attribute":
      return `${String(params.field || "?")}=${String(params.value ?? "").slice(0, 40)}`;
    case "apply_score":
      return `score ${Number(params.delta) >= 0 ? "+" : ""}${Number(params.delta || 0)}`;
    case "set_program":
      return `→ programa ${String(params.programId || "?")}`;
    case "unsubscribe":
      return `baja ${String(params.channel || "all")}`;
    case "add_note":
      return "nota interna";
    case "mark_salesforce_sync":
      return "→ Salesforce";
    case "unenroll_journey":
      return `salir journey ${String(params.journeyId || "?")}`;
    case "notify_agent":
      return `aviso a ${String(params.agent || "equipo")}`;
    case "start_journey":
      return `→ journey ${String(params.journeyId || "?")}`;
    default:
      return undefined;
  }
}

async function logRun(
  tenantId: string,
  rule: Rule,
  triggerType: string,
  action: string,
  ctx: Ctx,
  error: string | null,
  detail?: string,
): Promise<void> {
  const at = new Date().toISOString();
  // Sin PII: solo referencias (ids). Nada de phone/nombre en el log.
  const run = {
    tenantId,
    sk: `run#${rule.ruleId}#${at}#${randomUUID().slice(0, 6)}`,
    ruleId: rule.ruleId,
    ruleName: rule.name,
    trigger: triggerType,
    action,
    leadId: ctx.leadId || undefined,
    contactId: ctx.contactId || undefined,
    ok: !error,
    // detail = resumen de la acción (params, truncado); error = mensaje completo ≤500.
    detail: detail ? detail.slice(0, 200) : undefined,
    error: error ? error.slice(0, 500) : undefined,
    at,
    expireAt: Math.floor(Date.now() / 1000) + RUN_TTL_DAYS * 86400,
  };
  await rulesDynamo
    .send(
      new PutItemCommand({
        TableName: RULES_TABLE,
        Item: marshall(run, { removeUndefinedValues: true }),
      }),
    )
    .catch((e) => console.warn("logRun failed", e));
}

async function bumpRule(tenantId: string, ruleId: string): Promise<void> {
  await rulesDynamo
    .send(
      new UpdateItemCommand({
        TableName: RULES_TABLE,
        Key: marshall({ tenantId, sk: `rule#${ruleId}` }),
        UpdateExpression: "SET firedCount = if_not_exists(firedCount, :z) + :one, lastFiredAt = :t",
        ExpressionAttributeValues: marshall({ ":z": 0, ":one": 1, ":t": new Date().toISOString() }),
      }),
    )
    .catch((e) => console.warn("bumpRule failed", e));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Backoff de reintentos para errores TRANSITORIOS (2 reintentos). */
const RETRY_DELAYS_MS = [300, 900];

/** Despacha UNA acción. Devuelve string = error de negocio (4xx claro, NO se
 *  reintenta); throw = error transitorio (red/DDB/SES, SÍ se reintenta). */
async function dispatchAction(
  action: { type: ActionType; params?: Record<string, unknown> },
  ctx: Ctx,
  rule: Rule,
): Promise<string | null> {
  const p = action.params || {};
  switch (action.type) {
    case "send_whatsapp_template":
      return actSendTemplate(ctx, p);
    case "move_stage":
      return actMoveStage(ctx, p);
    case "schedule_callback":
      return actScheduleCallback(ctx, p);
    case "enqueue_dialer":
      return actEnqueueDialer(ctx, p);
    case "webhook":
      return actWebhook(ctx, p, rule.name, rule.ruleId);
    case "send_email":
      return actSendEmail(ctx, p);
    case "apply_tag":
      return actApplyTag(ctx, p);
    case "remove_tag":
      return actRemoveTag(ctx, p);
    case "apply_attribute":
      return actApplyAttribute(ctx, p);
    case "apply_score":
      return actScore(ctx, p);
    case "set_program":
      return actSetProgram(ctx, p);
    case "unsubscribe":
      return actUnsubscribe(ctx, p);
    case "add_note":
      return actAddNote(ctx, p);
    case "mark_salesforce_sync":
      return actMarkSalesforceSync(ctx);
    case "unenroll_journey":
      return actUnenrollJourney(ctx, p);
    case "notify_agent":
      return actNotifyAgent(ctx, p);
    case "start_journey":
      return actStartJourney(ctx, p);
    default:
      return `acción desconocida: ${action.type}`;
  }
}

/** Ejecuta las acciones de una regla sobre un contexto; devuelve cuántas OK.
 *  Cada acción se envuelve en RETRY con backoff para fallos transitorios (throw);
 *  los errores de validación (string devuelto) NO se reintentan. Si una acción
 *  agota los reintentos, se loguea y se CONTINÚA con la siguiente (no aborta). */
async function executeRule(rule: Rule, triggerType: string, ctx: Ctx): Promise<number> {
  let okCount = 0;
  for (const action of rule.actions || []) {
    // Rama por-acción: si tiene condiciones propias y NO se cumplen, se salta
    // (silenciosa: es control de flujo esperado, no un error).
    if (action.conditions?.length && !actionConditionsMet(action.conditions, ctx)) continue;
    const detail = actionDetail(action.type, action.params || {});
    let error: string | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        error = await dispatchAction(action, ctx, rule);
        // string devuelto = error de negocio/validación → NO reintentar.
        break;
      } catch (err) {
        error = err instanceof Error ? err.message : "error";
        if (attempt < RETRY_DELAYS_MS.length) {
          console.warn(
            `rule ${rule.ruleId} action ${action.type} throw (intento ${attempt + 1}): ${error} — reintentando`,
          );
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue; // transitorio → reintentar
        }
        break; // agotó reintentos → loguear y seguir con la próxima acción
      }
    }
    await logRun(ctx.tenantId, rule, triggerType, action.type, ctx, error, detail);
    if (!error) okCount++;
    else console.warn(`rule ${rule.ruleId} action ${action.type} failed: ${error}`);
  }
  await bumpRule(ctx.tenantId, rule.ruleId);
  return okCount;
}

// ───────────────────────── eventos (hooks) ─────────────────────────

async function processEvent(ev: AutomationEvent): Promise<{ matched: number; fired: number }> {
  if (!ev?.type || !ev?.tenantId) return { matched: 0, fired: 0 };
  const rules = (await loadTenantRules(ev.tenantId)).filter(
    (r) =>
      r.trigger.type !== "lead_inactive" &&
      r.trigger.type !== "score_threshold" &&
      matchesTrigger(r, ev),
  );
  const ctx = ctxFromEvent(ev);
  const matched: Rule[] = [];
  const skipped: Array<{ rule: Rule; fail: NonNullable<ReturnType<typeof firstFailedCondition>> }> =
    [];
  for (const r of rules) {
    const fail = firstFailedCondition(r, ctx);
    if (fail) skipped.push({ rule: r, fail });
    else matched.push(r);
  }
  // Debug barato: reglas que matchearon el trigger pero no las condiciones dejan
  // un run "skipped" (ok:true) para explicar el "no disparó" sin ejecutar nada.
  for (const s of skipped) {
    await logRun(
      ev.tenantId,
      s.rule,
      ev.type,
      "skipped",
      ctx,
      null,
      `condición no cumplida: ${s.fail.field} ${s.fail.op} "${s.fail.value}" (actual: "${s.fail.actual}")`,
    );
  }
  if (matched.length === 0) return { matched: 0, fired: 0 };

  await setupTenant(ev.tenantId, false); // eventos: fallback pooled (no estricto)
  // Enriquecer el ctx con el lead resuelto (por leadId/teléfono) cuando el evento
  // no trajo nombre — así los tokens {{name}}/{{email}}/{{stage}} de las acciones
  // (notify_agent, send_email…) funcionan aunque el disparador solo mande el
  // teléfono (p.ej. message_inbound del webhook manda `lead: { phone }`).
  if (!ctx.name && (ctx.phone || ctx.leadId)) {
    const lead = await resolveLead(ctx);
    if (lead) {
      ctx.name = ctx.name || lead.name;
      ctx.email = ctx.email || lead.email;
      ctx.stageId = ctx.stageId || lead.stageId;
      ctx.leadId = ctx.leadId || lead.leadId;
    }
  }
  let fired = 0;
  for (const rule of matched) fired += await executeRule(rule, ev.type, ctx);
  return { matched: matched.length, fired };
}

// ───────────────────────── tick (lead_inactive) ─────────────────────────

async function scanLeads(): Promise<LeadItem[]> {
  const out: LeadItem[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await leadsDynamo.send(
      new ScanCommand({ TableName: LEADS_TABLE, ExclusiveStartKey: lastKey as never }),
    );
    for (const it of res.Items || []) out.push(unmarshall(it) as LeadItem);
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return out;
}

/** Marca el lead como "ya disparado" para esta regla (G3: en dos pasos porque
 *  `attributes` puede no existir). Se escribe AL FINAL (G2: las acciones
 *  bumpean updatedAt; el marcador debe quedar ≥ updatedAt para no re-armar). */
async function writeFiredMarker(leadId: string, ruleId: string): Promise<void> {
  const key = { leadId: { S: leadId } };
  await leadsDynamo
    .send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: key,
        UpdateExpression: "SET attributes = if_not_exists(attributes, :empty)",
        ExpressionAttributeValues: { ":empty": { M: {} } },
      }),
    )
    .catch(() => {});
  await leadsDynamo.send(
    new UpdateItemCommand({
      TableName: LEADS_TABLE,
      Key: key,
      UpdateExpression: "SET attributes.#k = :now",
      ExpressionAttributeNames: { "#k": `autoFired_${ruleId}` },
      ExpressionAttributeValues: { ":now": { S: new Date().toISOString() } },
    }),
  );
}

async function processTick(): Promise<{ tenants: number; fired: number; skipped: string[] }> {
  // Triggers evaluados por SCAN periódico (no por evento): inactividad + score.
  const all = (await loadAllRules()).filter(
    (r) => r.trigger.type === "lead_inactive" || r.trigger.type === "score_threshold",
  );
  const byTenant = new Map<string, Rule[]>();
  for (const r of all) {
    const list = byTenant.get(r.tenantId) || [];
    list.push(r);
    byTenant.set(r.tenantId, list);
  }

  let fired = 0;
  const skipped: string[] = [];
  for (const [tenantId, rules] of byTenant) {
    // G5: un tenant roto no mata el tick de los demás; jamás fallback al pooled.
    try {
      await setupTenant(tenantId);
    } catch (err) {
      console.warn(`tick: skip tenant ${tenantId}:`, err instanceof Error ? err.message : err);
      skipped.push(tenantId);
      continue;
    }
    let leads: LeadItem[];
    try {
      leads = await scanLeads();
    } catch (err) {
      console.warn(`tick: scan leads failed for ${tenantId}`, err);
      skipped.push(tenantId);
      continue;
    }
    const now = Date.now();
    for (const rule of rules) {
      const kind = rule.trigger.type;
      // lead_inactive
      const days = Number(rule.trigger.params?.days ?? 7);
      const stageFilter = String(rule.trigger.params?.stageId || "");
      const cutoff = now - days * 86400_000;
      // score_threshold
      const minScore = Number(rule.trigger.params?.min ?? 0);
      let firesLeft = MAX_FIRES_PER_TICK;
      for (const lead of leads) {
        if (firesLeft <= 0) break;
        const marker = lead.attributes?.[`autoFired_${rule.ruleId}`];
        if (kind === "lead_inactive") {
          const updatedAt = Date.parse(lead.updatedAt || lead.createdAt || "") || 0;
          if (updatedAt > cutoff) continue; // activo
          if (stageFilter && (lead.stageId || "") !== stageFilter) continue;
          // ¿Ya disparó para este episodio de inactividad? (marca ≥ updatedAt)
          if (marker && Date.parse(marker) >= updatedAt) continue;
        } else {
          // score_threshold: dispara UNA vez al alcanzar el umbral (marca persistente).
          if ((Number(lead.score ?? 0) || 0) < minScore) continue;
          if (marker) continue;
        }
        const ctx: Ctx = {
          tenantId,
          leadId: lead.leadId,
          phone: lead.phone,
          name: lead.name,
          stageId: lead.stageId,
          source: lead.source,
        };
        if (!matchesConditions(rule, ctx)) continue;
        fired += await executeRule(rule, kind, ctx);
        firesLeft--;
        try {
          await writeFiredMarker(lead.leadId, rule.ruleId);
        } catch (err) {
          console.warn("writeFiredMarker failed", err);
        }
      }
    }
  }
  return { tenants: byTenant.size, fired, skipped };
}

// ───────────────────────── handler ─────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  // 1. HTTP (Function URL): evento de un hook — exige el secreto interno.
  if (event?.requestContext?.http) {
    const method = event.requestContext.http.method || "POST";
    if (method === "OPTIONS") return { statusCode: 200, headers: HDRS, body: "" };
    if (method !== "POST") return bad(405, "POST only");
    const hdrs = (event.headers || {}) as Record<string, string>;
    const secret = hdrs["x-vox-internal"] || hdrs["X-Vox-Internal"] || "";
    // SEC-C4/M4: comparación constant-time del secreto interno (antes `!==`).
    if (!INTERNAL_SECRET || !safeEqual(secret, INTERNAL_SECRET)) return bad(401, "No autorizado");
    let body: { event?: AutomationEvent };
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return bad(400, "JSON inválido");
    }
    if (!body.event?.type || !body.event?.tenantId)
      return bad(400, "event.type y event.tenantId requeridos");
    try {
      const res = await processEvent(body.event);
      return ok({ ok: true, ...res });
    } catch (err) {
      console.error("processEvent failed", err);
      return bad(500, err instanceof Error ? err.message : "error");
    }
  }

  // 2. Invoke directo con {event:{...}} (testing; gateado por IAM).
  if (event?.event?.type) {
    const res = await processEvent(event.event as AutomationEvent);
    return { ok: true, ...res };
  }

  // 3. Tick de EventBridge (scheduled) o invoke pelado.
  const res = await processTick();
  console.log(
    `automation tick: tenants=${res.tenants} fired=${res.fired} skipped=${res.skipped.join(",") || "—"}`,
  );
  return { ok: true, ...res };
};
