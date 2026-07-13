import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  BatchWriteItemCommand,
  ScanCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { CustomerProfilesClient } from "@aws-sdk/client-customer-profiles";
import { randomUUID } from "node:crypto";
import {
  propagateLead,
  pushLeadToSalesforce,
  appendLeadHistory,
  stageIdToLabel,
  setActiveDynamo,
  setActiveProfiles,
  upsertLeadProgramMembership,
  bulkUpsertVoxLeads,
  isGolpe,
  summarizeGolpes,
  type LeadHistoryEvent,
  type SfPushExtra,
} from "../_shared/leadSync";
import { normalizePhone, samePhone } from "../_shared/phone";
import { setActiveTenant } from "../_shared/salesforceClient";
import { resolveTenantId } from "../_shared/cognitoAuth";
import { resolveDynamo, resolveCustomerProfiles } from "../_shared/tenantConnect";
import { fireAutomation } from "../_shared/automationHook";
import { evaluateLeadFilter, type SegmentDef } from "../_shared/leadFilter";
import { entryNodeId, type JourneyDef } from "../_shared/journeys";

// Fase 2 · F2.3 — segmentos dinámicos (predicado reutilizable por tenant).
const SEGMENTS_TABLE = process.env.SEGMENTS_TABLE || "connectview-segments";
// Fase 3 — journeys (CRUD + enrol manual folded aquí; el motor es journey-runner).
const JOURNEYS_TABLE = process.env.JOURNEYS_TABLE || "connectview-journeys";
const ENROLLMENTS_TABLE =
  process.env.JOURNEY_ENROLLMENTS_TABLE || "connectview-journey-enrollments";

/**
 * Observabilidad de un journey (Fase 3 · 3C): agrega los enrollments (PK=journeyId)
 * → embudo por nodo (cuántos leads descansan en cada paso), corte por estado, y un
 * timeline reciente. Query por journeyId (no scan).
 */
async function journeyStats(journeyId: string): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byNode: Record<string, number>;
  recent: { leadId: string; node: string; at: string; note?: string }[];
}> {
  let total = 0;
  const byStatus: Record<string, number> = {};
  const byNode: Record<string, number> = {};
  const recent: { leadId: string; node: string; at: string; note?: string }[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const r = await dynamo.send(
      new QueryCommand({
        TableName: ENROLLMENTS_TABLE,
        KeyConditionExpression: "journeyId = :j",
        ExpressionAttributeValues: { ":j": { S: journeyId } },
        ExclusiveStartKey: lastKey as never,
      }),
    );
    for (const it of r.Items || []) {
      const e = unmarshall(it) as {
        leadId?: string;
        status?: string;
        currentNodeId?: string;
        history?: { node?: string; at?: string; note?: string }[];
      };
      total++;
      const st = String(e.status || "active");
      byStatus[st] = (byStatus[st] || 0) + 1;
      const node = String(e.currentNodeId || "");
      byNode[node] = (byNode[node] || 0) + 1;
      const last = Array.isArray(e.history) ? e.history[e.history.length - 1] : undefined;
      if (last)
        recent.push({
          leadId: String(e.leadId || ""),
          node: String(last.node || node),
          at: String(last.at || ""),
          note: last.note,
        });
    }
    lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  recent.sort((a, b) => b.at.localeCompare(a.at));
  return { total, byStatus, byNode, recent: recent.slice(0, 25) };
}

async function listSegments(tenantId: string): Promise<SegmentDef[]> {
  const r = await dynamo.send(
    new QueryCommand({
      TableName: SEGMENTS_TABLE,
      KeyConditionExpression: "tenantId = :t",
      ExpressionAttributeValues: { ":t": { S: tenantId } },
    }),
  );
  return (r.Items || [])
    .map((i) => unmarshall(i) as SegmentDef)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
async function getSegment(tenantId: string, segmentId: string): Promise<SegmentDef | null> {
  const r = await dynamo.send(
    new GetItemCommand({
      TableName: SEGMENTS_TABLE,
      Key: { tenantId: { S: tenantId }, segmentId: { S: segmentId } },
    }),
  );
  return r.Item ? (unmarshall(r.Item) as SegmentDef) : null;
}

/**
 * manage-leads — the unified lead funnel / embudo (roadmap #4, Kommo-style).
 * A lead moves through the SAME taxonomy stages the wrap-up uses (#2), so the
 * board columns == the canonical tipificación. Leads are created from web
 * forms (#25), inbound, campaigns, or manually, and matched by phone.
 *
 * GET                 → list all leads
 * GET   ?phone=+51..  → lead(s) for a phone
 * POST  { leadId?, phone, name?, email?, company?, stageId?, montoEstimado?, attributes? } → upsert (dedup by phone)
 * POST  { action:"move", leadId, stageId } → move stage
 * DELETE ?leadId=ID
 */
// BYO Data Plane (#46): tenant primero (su tabla en su cuenta), fallback Vox.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
// CP legacy (Novasys) — solo para el tenant fundador; resolveCustomerProfiles
// bloquea a un tenant real sin CP (jamás escribe el perfil en Novasys).
const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 2 });
const LEGACY_PROFILES_DOMAIN = process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";
const TABLE = process.env.LEADS_TABLE || "connectview-leads";
const MEMBERSHIP = process.env.LEAD_PROGRAMS_TABLE || "connectview-lead-programs";
const HSM_SENDS_TABLE = process.env.HSM_SENDS_TABLE || "connectview-hsm-sends";
// Inbox omnicanal (Pilar 6): tabla POOLED (cuenta de la plataforma) → se accede
// con `legacyDynamo`, NUNCA con el `dynamo` tenant-scoped (las conversaciones no
// viven en el data plane del cliente). Ver propagateNameToConversations.
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || "connectview-conversations";
const CORS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
/**
 * Uniformización del nombre (fuente de verdad = el LEAD): al renombrar un lead,
 * refresca el `customerName` cacheado de las conversaciones del inbox omnicanal
 * vinculadas (por leadId, o por teléfono si aún no se vincularon), para que el
 * inbox no muestre el nombre viejo. Best-effort: si falla, NO rompe el guardado.
 * Usa `legacyDynamo` porque la tabla es pooled (cuenta de la plataforma).
 */
