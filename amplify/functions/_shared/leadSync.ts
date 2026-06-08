/**
 * leadSync — el "hub" de Leads. Cualquier lead (venga de Salesforce, del
 * tablero de Vox, de una campaña o de un wrap-up) pasa por propagateLead(),
 * que lo abanica a las tres superficies:
 *   1. tabla `connectview-leads`  (el embudo / Kanban)
 *   2. Customer Profile           (Cliente 360°)
 *   3. Salesforce                 (Lead + Status)
 *
 * Anti-loop: los leads que ORIGINAN en Salesforce (origin="salesforce") NO se
 * vuelven a empujar a SF. Los que se crean en Vox se mandan a SF con
 * LeadSource="Vox" (el trigger LeadVoxSync de SF ignora esos, evitando el eco).
 * `sfLeadId` se guarda en el lead de Vox para que los updates sean idempotentes.
 */
import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { CustomerProfilesClient } from "@aws-sdk/client-customer-profiles";
import { randomUUID } from "node:crypto";
import { soql, soqlEscape, insertSObject, updateSObject } from "./salesforceClient";
import { upsertProfileFromCsvContact } from "./upsertCustomerProfileFromCsv";

// BYO Data Plane (#46): por defecto usamos un client con creds de Vox (escribe
// en las tablas pooled). Cuando un Lambda llama `setActiveDynamo(tenantClient)`
// antes de invocar propagateLead/upsertVoxLead/etc., todas las escrituras van
// a la cuenta del cliente. Seguro porque Lambda procesa un evento a la vez.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
/** Set tenant-scoped DynamoDB para que TODAS las escrituras de leadSync
 *  (propagateLead, appendLeadHistory, upsertVoxLead, …) caigan en la tabla
 *  del cliente. Pasar `null`/no llamar = legacy Vox. */
export function setActiveDynamo(client: DynamoDBClient | null): void {
  dynamo = client || legacyDynamo;
}

// Customer Profiles activo — análogo a setActiveDynamo, para el upsert del
// Cliente 360° dentro de propagateLead. Por defecto el CP legacy de Vox
// (Novasys). Cada Lambda que invoca propagateLead resuelve el CP del tenant
// (resolveCustomerProfiles / getTenantConnect) y llama setActiveProfiles ANTES
// de propagar → el perfil del lead cae en el dominio del CLIENTE, o se saltea
// (domainName "") si el tenant real no tiene CP. NUNCA Novasys para un tenant real.
const LEGACY_PROFILES_DOMAIN =
  process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";
const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 2 });
let activeProfiles: CustomerProfilesClient = legacyProfiles;
let activeProfilesDomain: string = LEGACY_PROFILES_DOMAIN;
/** Set tenant-scoped Customer Profiles (cliente + dominio). Pasar `client=null`
 *  = legacy Vox/Novasys. Un `domain` "" (con client no-null = tenant real sin
 *  CP) = fail-closed: el upsert del Cliente 360° se saltea. */
export function setActiveProfiles(
  client: CustomerProfilesClient | null,
  domain: string | null
): void {
  if (client) {
    activeProfiles = client;
    activeProfilesDomain = domain ?? "";
  } else {
    activeProfiles = legacyProfiles;
    activeProfilesDomain = LEGACY_PROFILES_DOMAIN;
  }
}
const LEADS_TABLE = process.env.LEADS_TABLE || "connectview-leads";
const TAXONOMIES_TABLE = process.env.TAXONOMIES_TABLE || "connectview-taxonomies";

/** Forma canónica de un lead, agnóstica del origen. */
export interface LeadInput {
  phone?: string;
  email?: string;
  name?: string;
  company?: string;
  /** Stage del embudo de Vox (id de la taxonomía). */
  stageId?: string;
  /** Status de SF ya resuelto (gana sobre el mapeo desde stageId). */
  leadStatus?: string;
  /** Id del Lead en Salesforce, si se conoce (idempotencia). */
  sfLeadId?: string;
  source?: string;
  attributes?: Record<string, string>;
}

export interface VoxLead extends LeadInput {
  leadId: string;
  createdAt?: string;
  updatedAt?: string;
}

interface Lead {
  leadId: string;
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  stageId?: string;
  source?: string;
  sfLeadId?: string;
  attributes?: Record<string, string>;
  history?: LeadHistoryEvent[];
  createdAt?: string;
  updatedAt?: string;
}

