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
import { randomUUID } from "node:crypto";
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

/**
 * automation-engine — el motor de reglas (#15, "Digital Pipeline" de AIRA):
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
const SEND_WA_URL = process.env.SEND_WHATSAPP_TEMPLATE_URL || "";
const INTERNAL_SECRET = process.env.VOX_INTERNAL_SECRET || "";
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
const bad = (c: number, e: string) => ({ statusCode: c, headers: HDRS, body: JSON.stringify({ error: e }) });

// ───────────────────────── tipos ─────────────────────────
type TriggerType =
  | "lead_created"
  | "lead_stage_changed"
  | "lead_inactive"
  | "wrapup_saved"
  | "whatsapp_flow_completed";
type ActionType = "send_whatsapp_template" | "move_stage" | "schedule_callback" | "webhook";

interface Rule {
  tenantId: string;
  sk: string;
  ruleId: string;
  name: string;
  enabled: boolean;
  trigger: { type: TriggerType; params?: Record<string, unknown> };
  conditions?: Array<{ field: string; op: "eq" | "neq"; value: string }>;
  actions: Array<{ type: ActionType; params?: Record<string, unknown> }>;
}

export interface AutomationEvent {
  type: Exclude<TriggerType, "lead_inactive">;
  tenantId: string;
  lead?: {
    leadId?: string;
    phone?: string;
    name?: string;
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
}

/** Contexto normalizado sobre el que corren condiciones y acciones. */
interface Ctx {
  tenantId: string;
  leadId?: string;
  contactId?: string;
  phone?: string;
  name?: string;
  stageId?: string;
  source?: string;
  valoracion?: string;
  channel?: string;
  flowName?: string;
}

interface LeadItem {
  leadId: string;
  phone?: string;
  name?: string;
  stageId?: string;
  source?: string;
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
      })
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
      })
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
  console.warn(`automation: tenant ${tenantId} sin Data Plane — evento procesado contra pooled (CP off)`);
  leadsDynamo = legacyDynamo;
  setActiveDynamo(null);
  setActiveProfiles(cpFailClosed, "");
}

function matchesConditions(rule: Rule, ctx: Ctx): boolean {
  for (const c of rule.conditions || []) {
    const actual = String(
      (ctx as unknown as Record<string, unknown>)[c.field] ?? ""
    ).toLowerCase();
    const expected = String(c.value ?? "").toLowerCase();
    if (c.op === "eq" && actual !== expected) return false;
    if (c.op === "neq" && actual === expected) return false;
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
    stageId: ev.lead?.stageId,
    source: ev.lead?.source,
    flowName: ev.flow?.name,
  };
}

/** Tokens {{name}}/{{phone}}/{{stage}} en variables de plantilla y notas. */
function fillTokens(s: string, ctx: Ctx): string {
  return s
    .replace(/\{\{\s*name\s*\}\}/gi, ctx.name || "")
    .replace(/\{\{\s*phone\s*\}\}/gi, ctx.phone || "")
    .replace(/\{\{\s*stage\s*\}\}/gi, ctx.stageId || "");
}

async function findLeadByPhone(phone: string): Promise<LeadItem | null> {
  if (!phone) return null;
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await leadsDynamo.send(
      new ScanCommand({ TableName: LEADS_TABLE, ExclusiveStartKey: lastKey as never })
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
    new GetItemCommand({ TableName: LEADS_TABLE, Key: { leadId: { S: leadId } } })
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
    fillTokens(String(v), ctx)
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
  const body = (await r.json().catch(() => ({}))) as { sent?: boolean; error?: string };
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
    })
  );
  const stageLabel = await stageIdToLabel(stageId);
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
          stageId: l.stageId,
          source: l.source || "Vox Leads",
          attributes: l.attributes,
        },
        { origin: "vox" }
      );
    }
  } catch (err) {
    console.warn("automation move_stage propagate failed", err);
  }
  return null;
}