async function propagateNameToConversations(
  leadId: string,
  phone: string,
  name: string,
): Promise<void> {
  if (!name) return;
  const e164 = normalizePhone(phone)?.e164 || phone;
  const nowIso = new Date().toISOString();
  let ESK: Record<string, unknown> | undefined;
  try {
    do {
      const r = await legacyDynamo.send(
        new ScanCommand({
          TableName: CONVERSATIONS_TABLE,
          ExclusiveStartKey: ESK as never,
          ProjectionExpression: "conversationId, leadId, phone, customerName",
        }),
      );
      for (const it of r.Items || []) {
        const c = unmarshall(it) as {
          conversationId: string;
          leadId?: string;
          phone?: string;
          customerName?: string;
        };
        const match = c.leadId === leadId || (!!c.phone && samePhone(c.phone, e164));
        if (!match || c.customerName === name) continue;
        await legacyDynamo.send(
          new UpdateItemCommand({
            TableName: CONVERSATIONS_TABLE,
            Key: { conversationId: { S: c.conversationId } },
            UpdateExpression: "SET customerName = :n, updatedAt = :u",
            ExpressionAttributeValues: marshall(
              { ":n": name, ":u": nowIso },
              { removeUndefinedValues: true },
            ),
          }),
        );
      }
      ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ESK);
  } catch (e) {
    console.warn("propagateNameToConversations falló", (e as Error).message);
  }
}

const bad = (c: number, e: string) => ({
  statusCode: c,
  headers: CORS,
  body: JSON.stringify({ error: e }),
});

interface Lead {
  leadId: string;
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  stageId?: string;
  source?: string;
  assignedAgent?: string;
  /** Historial de contacto/tipificación (append-only). */
  history?: LeadHistoryEvent[];
  /** Id del Lead en Salesforce (para sync idempotente). */
  sfLeadId?: string;
  /** Estimated deal value (pipeline $) — powers the exec KPI. Optional. */
  montoEstimado?: number;
  attributes?: Record<string, string>;
  /** SEC-A1 — tenant dueño de la fila (para el filtro real del feed/Consumo). */
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Tras escribir un lead en el tablero, propaga el cambio a Customer Profile +
 * Salesforce (origin="vox"). Resiliente: si SF falla, el guardado del lead no
 * se ve afectado. El re-escribir el lead dentro del hub es un no-op (sig igual).
 */
async function propagateById(
  leadId: string,
  sfExtra?: SfPushExtra,
): Promise<{ sfTaskId?: string | null; sfLeadId?: string; sfAction?: string }> {
  try {
    const got = await dynamo.send(
      new GetItemCommand({ TableName: TABLE, Key: { leadId: { S: leadId } } }),
    );
    if (!got.Item) return {};
    const l = unmarshall(got.Item) as Lead & { sfLeadId?: string };
    if (!l.phone) return {};
    const res = await propagateLead(
      {
        phone: l.phone,
        name: l.name,
        email: l.email,
        company: l.company,
        stageId: l.stageId,
        sfLeadId: l.sfLeadId,
        source: l.source || "Vox Leads",
        attributes: l.attributes,
      },
      { origin: "vox", sfExtra },
    );
    // Log explícito del resultado de SF: sirve para confirmar que el Lead
    // sincroniza + que se registró la actividad (Task), y para diagnosticar
    // los leads que "no se graban" (el error de SF queda en el log de abajo).
    console.log(
      `manage-leads SF sync lead=${leadId} sfLead=${res.sf?.leadId || "—"} ` +
        `action=${res.sf?.action || "none"} task=${res.sf?.taskId || "—"}`,
    );
    return { sfTaskId: res.sf?.taskId, sfLeadId: res.sf?.leadId, sfAction: res.sf?.action };
  } catch (err) {
    console.warn("manage-leads propagate failed", err);
    return {};
  }
}

async function scanAll(): Promise<Lead[]> {
  const out: Lead[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey as never }),
    );
    for (const it of res.Items || []) out.push(unmarshall(it) as Lead);
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return out;
}

/** Borra en tandas (BatchWrite de 25) una lista de keys crudas de una tabla. */
async function batchDelete(
  client: DynamoDBClient,
  table: string,
  keys: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);
    if (!chunk.length) continue;
    await client.send(
      new BatchWriteItemCommand({
        RequestItems: { [table]: chunk.map((Key) => ({ DeleteRequest: { Key } })) },
      }),
    );
  }
}

/** "Borrar todo" para empezar desde 0: leads + membresías + conversaciones + HSM del
 *  tenant. Idempotente. NO toca Salesforce, campañas, citas ni journeys. Seguro por
 *  tenant: leads/membresías/HSM son tenant-scoped (`dynamo`); las conversaciones
 *  (tabla pooled) se borran SOLO si su leadId pertenece a ESTE tenant. */