function splitName(full?: string): { firstName?: string; lastName: string } {
  const t = (full || "").trim().replace(/\s+/g, " ");
  if (!t) return { lastName: "Lead" }; // SF exige LastName
  const parts = t.split(" ");
  if (parts.length === 1) return { lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// ───────────────────────── Taxonomía: stage ⇄ SF Status ─────────────────────
// El salesforceValue por stage lo configura el usuario en Tipificación y vive
// en connectview-taxonomies. Lo cacheamos en el Lambda caliente.
interface TaxStage { id: string; label?: string; salesforceValue?: string; subStages?: TaxStage[] }
let taxCache: { stages: TaxStage[]; at: number } | null = null;
const TAX_TTL_MS = 5 * 60 * 1000;

async function loadDefaultStages(): Promise<TaxStage[]> {
  if (taxCache && Date.now() - taxCache.at < TAX_TTL_MS) return taxCache.stages;
  try {
    const res = await dynamo.send(new ScanCommand({ TableName: TAXONOMIES_TABLE }));
    const taxos = (res.Items || []).map((it) => unmarshall(it) as { isDefault?: boolean; stages?: TaxStage[] });
    const def = taxos.find((t) => t.isDefault) || taxos[0];
    const stages = def?.stages || [];
    taxCache = { stages, at: Date.now() };
    return stages;
  } catch {
    // Sin taxonomía no podemos mapear Status; el lead igual sincroniza sin tocar Status.
    return [];
  }
}

/** stageId del embudo → SF Lead Status (salesforceValue), si está configurado. */
export async function stageToSfStatus(stageId?: string): Promise<string | undefined> {
  if (!stageId) return undefined;
  const stages = await loadDefaultStages();
  const s = stages.find((x) => x.id === stageId);
  return s?.salesforceValue || undefined;
}

/** SF Lead Status → stageId del embudo (mapeo inverso, para SF → Vox). */
export async function sfStatusToStage(status?: string): Promise<string | undefined> {
  if (!status) return undefined;
  const stages = await loadDefaultStages();
  const norm = status.trim().toLowerCase();
  const hit = stages.find((x) => (x.salesforceValue || "").trim().toLowerCase() === norm);
  return hit?.id;
}

// ───────────────────────── Salesforce (Vox → SF) ────────────────────────────
export interface SfPushExtra {
  /** Si se pasa, además del Lead se registra un Task (gestión del wrap-up). */
  taskSubject?: string;
  taskDescription?: string;
  /** TaskSubtype de SF: "Call" | "Email" | "Task" (según el canal del contacto). */
  taskSubtype?: string;
}

/** Canal del contacto → cómo se registra en SF + cómo se muestra en Vox. */
export function channelToSf(channel?: string): { subtype: string; label: string; emoji: string } {
  const c = (channel || "").toLowerCase();
  if (c.includes("voice") || c.includes("llam") || c.includes("call") || c === "phone")
    return { subtype: "Call", label: "Llamada", emoji: "📞" };
  if (c.includes("email") || c.includes("correo") || c.includes("mail"))
    return { subtype: "Email", label: "Correo", emoji: "✉️" };
  if (c.includes("whatsapp") || c === "wa")
    return { subtype: "Task", label: "WhatsApp", emoji: "💬" };
  if (c.includes("chat"))
    return { subtype: "Task", label: "Chat", emoji: "💬" };
  return { subtype: "Task", label: "Gestión", emoji: "📝" };
}

/**
 * Upsert de un Lead en Salesforce. Busca por sfLeadId, luego por
 * Phone/MobilePhone/Email. Crea con LeadSource="Vox" (anti-eco) o actualiza.
 * Devuelve el Id de SF + la acción, o null si no hay con qué matchear.
 */
export async function pushLeadToSalesforce(
  lead: LeadInput,
  extra: SfPushExtra = {}
): Promise<{ leadId: string; action: "created" | "updated"; taskId?: string | null } | null> {
  const phone = (lead.phone || "").trim();
  const email = (lead.email || "").trim();
  if (!lead.sfLeadId && !phone && !email) return null;

  let status = lead.leadStatus;
  if (!status && lead.stageId) status = await stageToSfStatus(lead.stageId);

  // 1. Encontrar el Lead existente.
  let foundId: string | null = null;
  if (lead.sfLeadId) {
    foundId = lead.sfLeadId;
  } else {
    const clauses: string[] = [];
    if (phone) {
      const p = soqlEscape(phone);
      clauses.push(`Phone = '${p}'`, `MobilePhone = '${p}'`);
    }
    if (email) clauses.push(`Email = '${soqlEscape(email)}'`);
    const found = await soql(
      `SELECT Id FROM Lead WHERE ${clauses.join(" OR ")} ORDER BY LastModifiedDate DESC LIMIT 1`
    );
    foundId = found.length > 0 ? (found[0].Id as string) : null;
  }

  const { firstName, lastName } = splitName(lead.name);
  const fields: Record<string, unknown> = {};
  if (firstName) fields.FirstName = firstName;
  if (phone) fields.Phone = phone;
  if (email) fields.Email = email;
  if (status) fields.Status = status;

  let leadId: string;
  let action: "created" | "updated";
  if (foundId) {
    leadId = foundId;
    action = "updated";
    if (Object.keys(fields).length > 0) await updateSObject("Lead", leadId, fields);
  } else {
    fields.LastName = lastName;
    fields.Company = (lead.company || "").trim() || "Lead sin empresa";
    // Origen real (web/Instagram/Facebook…) como LeadSource; las fuentes internas
    // de Vox ("Vox Wrap-up", "Vox Leads"…) quedan como "Vox" para no disparar el
    // trigger de SF (anti-eco). El valor round-trip evita churn en el inbound.
    fields.LeadSource = lead.source && !/^vox/i.test(lead.source) ? lead.source : "Vox";
    leadId = await insertSObject("Lead", fields);
    action = "created";
  }

  // 2. (Opcional) Task con la gestión.
  let taskId: string | null = null;
  if (extra.taskSubject || extra.taskDescription) {
    try {
      taskId = await insertSObject("Task", {
        WhoId: leadId,
        Subject: (extra.taskSubject || "Vox · Gestión").slice(0, 255),
        Description: (extra.taskDescription || "").slice(0, 30000),
        Status: "Completed",
        Priority: "Normal",
        TaskSubtype: extra.taskSubtype || "Task",
      });
    } catch (err) {
      console.warn("SF Task insert failed:", err);
    }
  }
  return { leadId, action, taskId };
}

// ───────────────────────── Vox Leads table (embudo) ─────────────────────────
async function scanAll(): Promise<Lead[]> {
  const out: Lead[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new ScanCommand({ TableName: LEADS_TABLE, ExclusiveStartKey: lastKey as never })
    );
    for (const it of res.Items || []) out.push(unmarshall(it) as Lead);
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return out;
}

/**
 * Upsert de un Lead en la tabla de Vox (dedup por teléfono). Si nada cambió
 * respecto a lo existente, devuelve changed=false (anti-churn / corta loops).
 */
export async function upsertVoxLead(
  lead: LeadInput
): Promise<{ lead: Lead; isNew: boolean; changed: boolean }> {
  const phone = (lead.phone || "").trim();
  if (!phone) throw new Error("upsertVoxLead: phone required");

  const all = await scanAll();
  const existing = all.find((l) => l.phone === phone) || null;
  const now = new Date().toISOString();
  const leadId = existing?.leadId || randomUUID();
  const isNew = !existing;

  // Merge: lo nuevo gana donde trae valor; lo existente se preserva.
  const merged: Lead = {
    leadId,
    phone,
    name: lead.name ?? existing?.name,
    email: lead.email ?? existing?.email,
    company: lead.company ?? existing?.company,
    stageId: lead.stageId ?? existing?.stageId,
    source: lead.source ?? existing?.source,
    sfLeadId: lead.sfLeadId ?? existing?.sfLeadId,
    attributes:
      lead.attributes || existing?.attributes
        ? { ...(existing?.attributes || {}), ...(lead.attributes || {}) }
        : undefined,
    history: existing?.history, // preservar el historial (no se pisa en el upsert)
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  // ¿Cambió algo material? (ignora updatedAt). Si no, no escribimos.
  const sig = (l?: Partial<Lead>) =>
    JSON.stringify([l?.name, l?.email, l?.company, l?.stageId, l?.source, l?.sfLeadId, l?.attributes]);
  const changed = isNew || sig(merged) !== sig(existing || undefined);
  if (!changed) return { lead: existing as Lead, isNew: false, changed: false };

  await dynamo.send(
    new PutItemCommand({
      TableName: LEADS_TABLE,
      Item: marshall(merged, { removeUndefinedValues: true }),
    })
  );
  return { lead: merged, isNew, changed: true };
}

// Extracción heurística de email/empresa desde los atributos del CSV, para
// que el lead muestre esos campos en el tablero (no solo en attributes).
const EMAIL_KEYS = ["email", "correo", "mail", "e-mail"];
const COMPANY_KEYS = ["empresa", "company", "business", "razon social", "razonsocial"];
function pickAttr(attrs: Record<string, string> | undefined, keys: string[]): string | undefined {
  if (!attrs) return undefined;
  for (const [k, v] of Object.entries(attrs)) {
    const kl = k.trim().toLowerCase();
    if (v && keys.some((kw) => kl === kw || kl.includes(kw))) return String(v);
  }
  return undefined;
}

export interface BulkLeadContact {
  phone: string;
  customerName?: string;
  attributes?: Record<string, string>;
}

/**
 * Alta/merge masiva de leads en el tablero (un solo scan + BatchWrite de 25).
 * Para campañas: llena el embudo SIN empujar a SF ni a Customer Profiles
 * (esos los maneja el flujo de campaña aparte). Acotado por un deadline blando
 * para no exceder el timeout del Lambda con CSVs grandes.
 */
export async function bulkUpsertVoxLeads(
  contacts: BulkLeadContact[],
  opts: { source?: string; deadlineMs?: number } = {}
): Promise<{ attempted: number; created: number; updated: number; skipped: number; dropped: number }> {
  const summary = { attempted: 0, created: 0, updated: 0, skipped: 0, dropped: 0 };
  const deadline = Date.now() + Math.max(1000, opts.deadlineMs ?? 20_000);
  const source = opts.source || "Vox Campaña";

  const existing = await scanAll();
  const byPhone = new Map<string, Lead>();
  for (const l of existing) if (l.phone) byPhone.set(l.phone, l);

  const now = new Date().toISOString();
  const items: Lead[] = [];
  const seen = new Set<string>();
  for (const c of contacts) {
    const phone = (c.phone || "").trim();
    if (!/^\+\d{8,15}$/.test(phone) || seen.has(phone)) {
      summary.skipped++;
      continue;
    }
    seen.add(phone);
    const prev = byPhone.get(phone) || null;
    const merged: Lead = {
      leadId: prev?.leadId || randomUUID(),
      phone,
      name: (c.customerName || "").trim() || prev?.name,
      email: pickAttr(c.attributes, EMAIL_KEYS) ?? prev?.email,
      company: pickAttr(c.attributes, COMPANY_KEYS) ?? prev?.company,
      stageId: prev?.stageId,
      source: prev?.source || source,
      sfLeadId: prev?.sfLeadId,
      attributes:
        c.attributes || prev?.attributes
          ? { ...(prev?.attributes || {}), ...(c.attributes || {}) }
          : undefined,
      createdAt: prev?.createdAt || now,
      updatedAt: now,
    };
    items.push(merged);
    if (prev) summary.updated++;
    else summary.created++;
  }
  summary.attempted = items.length;

  // Escribimos con PutItem (con concurrencia acotada), NO BatchWriteItem: el rol
  // compartido tiene PutItem/Update/Query sobre connectview-leads pero no
  // BatchWriteItem. PutItem evita pedir un permiso IAM nuevo.
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      if (Date.now() > deadline) {
        summary.dropped += items.length - cursor;
        cursor = items.length;
        return;
      }
      const it = items[cursor++];
      await dynamo
        .send(new PutItemCommand({ TableName: LEADS_TABLE, Item: marshall(it, { removeUndefinedValues: true }) }))
        .catch(() => {});
    }
  }
  await Promise.all(Array.from({ length: Math.min(10, items.length) }, () => worker()));
  return summary;
}

/** Set sfLeadId en un lead ya existente (tras crear el Lead en SF). */
async function setSfLeadId(leadId: string, sfLeadId: string): Promise<void> {
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: leadId } },
        UpdateExpression: "SET sfLeadId = :s",
        ExpressionAttributeValues: { ":s": { S: sfLeadId } },
      })
    );
  } catch (err) {
    console.warn("setSfLeadId failed:", err);
  }
}