async function actScheduleCallback(ctx: Ctx, params: Record<string, unknown>): Promise<string | null> {
  // G6: el callback-dispatcher es pooled/legacy hoy → solo tenant fundador.
  if (!isLegacyTenant(ctx.tenantId))
    return "schedule_callback aún no soportado para tenants BYO";
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

async function actWebhook(ctx: Ctx, params: Record<string, unknown>, ruleName: string): Promise<string | null> {
  const url = String(params.url || "");
  if (!/^https?:\/\//.test(url)) return "url inválida";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "aira-automation",
        rule: ruleName,
        tenantId: ctx.tenantId,
        leadId: ctx.leadId,
        contactId: ctx.contactId,
        phone: ctx.phone,
        name: ctx.name,
        stageId: ctx.stageId,
        at: new Date().toISOString(),
      }),
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

// ───────────────────────── ejecución + log ─────────────────────────

async function logRun(
  tenantId: string,
  rule: Rule,
  triggerType: string,
  action: string,
  ctx: Ctx,
  error: string | null
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
    error: error || undefined,
    at,
    expireAt: Math.floor(Date.now() / 1000) + RUN_TTL_DAYS * 86400,
  };
  await rulesDynamo
    .send(
      new PutItemCommand({
        TableName: RULES_TABLE,
        Item: marshall(run, { removeUndefinedValues: true }),
      })
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
      })
    )
    .catch((e) => console.warn("bumpRule failed", e));
}

/** Ejecuta las acciones de una regla sobre un contexto; devuelve cuántas OK. */
async function executeRule(rule: Rule, triggerType: string, ctx: Ctx): Promise<number> {
  let okCount = 0;
  for (const action of rule.actions || []) {
    let error: string | null = null;
    try {
      if (action.type === "send_whatsapp_template")
        error = await actSendTemplate(ctx, action.params || {});
      else if (action.type === "move_stage") error = await actMoveStage(ctx, action.params || {});
      else if (action.type === "schedule_callback")
        error = await actScheduleCallback(ctx, action.params || {});
      else if (action.type === "webhook")
        error = await actWebhook(ctx, action.params || {}, rule.name);
      else error = `acción desconocida: ${action.type}`;
    } catch (err) {
      error = err instanceof Error ? err.message : "error";
    }
    await logRun(ctx.tenantId, rule, triggerType, action.type, ctx, error);
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
    (r) => r.trigger.type !== "lead_inactive" && matchesTrigger(r, ev)
  );
  const ctx = ctxFromEvent(ev);
  const matched = rules.filter((r) => matchesConditions(r, ctx));
  if (matched.length === 0) return { matched: 0, fired: 0 };

  await setupTenant(ev.tenantId, false); // eventos: fallback pooled (no estricto)
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
      new ScanCommand({ TableName: LEADS_TABLE, ExclusiveStartKey: lastKey as never })
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
      })
    )
    .catch(() => {});
  await leadsDynamo.send(
    new UpdateItemCommand({
      TableName: LEADS_TABLE,
      Key: key,
      UpdateExpression: "SET attributes.#k = :now",
      ExpressionAttributeNames: { "#k": `autoFired_${ruleId}` },
      ExpressionAttributeValues: { ":now": { S: new Date().toISOString() } },
    })
  );
}

async function processTick(): Promise<{ tenants: number; fired: number; skipped: string[] }> {
  const all = (await loadAllRules()).filter((r) => r.trigger.type === "lead_inactive");
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
      const days = Number(rule.trigger.params?.days ?? 7);
      const stageFilter = String(rule.trigger.params?.stageId || "");
      const cutoff = now - days * 86400_000;
      let firesLeft = MAX_FIRES_PER_TICK;
      for (const lead of leads) {
        if (firesLeft <= 0) break;
        const updatedAt = Date.parse(lead.updatedAt || lead.createdAt || "") || 0;
        if (updatedAt > cutoff) continue; // activo
        if (stageFilter && (lead.stageId || "") !== stageFilter) continue;
        // ¿Ya disparó para este episodio de inactividad?
        const marker = lead.attributes?.[`autoFired_${rule.ruleId}`];
        if (marker && Date.parse(marker) >= updatedAt) continue;
        const ctx: Ctx = {
          tenantId,
          leadId: lead.leadId,
          phone: lead.phone,
          name: lead.name,
          stageId: lead.stageId,
          source: lead.source,
        };
        if (!matchesConditions(rule, ctx)) continue;
        fired += await executeRule(rule, "lead_inactive", ctx);
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
    if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) return bad(401, "No autorizado");
    let body: { event?: AutomationEvent };
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return bad(400, "JSON inválido");
    }
    if (!body.event?.type || !body.event?.tenantId) return bad(400, "event.type y event.tenantId requeridos");
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
  console.log(`automation tick: tenants=${res.tenants} fired=${res.fired} skipped=${res.skipped.join(",") || "—"}`);
  return { ok: true, ...res };
};