async function resetLeads(
  tenantId: string,
): Promise<{ leads: number; memberships: number; conversations: number; hsm: number }> {
  const counts = { leads: 0, memberships: 0, conversations: 0, hsm: 0 };
  const leadIds = new Set<string>();

  // 1. Leads (tenant-scoped): recoge los leadIds (para la cascada) y borra.
  {
    const keys: Record<string, unknown>[] = [];
    let ESK: Record<string, unknown> | undefined;
    do {
      const r = await dynamo.send(
        new ScanCommand({
          TableName: TABLE,
          ProjectionExpression: "leadId",
          ExclusiveStartKey: ESK as never,
        }),
      );
      for (const it of r.Items || []) {
        const id = it.leadId?.S;
        if (id) {
          leadIds.add(id);
          keys.push({ leadId: { S: id } });
        }
      }
      ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ESK);
    await batchDelete(dynamo, TABLE, keys);
    counts.leads = keys.length;
  }

  // 2. Membresías de programa (tenant-scoped, PK=programId SK=leadId): borra todas.
  {
    const keys: Record<string, unknown>[] = [];
    let ESK: Record<string, unknown> | undefined;
    do {
      const r = await dynamo.send(
        new ScanCommand({
          TableName: MEMBERSHIP,
          ProjectionExpression: "programId, leadId",
          ExclusiveStartKey: ESK as never,
        }),
      );
      for (const it of r.Items || []) {
        if (it.programId?.S && it.leadId?.S)
          keys.push({ programId: it.programId, leadId: it.leadId });
      }
      ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ESK);
    await batchDelete(dynamo, MEMBERSHIP, keys);
    counts.memberships = keys.length;
  }

  // 3. Conversaciones (POOLED, legacyDynamo): borra SOLO las cuyo leadId ∈ este tenant.
  {
    const keys: Record<string, unknown>[] = [];
    let ESK: Record<string, unknown> | undefined;
    do {
      const r = await legacyDynamo.send(
        new ScanCommand({
          TableName: CONVERSATIONS_TABLE,
          ProjectionExpression: "conversationId, leadId",
          ExclusiveStartKey: ESK as never,
        }),
      );
      for (const it of r.Items || []) {
        const cid = it.conversationId?.S;
        const lid = it.leadId?.S;
        if (cid && lid && leadIds.has(lid)) keys.push({ conversationId: { S: cid } });
      }
      ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ESK);
    await batchDelete(legacyDynamo, CONVERSATIONS_TABLE, keys);
    counts.conversations = keys.length;
  }

  // 4. Envíos HSM (WhatsApp, PK=sendId): borra los del tenant (por tenantId si existe).
  {
    const keys: Record<string, unknown>[] = [];
    let ESK: Record<string, unknown> | undefined;
    do {
      const r = await dynamo.send(
        new ScanCommand({
          TableName: HSM_SENDS_TABLE,
          ProjectionExpression: "sendId, tenantId",
          ExclusiveStartKey: ESK as never,
        }),
      );
      for (const it of r.Items || []) {
        const sid = it.sendId?.S;
        const tid = it.tenantId?.S;
        // Con tenantId: solo las de ESTE tenant. Sin tenantId (histórico) en BYO la
        // tabla ya es del tenant → borrar.
        if (sid && (!tid || tid === tenantId)) keys.push({ sendId: { S: sid } });
      }
      ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ESK);
    await batchDelete(dynamo, HSM_SENDS_TABLE, keys);
    counts.hsm = keys.length;
  }

  return counts;
}

const byUpdatedDesc = (a: Lead, b: Lead) => (b.updatedAt || "").localeCompare(a.updatedAt || "");
function stripHistory(l: Lead): Record<string, unknown> {
  const r = { ...l } as Record<string, unknown>;
  r.golpesCount = (Array.isArray(l.history) ? l.history : []).filter(isGolpe).length; // Pilar 2
  delete r.history;
  return r;
}

/** Envíos HSM (WhatsApp out) de un teléfono → eventos de golpe, para fusionar al
 *  ledger del lead (no están en lead.history). Pilar 2. Best-effort. */
async function hsmSendsAsHistory(phone: string): Promise<LeadHistoryEvent[]> {
  const out: LeadHistoryEvent[] = [];
  try {
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await dynamo.send(
        new ScanCommand({ TableName: HSM_SENDS_TABLE, ExclusiveStartKey: lastKey as never }),
      );
      for (const it of res.Items || []) {
        const s = unmarshall(it) as {
          phone?: string;
          sentAt?: string;
          templateName?: string;
          campaignId?: string;
          status?: string;
        };
        if (s.phone && samePhone(s.phone, phone)) {
          out.push({
            ts: s.sentAt || new Date().toISOString(),
            type: "whatsapp_out",
            channel: "WhatsApp",
            direction: "out",
            templateName: s.templateName,
            programId: s.campaignId || undefined,
            outcome: s.status || "sent",
            summary: s.templateName ? `Plantilla: ${s.templateName}` : "WhatsApp enviado",
          });
        }
      }
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
  } catch {
    /* sin acceso/tabla → sin eventos HSM */
  }
  return out;
}

/** Conteo de envíos HSM (WhatsApp out) por teléfono normalizado — un solo scan
 *  para todo el board, para sumar al golpesCount. Pilar 2. */
async function hsmCountsByPhone(): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  try {
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await dynamo.send(
        new ScanCommand({
          TableName: HSM_SENDS_TABLE,
          ProjectionExpression: "phone",
          ExclusiveStartKey: lastKey as never,
        }),
      );
      for (const it of res.Items || []) {
        const p = unmarshall(it).phone;
        if (p) {
          const k = normalizePhone(String(p))?.e164 || String(p);
          m.set(k, (m.get(k) || 0) + 1);
        }
      }
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
  } catch {
    /* sin acceso/tabla → sin conteos HSM */
  }
  return m;
}

/** Envíos HSM (WhatsApp out) agrupados por teléfono normalizado → eventos de
 *  golpe. Un solo scan para el reporte de atribución. Pilar 2. */
async function hsmEventsByPhone(): Promise<Map<string, LeadHistoryEvent[]>> {
  const m = new Map<string, LeadHistoryEvent[]>();
  try {
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await dynamo.send(
        new ScanCommand({ TableName: HSM_SENDS_TABLE, ExclusiveStartKey: lastKey as never }),
      );
      for (const it of res.Items || []) {
        const s = unmarshall(it) as {
          phone?: string;
          sentAt?: string;
          templateName?: string;
          campaignId?: string;
          status?: string;
        };
        if (!s.phone) continue;
        const k = normalizePhone(s.phone)?.e164 || s.phone;
        const ev: LeadHistoryEvent = {
          ts: s.sentAt || new Date().toISOString(),
          type: "whatsapp_out",
          channel: "WhatsApp",
          direction: "out",
          templateName: s.templateName,
          programId: s.campaignId || undefined,
          outcome: s.status || "sent",
        };
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(ev);
      }
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
  } catch {
    /* sin acceso/tabla → sin eventos HSM */
  }
  return m;
}

/** Pilar 1: leadId → programIds a los que pertenece (vía GSI byLead). Para
 *  resolver la taxonomía del programa del lead al tipificarlo (refinamiento 1:1). */
async function leadPrograms(leadId: string): Promise<string[]> {
  try {
    const r = await dynamo.send(
      new QueryCommand({
        TableName: MEMBERSHIP,
        IndexName: "byLead",
        KeyConditionExpression: "leadId = :l",
        ExpressionAttributeValues: { ":l": { S: leadId } },
      }),
    );
    return (r.Items || []).map((it) => it.programId?.S).filter((x): x is string => !!x);
  } catch {
    return []; // sin GSI/tabla → sin programas (cae a la default en el front)
  }
}