// ───────────────────────── Customer Profile (Cliente 360°) ──────────────────
async function upsertProfile(lead: LeadInput): Promise<void> {
  const phone = (lead.phone || "").trim();
  if (!/^\+\d{8,15}$/.test(phone)) return;
  const attributes: Record<string, string> = { ...(lead.attributes || {}) };
  if (lead.email) attributes.email = lead.email;
  if (lead.company) attributes.empresa = lead.company;
  if (lead.sfLeadId) attributes.sf_lead_id = lead.sfLeadId;
  try {
    // ctx tenant-scoped: el perfil cae en el dominio CP del cliente (o se
    // saltea si domainName ""). NUNCA en el dominio de Novasys para un tenant real.
    await upsertProfileFromCsvContact(
      { phone, customerName: lead.name, attributes },
      { profiles: activeProfiles, domainName: activeProfilesDomain }
    );
  } catch (err) {
    console.warn("upsertProfile failed:", err);
  }
}

// ───────────────────────── El hub ───────────────────────────────────────────
export interface PropagateResult {
  leadId?: string;
  voxAction?: "created" | "updated" | "unchanged";
  sf?: { leadId: string; action: string; taskId?: string | null } | null;
  profile?: "ok" | "skipped";
}

/**
 * propagateLead — punto único de entrada. Escribe el lead en las tres
 * superficies. origin="salesforce" evita re-empujar a SF (anti-loop).
 *
 * @param origin de dónde viene el cambio: "vox" (tablero/campaña/wrap-up) o
 *               "salesforce" (vino del webhook inbound).
 */
export async function propagateLead(
  lead: LeadInput,
  opts: { origin?: "vox" | "salesforce"; pushToSf?: boolean; sfExtra?: SfPushExtra } = {}
): Promise<PropagateResult> {
  const origin = opts.origin || "vox";
  const pushToSf = opts.pushToSf ?? origin !== "salesforce";
  const result: PropagateResult = {};

  // 1. Tabla de Leads (embudo).
  let stored: Lead | null = null;
  if ((lead.phone || "").trim()) {
    const r = await upsertVoxLead(lead);
    stored = r.lead;
    result.leadId = r.lead.leadId;
    result.voxAction = r.isNew ? "created" : r.changed ? "updated" : "unchanged";
  }

  // 2. Customer Profile (Cliente 360°).
  await upsertProfile(lead);
  result.profile = (lead.phone || "").trim() ? "ok" : "skipped";

  // 3. Salesforce (salvo que el cambio venga de SF).
  if (pushToSf) {
    try {
      const sf = await pushLeadToSalesforce({ ...lead, sfLeadId: lead.sfLeadId ?? stored?.sfLeadId }, opts.sfExtra);
      result.sf = sf ? { leadId: sf.leadId, action: sf.action, taskId: sf.taskId } : null;
      // Guardar el sfLeadId recién creado para futuros updates idempotentes.
      if (sf && stored && !stored.sfLeadId) await setSfLeadId(stored.leadId, sf.leadId);
    } catch (err) {
      console.error("propagateLead → SF push failed:", err);
      result.sf = null;
    }
  } else {
    result.sf = null;
  }

  return result;
}