/** Pilar 1: leadId → stageId-por-programa (membership de un programa). */
async function queryMembership(programId: string): Promise<Map<string, string | undefined>> {
  const m = new Map<string, string | undefined>();
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: MEMBERSHIP,
        KeyConditionExpression: "programId = :p",
        ExpressionAttributeValues: { ":p": { S: programId } },
        ProjectionExpression: "leadId, stageId",
        ExclusiveStartKey: lastKey as never,
      }),
    );
    for (const it of res.Items || []) {
      const r = unmarshall(it);
      m.set(String(r.leadId), r.stageId ? String(r.stageId) : undefined);
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return m;
}

/** Pilar 1: set de TODOS los leadId que pertenecen a algún programa (para "Sin programa"). */
async function scanAssignedLeadIds(): Promise<Set<string>> {
  const s = new Set<string>();
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new ScanCommand({
        TableName: MEMBERSHIP,
        ProjectionExpression: "leadId",
        ExclusiveStartKey: lastKey as never,
      }),
    );
    for (const it of res.Items || []) s.add(String(unmarshall(it).leadId));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return s;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  // Warmup (#perf): EventBridge pinguea {warmup:true} cada ~5min — corta el cold start.
  if (event?.warmup || event?.queryStringParameters?.warmup) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: '{"warm":true}',
    };
  }
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  // Tenant del JWT → propagateById/propagateLead pegan al SF del cliente
  // (vía salesforceClient.setActiveTenant → soql/insertSObject/updateSObject).
  // Sin tenant configurado SF → fallback JWT bearer legacy.
  const tenantId = await resolveTenantId(event?.headers);
  setActiveTenant(tenantId);
  // BYO Data Plane (#46): mismo tenant para DynamoDB local + leadSync writes.
  {
    const r = await resolveDynamo(event?.headers, legacyDynamo);
    dynamo = r.dynamo;
    setActiveDynamo(r.tenantScoped ? r.dynamo : null);
    // Customer Profiles del tenant para el upsert del Cliente 360° en
    // propagateLead. Fail-closed: tenant real sin CP → bloqueado, NUNCA Novasys.
    const cp = await resolveCustomerProfiles(
      event?.headers,
      legacyProfiles,
      LEGACY_PROFILES_DOMAIN,
    );
    setActiveProfiles(cp.client, cp.domainName);
  }
  const params = event.queryStringParameters || {};

  try {
    if (method === "GET") {
      // Fase 2 · F2.3 — listar segmentos guardados (no escanea leads).
      if (params.segments === "1") return ok({ segments: await listSegments(tenantId) });
      // Fase 3 · 3C — observabilidad de un journey (embudo por nodo + timeline).
      if (params.journeyStats) {
        return ok({ stats: await journeyStats(String(params.journeyStats)) });
      }
      // Fase 3 — listar journeys del tenant (+ conteo de inscritos por journey, 3C).
      if (params.journeys === "1") {
        const r = await dynamo.send(
          new QueryCommand({
            TableName: JOURNEYS_TABLE,
            KeyConditionExpression: "tenantId = :t",
            ExpressionAttributeValues: { ":t": { S: tenantId } },
          }),
        );
        const base = (r.Items || [])
          .map((i) => unmarshall(i) as JourneyDef)
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        const journeys = await Promise.all(
          base.map(async (j) => {
            const s = await journeyStats(j.journeyId);
            return {
              ...j,
              stats: { total: s.total, active: s.byStatus.active || 0, done: s.byStatus.done || 0 },
            };
          }),
        );
        return ok({ journeys });
      }
      const all = await scanAll();

      // Reporte de atribución "golpes→conversión" (Pilar 2). Opcionalmente
      // scopeado por programa (?programId=). Fusiona WhatsApp (HSM) por teléfono.
      if (params.report === "attribution") {
        let leads = all;
        // programId específico → la conversión usa la taxonomía de ESE programa
        // (sus etapas "cierre"); "all"/"none" → taxonomía default. Antes NO se
        // pasaba → converted/avgGolpesToClose salían con la taxonomía default
        // aunque el embudo de al lado usara la del programa (no cuadraban).
        const attrProgramId =
          params.programId && params.programId !== "all" && params.programId !== "none"
            ? String(params.programId)
            : undefined;
        if (attrProgramId) {
          const mem = await queryMembership(attrProgramId);
          leads = all.filter((l) => mem.has(l.leadId));
        }
        const waByPhone = await hsmEventsByPhone();
        const perLead = await Promise.all(
          leads.map((l) => {
            const wa = waByPhone.get(normalizePhone(l.phone)?.e164 || l.phone) || [];
            const history = [...(Array.isArray(l.history) ? l.history : []), ...wa];
            return summarizeGolpes(history, l.stageId, attrProgramId);
          }),
        );
        const totalLeads = perLead.length;
        const convertedArr = perLead.filter((g) => g.converted);
        const converted = convertedArr.length;
        const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
        const tc = convertedArr
          .map((g) => g.touchesToClose)
          .filter((n): n is number => typeof n === "number");
        const dc = convertedArr
          .map((g) => g.daysToClose)
          .filter((n): n is number => typeof n === "number");
        const BUCKETS: Array<{ label: string; min: number; max: number }> = [
          { label: "0", min: 0, max: 0 },
          { label: "1-2", min: 1, max: 2 },
          { label: "3-5", min: 3, max: 5 },
          { label: "6-10", min: 6, max: 10 },
          { label: "10+", min: 11, max: Infinity },
        ];
        const byBucket = BUCKETS.map((b) => {
          const inB = perLead.filter((g) => g.total >= b.min && g.total <= b.max);
          const conv = inB.filter((g) => g.converted).length;
          return {
            label: b.label,
            leads: inB.length,
            converted: conv,
            rate: inB.length ? conv / inB.length : 0,
          };
        });
        const byChannel: Record<string, number> = {};
        for (const g of perLead)
          for (const [ch, n] of Object.entries(g.byChannel))
            byChannel[ch] = (byChannel[ch] || 0) + n;
        // Pilar 9 — embudo por etapa (funnel) del programa: cuenta de leads por
        // stageId. El front mapea stageId→label/orden con su taxonomía.
        const byStage: Record<string, number> = {};
        for (const l of leads) {
          const s = (typeof l.stageId === "string" && l.stageId) || "(sin etapa)";
          byStage[s] = (byStage[s] || 0) + 1;
        }
        return ok({
          attribution: {
            totalLeads,
            converted,
            conversionRate: totalLeads ? converted / totalLeads : 0,
            avgGolpes: totalLeads ? sum(perLead.map((g) => g.total)) / totalLeads : 0,
            avgGolpesToClose: tc.length ? sum(tc) / tc.length : 0,
            avgDaysToClose: dc.length ? sum(dc) / dc.length : 0,
            totalGolpes: sum(perLead.map((g) => g.total)),
            byBucket,
            byChannel,
            byStage,
          },
        });
      }

      // Contacto reciente: leads ordenados por última actividad, con resumen del último evento.
      if (params.recent) {
        const n = Math.min(50, Math.max(1, Number(params.recent) || 15));
        const recent = all
          .slice()
          .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
          .slice(0, n)
          .map((l) => {
            const h = Array.isArray(l.history) ? l.history : [];
            const last = h.length ? h[h.length - 1] : undefined;
            return {
              leadId: l.leadId,
              name: l.name,
              phone: l.phone,
              email: l.email,
              company: l.company,
              stageId: l.stageId,
              source: l.source,
              sfLeadId: l.sfLeadId,
              updatedAt: l.updatedAt,
              lastActivity: last
                ? {
                    type: last.type,
                    channel: last.channel,
                    untyped: last.untyped,
                    stageLabel: last.stageLabel,
                    subStageLabel: last.subStageLabel,
                    ts: last.ts,
                  }
                : null,
            };
          });
        return ok({ recent });
      }

      // Un lead por teléfono → CON su historial completo + golpes (Pilar 2). Se
      // fusionan los envíos WhatsApp (HSM) que no viven en lead.history → el
      // timeline y el conteo de golpes incluyen los WhatsApp salientes.
      if (params.phone) {
        const matches = all.filter((l) => samePhone(l.phone, params.phone));
        const waEvents = await hsmSendsAsHistory(params.phone);
        const out = await Promise.all(
          matches.map(async (l) => {
            const history = [...(Array.isArray(l.history) ? l.history : []), ...waEvents].sort(
              (a, b) => (a.ts || "").localeCompare(b.ts || ""),
            );
            const golpes = await summarizeGolpes(history, l.stageId);
            return { ...l, history, golpes, programIds: await leadPrograms(l.leadId) };
          }),
        );
        return ok({ leads: out });
      }

      // Scoping por programa (Pilar 1): leads del programa activo, con su etapa
      // POR PROGRAMA (membership.stageId gana sobre lead.stageId). "none" = leads
      // sin ningún programa.
      if (params.programId && params.programId !== "all") {
        if (params.programId === "none") {
          const assigned = await scanAssignedLeadIds();
          return ok({
            leads: all
              .filter((l) => !assigned.has(l.leadId))
              .sort(byUpdatedDesc)
              .map(stripHistory),
          });
        }
        const mem = await queryMembership(String(params.programId));
        const scoped = all
          .filter((l) => mem.has(l.leadId))
          .map((l) => ({ ...l, stageId: mem.get(l.leadId) || l.stageId }))
          .sort(byUpdatedDesc)
          .map(stripHistory);
        return ok({ leads: scoped });
      }

      // Board: golpesCount = toques en history + envíos WhatsApp (HSM) por teléfono (Pilar 2).
      const hsmByPhone = await hsmCountsByPhone();
      const lean = all.sort(byUpdatedDesc).map((l) => {
        const r = stripHistory(l);
        const k = normalizePhone(l.phone)?.e164 || l.phone;
        r.golpesCount = (r.golpesCount as number) + (hsmByPhone.get(k) || 0);
        return r;
      });
      // Fase 2 · F2.3 — filtrar por un segmento guardado (audiencia reutilizable:
      // campaña/journey/export/vista). Evalúa el predicado sobre los leans (traen
      // score/grade/golpesCount).
      if (params.segment) {
        const seg = await getSegment(tenantId, String(params.segment));
        if (!seg) return bad(404, "segmento no encontrado");
        const matched = lean.filter((l) => evaluateLeadFilter(l, seg.rules, seg.match));
        return ok({
          leads: matched,
          segment: { segmentId: seg.segmentId, name: seg.name, total: matched.length },
        });
      }
      return ok({ leads: lean });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");

      // Reset "borrar todo" (empezar desde 0): leads + membresías + conversaciones +
      // HSM del tenant. Doble gate: admin autenticado + escribir la frase exacta.
      // NO toca Salesforce/campañas/citas/journeys.
      if (body.action === "resetLeads") {
        if (
          String(body.confirm || "")
            .trim()
            .toUpperCase() !== "BORRAR TODO"
        )
          return bad(400, 'Confirmación inválida: escribe exactamente "BORRAR TODO".');
        const counts = await resetLeads(tenantId);
        return ok({ reset: true, ...counts });
      }

      // Import puro de leads (CSV histórico → programa): crea/mergea leads en lote y
      // los mete al board del programa en la etapa inicial elegida, SIN lanzar
      // campaña ni dialing y SIN empujar a Salesforce (eso queda como paso aparte).
      // Reutiliza el motor idempotente de campañas (dedup por teléfono normalizado).
      if (body.action === "importLeads") {
        const programId = String(body.programId || "").trim();
        const stageId = body.stageId ? String(body.stageId) : undefined;
        const raw: unknown = body.contacts;
        if (!Array.isArray(raw) || raw.length === 0)
          return bad(400, "contacts requeridos (array no vacío)");
        if (raw.length > 5000) return bad(400, "Máximo 5000 contactos por lote");
        const contacts = (raw as Array<Record<string, unknown>>)
          .map((c) => ({
            phone: String(c.phone ?? "").trim(),
            customerName:
              c.name || c.customerName
                ? String(c.name ?? c.customerName).trim() || undefined
                : undefined,
            attributes:
              c.attributes && typeof c.attributes === "object"
                ? (c.attributes as Record<string, string>)
                : undefined,
          }))
          .filter((c) => c.phone);
        if (contacts.length === 0) return bad(400, "Ningún contacto con teléfono válido");
        const summary = await bulkUpsertVoxLeads(contacts, {
          source: "import-csv",
          programId: programId || undefined,
          stageId,
          tenantId,
          deadlineMs: 25_000,
        });
        return ok({ imported: true, programId: programId || null, ...summary });
      }

      // Move-stage action.
      if (body.action === "move") {
        if (!body.leadId || !body.stageId) return bad(400, "leadId and stageId required");
        await dynamo.send(
          new UpdateItemCommand({
            TableName: TABLE,
            Key: { leadId: { S: body.leadId } },
            UpdateExpression: "SET stageId = :s, updatedAt = :u",
            ExpressionAttributeValues: {
              ":s": { S: String(body.stageId) },
              ":u": { S: new Date().toISOString() },
            },
          }),
        );
        // Pilar 1: si el move ocurre dentro de un programa activo, actualizar
        // también la etapa POR PROGRAMA (membership) — no afecta otros programas.
        if (body.programId) {
          await upsertLeadProgramMembership(
            String(body.leadId),
            String(body.programId),
            String(body.stageId),
          );
        }
        const stageLabel = await stageIdToLabel(
          String(body.stageId),
          body.programId ? String(body.programId) : undefined,
        );
        const prop = await propagateById(String(body.leadId), {
          taskSubject: `ARIA · Etapa: ${stageLabel || String(body.stageId)}`.slice(0, 255),
          taskDescription: `El lead pasó a la etapa "${stageLabel || String(body.stageId)}" desde ARIA.`,
          taskSubtype: "Task",
        });
        await appendLeadHistory(String(body.leadId), {
          ts: new Date().toISOString(),
          type: "stage_change",
          stageId: String(body.stageId),
          stageLabel,
          sfTaskId: prop.sfTaskId || undefined,
        });
        // Automatizaciones (#15): el cambio de etapa es un trigger.
        await fireAutomation({
          type: "lead_stage_changed",
          tenantId,
          lead: { leadId: String(body.leadId), stageId: String(body.stageId) },
        });
        return ok({ moved: true, leadId: body.leadId, stageId: body.stageId });
      }

      // Aplicar una etiqueta a un lead (acción manual del usuario). Guarda el tag
      // en `attributes.tags` (CSV, dedup case-insensitive) y dispara el trigger
      // `tag_applied` (#15). El motor (actApplyTag) escribe directo a DDB y NO
      // re-dispara → solo esta ruta manual dispara el trigger (anti-loop).
      if (body.action === "applyTag") {
        if (!body.leadId || !body.tag) return bad(400, "leadId and tag required");
        const tag = String(body.tag).trim();
        if (!tag) return bad(400, "tag vacío");
        const got = await dynamo.send(
          new GetItemCommand({ TableName: TABLE, Key: { leadId: { S: String(body.leadId) } } }),
        );
        if (!got.Item) return bad(404, "lead no encontrado");
        const l = unmarshall(got.Item) as Lead;
        const current = String(l.attributes?.tags || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        const already = current.some((t) => t.toLowerCase() === tag.toLowerCase());
        if (!already) {
          const next = [...current, tag].join(", ").slice(0, 1024);
          const now = new Date().toISOString();
          await dynamo
            .send(
              new UpdateItemCommand({
                TableName: TABLE,
                Key: { leadId: { S: String(body.leadId) } },
                UpdateExpression: "SET attributes = if_not_exists(attributes, :empty)",
                ExpressionAttributeValues: { ":empty": { M: {} } },
              }),
            )
            .catch(() => {});
          await dynamo.send(
            new UpdateItemCommand({
              TableName: TABLE,
              Key: { leadId: { S: String(body.leadId) } },
              UpdateExpression: "SET attributes.#k = :v, updatedAt = :u",
              ExpressionAttributeNames: { "#k": "tags" },
              ExpressionAttributeValues: { ":v": { S: next }, ":u": { S: now } },
            }),
          );
        }
        // Disparar el trigger aun si el tag ya existía es inofensivo, pero solo
        // tiene sentido cuando de verdad se aplicó → disparamos siempre (el
        // usuario ejecutó la acción "aplicar etiqueta"). Fire-and-forget.
        await fireAutomation({
          type: "tag_applied",
          tenantId,
          lead: { leadId: String(body.leadId), phone: l.phone, name: l.name, stageId: l.stageId },
          tag,
        });
        return ok({ tagged: true, leadId: body.leadId, tag, already });
      }

      // Pilar 1: asignar/quitar leads a un programa (membership N:N). El stageId
      // de la membership = la etapa actual del lead.
      if (body.action === "assignProgram" || body.action === "unassignProgram") {
        const programId = String(body.programId || "");
        const leadIds: string[] = Array.isArray(body.leadIds)
          ? body.leadIds.map(String)
          : body.leadId
            ? [String(body.leadId)]
            : [];
        if (!programId || leadIds.length === 0) return bad(400, "programId y leadId(s) requeridos");
        if (body.action === "assignProgram") {
          const byId = new Map((await scanAll()).map((l) => [l.leadId, l] as const));
          for (const id of leadIds) {
            const l = byId.get(id);
            await upsertLeadProgramMembership(id, programId, l?.stageId, l?.source || "manual");
          }
          return ok({ assigned: leadIds.length, programId });
        }
        for (const id of leadIds) {
          await dynamo.send(
            new DeleteItemCommand({
              TableName: MEMBERSHIP,
              Key: { programId: { S: programId }, leadId: { S: id } },
            }),
          );
        }
        return ok({ unassigned: leadIds.length, programId });
      }

      // Fase 2 · F2.3 — guardar / borrar un segmento (predicado reutilizable).
      if (body.action === "saveSegment") {
        const seg = (body.segment || {}) as Partial<SegmentDef>;
        const item: SegmentDef = {
          tenantId,
          segmentId: seg.segmentId || randomUUID(),
          name: (seg.name || "Segmento").slice(0, 120),
          description: seg.description ? String(seg.description).slice(0, 300) : undefined,
          match: seg.match === "any" ? "any" : "all",
          rules: Array.isArray(seg.rules) ? seg.rules.slice(0, 30) : [],
          updatedAt: new Date().toISOString(),
          updatedBy: body.actor ? String(body.actor) : undefined,
        };
        await dynamo.send(
          new PutItemCommand({
            TableName: SEGMENTS_TABLE,
            Item: marshall(item, { removeUndefinedValues: true }),
          }),
        );
        return ok({ segment: item, saved: true });
      }
      if (body.action === "deleteSegment") {
        if (!body.segmentId) return bad(400, "segmentId requerido");
        await dynamo.send(
          new DeleteItemCommand({
            TableName: SEGMENTS_TABLE,
            Key: { tenantId: { S: tenantId }, segmentId: { S: String(body.segmentId) } },
          }),
        );
        return ok({ deleted: true, segmentId: body.segmentId });
      }

      // Fase 3 — journeys: CRUD + enrol manual (el motor de avance es journey-runner).
      if (body.action === "saveJourney") {
        const j = (body.journey || {}) as Partial<JourneyDef>;
        const item: JourneyDef = {
          tenantId,
          journeyId: j.journeyId || randomUUID(),
          name: (j.name || "Journey").slice(0, 120),
          status: j.status === "active" || j.status === "paused" ? j.status : "draft",
          entry: j.entry || { manual: true },
          reenroll: !!j.reenroll,
          nodes: Array.isArray(j.nodes) ? j.nodes.slice(0, 100) : [],
          edges: Array.isArray(j.edges) ? j.edges.slice(0, 200) : [],
          goal: j.goal,
          updatedAt: new Date().toISOString(),
          updatedBy: body.actor ? String(body.actor) : undefined,
        };
        await dynamo.send(
          new PutItemCommand({
            TableName: JOURNEYS_TABLE,
            Item: marshall(item, { removeUndefinedValues: true }),
          }),
        );
        return ok({ journey: item, saved: true });
      }
      if (body.action === "deleteJourney") {
        if (!body.journeyId) return bad(400, "journeyId requerido");
        await dynamo.send(
          new DeleteItemCommand({
            TableName: JOURNEYS_TABLE,
            Key: { tenantId: { S: tenantId }, journeyId: { S: String(body.journeyId) } },
          }),
        );
        return ok({ deleted: true, journeyId: body.journeyId });
      }
      if (body.action === "enrollJourney") {
        if (!body.journeyId || !body.leadId) return bad(400, "journeyId y leadId requeridos");
        const jr = await dynamo.send(
          new GetItemCommand({
            TableName: JOURNEYS_TABLE,
            Key: { tenantId: { S: tenantId }, journeyId: { S: String(body.journeyId) } },
          }),
        );
        if (!jr.Item) return bad(404, "journey no encontrado");
        const journey = unmarshall(jr.Item) as JourneyDef;
        const entry = entryNodeId(journey);
        if (!entry) return bad(400, "el journey no tiene nodo de entrada");
        // reenroll off: no re-inscribir si ya existe un enrollment.
        const existing = await dynamo.send(
          new GetItemCommand({
            TableName: ENROLLMENTS_TABLE,
            Key: { journeyId: { S: String(body.journeyId) }, leadId: { S: String(body.leadId) } },
          }),
        );
        if (existing.Item && !journey.reenroll) {
          return ok({ enrolled: false, reason: "ya inscrito (reenroll off)" });
        }
        const now = new Date().toISOString();
        await dynamo.send(
          new PutItemCommand({
            TableName: ENROLLMENTS_TABLE,
            Item: marshall(
              {
                journeyId: String(body.journeyId),
                leadId: String(body.leadId),
                tenantId, // el runner lo usa para resolver el journey
                currentNodeId: entry,
                status: "active",
                enteredAt: now,
                nextRunAt: now, // listo para el próximo tick
                history: [{ node: entry, at: now, note: "enrolado" }],
              },
              { removeUndefinedValues: true },
            ),
          }),
        );
        return ok({ enrolled: true, journeyId: body.journeyId, leadId: body.leadId, at: entry });
      }

      // Forzar el envío de UN lead a Salesforce (botón "Enviar a Salesforce"
      // del detalle) — red de seguridad por si el sync automático no ocurrió
      // (ej. leads de campaña que aún no se contactaron). Devuelve el resultado
      // REAL (éxito con ids, o el error de SF) para el toast del front.
      if (body.action === "pushSf") {
        if (!body.leadId) return bad(400, "leadId required");
        const got = await dynamo.send(
          new GetItemCommand({ TableName: TABLE, Key: { leadId: { S: String(body.leadId) } } }),
        );
        if (!got.Item) return bad(404, "lead no encontrado");
        const l = unmarshall(got.Item) as Lead & { sfLeadId?: string };
        if (!l.phone && !l.email) {
          return bad(400, "El lead necesita teléfono o email para enviarse a Salesforce.");
        }
        try {
          const sf = await pushLeadToSalesforce(
            {
              phone: l.phone,
              name: l.name,
              email: l.email,
              company: l.company,
              stageId: l.stageId,
              sfLeadId: l.sfLeadId,
              source: l.source || "Vox Leads",
              attributes: l.attributes,
              history: l.history, // F5.1 — rollup R4 de golpes a Vox*__c
            },
            {
              taskSubject: "ARIA · Enviado a Salesforce",
              taskDescription: `Lead enviado manualmente a Salesforce desde ARIA${l.name ? ` · ${l.name}` : ""}.`,
              taskSubtype: "Task",
            },
            l.leadId, // External Id (VoxLeadId__c) → dedup determinístico en SF
          );
          if (!sf) return ok({ pushed: false, error: "El lead necesita teléfono o email." });
          // Persistir el sfLeadId nuevo → próximos sync idempotentes. SOLO si es un
          // Lead (kind "lead"): un Contact id guardado como sfLeadId rompería el
          // próximo update (updateSObject("Lead", contactId) → 404).
          if (sf.leadId && sf.kind === "lead" && !l.sfLeadId) {
            await dynamo
              .send(
                new UpdateItemCommand({
                  TableName: TABLE,
                  Key: { leadId: { S: l.leadId } },
                  UpdateExpression: "SET sfLeadId = :s",
                  ExpressionAttributeValues: { ":s": { S: sf.leadId } },
                }),
              )
              .catch(() => {});
          }
          console.log(
            `manage-leads pushSf lead=${l.leadId} sfLead=${sf.leadId} action=${sf.action} task=${sf.taskId || "—"}`,
          );
          return ok({
            pushed: true,
            sfLeadId: sf.leadId,
            action: sf.action,
            taskId: sf.taskId || null,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "error";
          console.warn("manage-leads pushSf failed:", msg);
          return ok({ pushed: false, error: msg.slice(0, 220) });
        }
      }

      // unlinkSf — rompe el vínculo con Salesforce quitando el sfLeadId guardado.
      // Se usa cuando ese ID apunta a un registro que YA NO existe en la org
      // conectada (borrado, otra org, o dato de prueba): deja de mostrar el falso
      // "está en Salesforce" en la tarjeta y el detalle. Idempotente.
      if (body.action === "unlinkSf") {
        if (!body.leadId) return bad(400, "leadId required");
        await dynamo.send(
          new UpdateItemCommand({
            TableName: TABLE,
            Key: { leadId: { S: String(body.leadId) } },
            UpdateExpression: "SET updatedAt = :u REMOVE sfLeadId",
            ExpressionAttributeValues: { ":u": { S: new Date().toISOString() } },
          }),
        );
        console.log(`manage-leads unlinkSf lead=${body.leadId}`);
        return ok({ unlinked: true });
      }

      // Upsert. Dedup by phone (tolerante a formato) — si ya existe un lead con
      // ese teléfono escrito distinto, lo actualiza en vez de duplicarlo.
      const phone = (body.phone || "").trim();
      if (!phone) return bad(400, "phone is required");

      let leadId: string | undefined = body.leadId;
      if (!leadId) {
        const existing = (await scanAll()).find((l) => samePhone(l.phone, phone));
        if (existing) leadId = existing.leadId;
      }
      const now = new Date().toISOString();
      const isNew = !leadId;
      leadId = leadId || randomUUID();

      const item: Lead = {
        leadId,
        // Normalizado (E.164) → la tabla converge a un formato único.
        phone: normalizePhone(phone)?.e164 || phone,
        name: body.name,
        email: body.email,
        company: body.company,
        stageId: body.stageId,
        source: body.source,
        assignedAgent: body.assignedAgent,
        montoEstimado: typeof body.montoEstimado === "number" ? body.montoEstimado : undefined,
        attributes:
          body.attributes && typeof body.attributes === "object" ? body.attributes : undefined,
        // SEC-A1: dueño de la fila (del JWT). Vacío = legacy/anónimo → sin campo
        // (marshall lo omite por removeUndefinedValues), fila pooled Novasys.
        tenantId: tenantId || undefined,
        updatedAt: now,
      };
      if (isNew) item.createdAt = now;

      if (isNew) {
        await dynamo.send(
          new PutItemCommand({
            TableName: TABLE,
            Item: marshall(item, { removeUndefinedValues: true }),
          }),
        );
      } else {
        // Build a partial update so we don't wipe fields not provided.
        const sets: string[] = ["updatedAt = :u"];
        const vals: Record<string, unknown> = { ":u": now };
        const names: Record<string, string> = {};
        // SEC-A1: estampar el dueño en filas legacy sin tenantId (backfill), sin
        // pisar uno ya presente (if_not_exists). Solo si hay tenant real (no vacío).
        if (tenantId) {
          sets.push("#tenantId = if_not_exists(#tenantId, :tenantId)");
          names["#tenantId"] = "tenantId";
          vals[":tenantId"] = tenantId;
        }
        for (const k of [
          "name",
          "email",
          "company",
          "stageId",
          "source",
          "assignedAgent",
          "montoEstimado",
          "attributes",
        ] as const) {
          if (body[k] !== undefined) {
            sets.push(`#${k} = :${k}`);
            names[`#${k}`] = k;
            vals[`:${k}`] = body[k];
          }
        }
        await dynamo.send(
          new UpdateItemCommand({
            TableName: TABLE,
            Key: { leadId: { S: leadId } },
            UpdateExpression: "SET " + sets.join(", "),
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: marshall(vals, { removeUndefinedValues: true }),
          }),
        );
      }
      const prop = await propagateById(leadId, {
        taskSubject: isNew ? "ARIA · Lead creado" : "ARIA · Lead actualizado",
        taskDescription: isNew
          ? `Lead creado en ARIA${item.name ? ` · ${item.name}` : ""}${item.phone ? ` · ${item.phone}` : ""}.`
          : "Datos del lead actualizados desde ARIA.",
        taskSubtype: "Task",
      });
      // Uniformización del nombre: el lead es la fuente de verdad → refrescar el
      // `customerName` cacheado en las conversaciones del inbox vinculadas, para
      // que no muestren el nombre viejo. Best-effort (no rompe el guardado).
      if (body.name) {
        await propagateNameToConversations(leadId, item.phone, String(body.name));
      }
      // Pilar 1: si la UI mandó el programa activo, escribir la membership.
      if (body.programId) {
        await upsertLeadProgramMembership(
          leadId,
          String(body.programId),
          item.stageId,
          item.source,
        );
      }
      if (!isNew) {
        await appendLeadHistory(leadId, {
          ts: new Date().toISOString(),
          type: "update",
          sfTaskId: prop.sfTaskId || undefined,
        });
      }
      // Automatizaciones (#15): lead nuevo en el embudo es un trigger.
      if (isNew) {
        await fireAutomation({
          type: "lead_created",
          tenantId,
          lead: { leadId, phone, name: item.name, stageId: item.stageId, source: item.source },
        });
      }
      // Devolvemos el resultado del push a Salesforce para que el frontend pueda
      // mostrar un toast con un botón "Ver en Salesforce" hacia ese Lead exacto.
      return ok({
        lead: item,
        saved: true,
        isNew,
        salesforce: prop.sfLeadId
          ? { leadId: prop.sfLeadId, action: prop.sfAction || "updated" }
          : null,
      });
    }

    if (method === "DELETE") {
      if (!params.leadId) return bad(400, "leadId required");
      await dynamo.send(
        new DeleteItemCommand({ TableName: TABLE, Key: { leadId: { S: params.leadId } } }),
      );
      return ok({ deleted: true, leadId: params.leadId });
    }

    return bad(405, `Method not allowed: ${method}`);
  } catch (err) {
    console.error("manage-leads error", err);
    return bad(500, err instanceof Error ? err.message : "internal error");
  }
};