// ───────────────────────── Historial de contacto (en el lead) ───────────────
export interface LeadHistoryEvent {
  ts: string;
  type: "gestion" | "interaccion" | "stage_change" | "update" | "note";
  channel?: string; // "Llamada" | "Correo" | "WhatsApp" | …
  /** true ⇒ interacción registrada SIN tipificación (señal de seguimiento). */
  untyped?: boolean;
  /** Id del contacto de Connect (trazabilidad). */
  contactId?: string;
  stageId?: string;
  stageLabel?: string;
  subStageLabel?: string;
  valoracion?: string;
  summary?: string;
  notes?: string;
  agent?: string;
  sfTaskId?: string; // Task de SF creado por este evento (para dedup en la UI)
}

/** Agrega un evento al historial del lead (lista append-only en el propio item). */
export async function appendLeadHistory(leadId: string, ev: LeadHistoryEvent): Promise<void> {
  if (!leadId) return;
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: leadId } },
        // También bumpea updatedAt → el lead sube en "Contacto reciente" con cada evento.
        UpdateExpression: "SET history = list_append(if_not_exists(history, :empty), :new), updatedAt = :now",
        ExpressionAttributeValues: {
          ":empty": { L: [] },
          ":new": { L: [{ M: marshall(ev, { removeUndefinedValues: true }) }] },
          ":now": { S: ev.ts || new Date().toISOString() },
        },
      })
    );
  } catch (err) {
    console.warn("appendLeadHistory failed", err);
  }
}

/** Historial de un lead por teléfono (para el panel del detalle en Vox). */
export async function getLeadHistoryByPhone(phone: string): Promise<LeadHistoryEvent[]> {
  const p = (phone || "").trim();
  if (!p) return [];
  const all = await scanAll();
  const lead = all.find((l) => l.phone === p);
  return Array.isArray(lead?.history) ? (lead!.history as LeadHistoryEvent[]) : [];
}

/** stageId del embudo → label legible (para describir el evento de cambio). */
export async function stageIdToLabel(stageId?: string): Promise<string | undefined> {
  if (!stageId) return undefined;
  const stages = await loadDefaultStages();
  return stages.find((x) => x.id === stageId)?.label || undefined;
}
