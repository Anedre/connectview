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
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { CustomerProfilesClient } from "@aws-sdk/client-customer-profiles";
import { randomUUID } from "node:crypto";
import {
  soql,
  soqlEscape,
  insertSObject,
  updateSObject,
  getActiveTenantId,
} from "./salesforceClient";
import { upsertProfileFromCsvContact } from "./upsertCustomerProfileFromCsv";
import { normalizePhone, samePhone, sfPhoneCandidates } from "./phone";
import { computeScore, computeGrade, getScoringRules } from "./scoring";

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
const LEGACY_PROFILES_DOMAIN = process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";
const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 2 });
let activeProfiles: CustomerProfilesClient = legacyProfiles;
let activeProfilesDomain: string = LEGACY_PROFILES_DOMAIN;
/** Set tenant-scoped Customer Profiles (cliente + dominio). Pasar `client=null`
 *  = legacy Vox/Novasys. Un `domain` "" (con client no-null = tenant real sin
 *  CP) = fail-closed: el upsert del Cliente 360° se saltea. */
export function setActiveProfiles(
  client: CustomerProfilesClient | null,
  domain: string | null,
): void {
  if (client) {
    activeProfiles = client;
    activeProfilesDomain = domain ?? "";
  } else {
    activeProfiles = legacyProfiles;
    activeProfilesDomain = LEGACY_PROFILES_DOMAIN;
  }
}
// ── Pilar 10 — mapeo de campos ARIA→Salesforce (schema-aware) ────────────────
// El cliente indica QUÉ campos de SU org se actualizan (R24: ARIA no crea campos).
// Default = los campos estándar que ARIA ya escribía; el admin lo sobreescribe
// por tenant (Configuración → Integraciones). Target "" = NO escribir ese campo.
// LastName queda fijo (requerido por SF para crear el Lead).
export type SfMappableField = "firstName" | "phone" | "email" | "company" | "status" | "source";
export type SfFieldMapping = Partial<Record<SfMappableField, string>>;
const DEFAULT_SF_FIELD_MAP: Record<SfMappableField, string> = {
  firstName: "FirstName",
  phone: "Phone",
  email: "Email",
  company: "Company",
  status: "Status",
  source: "LeadSource",
};
// Auto-carga del mapeo del tenant desde connectview-connections (control-plane,
// cuenta de Vox), cacheado por tenant (TTL 5 min, como la taxonomía). Así TODO
// caller de propagateLead (wrap-up, tablero, webhooks, campañas) respeta el
// mapeo, no solo uno. Best-effort: sin config / sin acceso → null (defaults).
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const sfMapCache = new Map<string, { m: SfFieldMapping | null; at: number }>();
const SFMAP_TTL_MS = 5 * 60 * 1000;
async function loadActiveSfMapping(): Promise<SfFieldMapping | null> {
  const tid = getActiveTenantId();
  if (!tid) return null;
  const hit = sfMapCache.get(tid);
  if (hit && Date.now() - hit.at < SFMAP_TTL_MS) return hit.m;
  let m: SfFieldMapping | null = null;
  try {
    const r = await legacyDynamo.send(
      new GetItemCommand({ TableName: CONNECTIONS_TABLE, Key: { tenantId: { S: tid } } }),
    );
    const json = r.Item?.configJson?.S;
    if (json) {
      const cfg = JSON.parse(json) as { salesforce?: { fieldMapping?: SfFieldMapping } };
      m = cfg?.salesforce?.fieldMapping || null;
    }
  } catch {
    /* sin config / sin acceso → defaults */
  }
  sfMapCache.set(tid, { m, at: Date.now() });
  return m;
}
/** Target SF de un campo ARIA con el override del tenant. "" / "-" = skip. */
function sfTargetWith(mapping: SfFieldMapping | null, field: SfMappableField): string {
  const v = mapping?.[field];
  const t = (v === undefined ? DEFAULT_SF_FIELD_MAP[field] : v).trim();
  return t === "-" ? "" : t;
}

const LEADS_TABLE = process.env.LEADS_TABLE || "connectview-leads";
const LEAD_PROGRAMS_TABLE = process.env.LEAD_PROGRAMS_TABLE || "connectview-lead-programs";
const PROGRAMS_TABLE = process.env.PROGRAMS_TABLE || "connectview-programs";
const TAXONOMIES_TABLE = process.env.TAXONOMIES_TABLE || "connectview-taxonomies";
/** Campo External Id en el Lead de Salesforce que guarda el `leadId` de Vox.
 *  Configurable por si el admin lo nombra distinto. Si NO existe en la org, el
 *  push degrada con gracia al match por sfLeadId/teléfono/email (ver más abajo). */
const SF_VOX_EXTID_FIELD = process.env.SF_VOX_EXTID_FIELD || "VoxLeadId__c";

/**
 * F5.1 — rollup de golpes (R4) escrito al Lead de SF: cuántos toques, último
 * toque, y (si convirtió) golpes/días al cierre. El cliente crea estos campos
 * custom en su org; si NO existen, el push los descarta y reintenta (misma
 * degradación que `VoxLeadId__c`). `converted` es un checkbox. Ver design/fase-5.md.
 */
const VOX_ROLLUP_FIELDS = {
  touches: "VoxTouches__c",
  lastTouch: "VoxLastTouch__c",
  firstTouch: "VoxFirstTouch__c",
  touchesToClose: "VoxTouchesToClose__c",
  daysToClose: "VoxDaysToClose__c",
  converted: "VoxConverted__c",
} as const;
const VOX_ROLLUP_SET: Set<string> = new Set(Object.values(VOX_ROLLUP_FIELDS));
// Campos rollup que la org NO tiene (aprendidos del error de SF) → no reintentar.
const voxRollupMissing = new Set<string>();

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
  /** Programa (Pilar 1) al que pertenece el lead → escribe membership N:N
   *  en connectview-lead-programs. Auto-tagging: cada origen que conozca su
   *  programa lo pasa y el lead aparece scopeado en ese programa. */
  programId?: string;
  /** F5.1 — ledger de golpes (Pilar 2). Si viene, el push a SF escribe el rollup
   *  R4 (touches/lastTouch/daysToClose) en los campos `Vox*__c` del Lead. */
  history?: LeadHistoryEvent[];
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
  /** SEC-A1 — tenant dueño de la fila. Sin esto, el filtro por tenant del feed
   *  (get-analytics-feed) y de Consumo (get-cost-report) era un no-op (nunca
   *  filtraba porque los leads no traían tenantId). Se estampa desde el tenant
   *  ACTIVO (getActiveTenantId, seteado por setActiveTenant en cada caller) o el
   *  `opts.tenantId` explícito. Ausente = fila legacy (pooled Novasys): el feed
   *  la muestra SOLO al solicitante legacy. */
  tenantId?: string;
  montoEstimado?: number;
  // Fase 2 — scoring (comportamiento) + grading (fit demográfico). Se recomputan
  // en cada golpe dentro de appendLeadHistory (recomputeLeadScore).
  score?: number;
  grade?: string;
  scoreInputs?: Record<string, number>;
  scoreComputedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * SEC-A1 — tenant a estampar en el item de lead. Prioriza el `override` explícito
 * (los callers que NO llaman setActiveTenant, p.ej. create-campaign/edit-campaign-
 * contacts, pueden pasar su tenantId por opts) y cae al tenant ACTIVO del contexto
 * (getActiveTenantId, seteado por setActiveTenant). Devuelve `undefined` para
 * anónimo/legacy vacío ("") → la fila NO lleva tenantId (comportamiento legacy:
 * pooled Novasys, visible solo al solicitante legacy en el feed/Consumo). "novasys"/
 * "default" se estampan tal cual (inofensivo: el filtro legacy los acepta igual). */
function stampTenant(override?: string): string | undefined {
  const t = (override ?? getActiveTenantId() ?? "").trim();
  return t || undefined;
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
interface TaxStage {
  id: string;
  label?: string;
  valoracion?: string;
  salesforceValue?: string;
  subStages?: TaxStage[];
}
let taxCache: { stages: TaxStage[]; at: number } | null = null;
const TAX_TTL_MS = 5 * 60 * 1000;

// ¿Existe el campo External Id (`VoxLeadId__c`) en la org de SF de este tenant?
// Lo probamos 1× por contenedor caliente (TTL 5 min, igual que la taxonomía).
// `null` = sin probar. Si NO existe, el push NO escribe el campo (evita
// INVALID_FIELD) y matchea por teléfono/email — el código queda listo para el
// día que el admin cree el campo, sin redeploy. Además los writes se
// auto-recuperan ante INVALID_FIELD (ver `sfWriteLead`), así que un cache viejo
// (p.ej. tras cambiar de tenant) nunca rompe un sync.
let voxExtId: { exists: boolean; at: number } | null = null;
const EXTID_TTL_MS = 5 * 60 * 1000;

// Cache de programas por código (resolver programId desde utm_campaign / columna
// "programa" — R26). TTL 5 min, igual que la taxonomía; se invalida por-tenant
// en resetTaxonomyCache.
let programsByCodeCache: { map: Map<string, string>; at: number } | null = null;
const PROGRAMS_TTL_MS = 5 * 60 * 1000;
const PROGRAM_CODE_KEYS = [
  "utm_campaign",
  "programa",
  "program",
  "program_code",
  "programcode",
  "programa_codigo",
  "codigo_programa",
  "codigoprograma",
];

/** Invalida el cache de taxonomía. OBLIGATORIO al cambiar de tenant dentro de
 *  un mismo contenedor (p.ej. el automation-engine procesando varios tenants):
 *  el cache NO está keyeado por tenant y serviría stages/salesforceValue de
 *  otro cliente. */
export function resetTaxonomyCache(): void {
  taxCache = null;
  // El schema de SF también es per-tenant → invalidar junto con la taxonomía
  // (mismos call-sites en el loop multi-tenant del automation-engine).
  voxExtId = null;
  programsByCodeCache = null;
}

async function loadDefaultStages(): Promise<TaxStage[]> {
  if (taxCache && Date.now() - taxCache.at < TAX_TTL_MS) return taxCache.stages;
  try {
    const res = await dynamo.send(new ScanCommand({ TableName: TAXONOMIES_TABLE }));
    const taxos = (res.Items || []).map(
      (it) => unmarshall(it) as { isDefault?: boolean; stages?: TaxStage[] },
    );
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
  if (c.includes("chat")) return { subtype: "Task", label: "Chat", emoji: "💬" };
  return { subtype: "Task", label: "Gestión", emoji: "📝" };
}

/**
 * El Lead matcheado ya fue convertido a Contact/Account (IsConverted=true) y por
 * tanto NO se puede actualizar (SF responde CANNOT_UPDATE_CONVERTED_LEAD).
 * `pushLeadToSalesforce` la captura para redirigir la gestión al Contact en vez
 * de perder el sync; se exporta por si un caller quiere distinguir este caso.
 */
export class ConvertedLeadError extends Error {
  /** Id del Lead convertido en Salesforce. */
  readonly leadId: string;
  /** Error original de Salesforce (para diagnóstico). */
  readonly sfError?: unknown;
  constructor(leadId: string, sfError?: unknown) {
    super(`Lead ${leadId} ya fue convertido a Contact/Account; no se puede actualizar`);
    this.name = "ConvertedLeadError";
    this.leadId = leadId;
    this.sfError = sfError;
  }
}

// ───────────────────────── External Id (dedup determinístico) ───────────────
/** ¿El error de SF es por un campo inexistente (p.ej. VoxLeadId__c no creado)? */
function isInvalidField(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /INVALID_FIELD|No such column|INVALID_TYPE/i.test(m);
}

/** ¿El error de SF es por intentar actualizar un Lead ya convertido? */
function isConvertedLeadError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /CANNOT_UPDATE_CONVERTED_LEAD/i.test(m);
}

/** ¿La org tiene el campo External Id? Probado 1×/contenedor (TTL 5 min). */
async function leadExtIdAvailable(): Promise<boolean> {
  if (voxExtId && Date.now() - voxExtId.at < EXTID_TTL_MS) return voxExtId.exists;
  try {
    await soql(`SELECT ${SF_VOX_EXTID_FIELD} FROM Lead LIMIT 1`);
    voxExtId = { exists: true, at: Date.now() };
  } catch (err) {
    if (isInvalidField(err)) {
      voxExtId = { exists: false, at: Date.now() };
    } else {
      // Error transitorio (auth/red): no cachear; asumir ausente solo esta vez.
      return false;
    }
  }
  return voxExtId.exists;
}

/**
 * Insert/Update del Lead con auto-recuperación: si la org NO tiene el campo
 * External Id (INVALID_FIELD), lo quita y reintenta una vez. Así un cache viejo
 * de `voxExtId` jamás rompe un sync. Devuelve el Id (create) o el id pasado.
 */
async function sfWriteLead(
  mode: "create" | "update",
  fields: Record<string, unknown>,
  id?: string,
): Promise<string> {
  const write = async (f: Record<string, unknown>): Promise<string> => {
    if (mode === "create") return await insertSObject("Lead", f);
    await updateSObject("Lead", id as string, f);
    return id as string;
  };
  // Los campos OPCIONALES de Vox (External Id + rollup R4) pueden no existir en la
  // org del cliente. Si SF los rechaza (INVALID_FIELD), los quitamos —el que
  // identifique el error, o todos los presentes— y reintentamos. Un campo inválido
  // que NO sea de Vox (mapeo mal configurado del cliente) se propaga tal cual.
  let f = fields;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await write(f);
    } catch (err) {
      if (isInvalidField(err)) {
        const bad = invalidFieldName(err);
        const dropOne = (k: string) => {
          if (k === SF_VOX_EXTID_FIELD) voxExtId = { exists: false, at: Date.now() };
          else voxRollupMissing.add(k);
          f = { ...f };
          delete f[k];
        };
        if (bad && (bad === SF_VOX_EXTID_FIELD || VOX_ROLLUP_SET.has(bad)) && bad in f) {
          dropOne(bad);
          continue;
        }
        // No identificamos el campo exacto → quitamos todos los opcionales presentes.
        const present = Object.keys(f).filter(
          (k) => k === SF_VOX_EXTID_FIELD || VOX_ROLLUP_SET.has(k),
        );
        if (present.length) {
          present.forEach(dropOne);
          continue;
        }
      }
      // Lead ya convertido → señal tipada para que el caller redirija al Contact.
      if (mode === "update" && isConvertedLeadError(err))
        throw new ConvertedLeadError(id as string, err);
      throw err;
    }
  }
  // Agotados los reintentos, un último intento propaga el error real (sin tragarlo).
  return await write(f);
}

/** Extrae el nombre del campo inválido del error de SF ("No such column 'X'…"). */
export function invalidFieldName(err: unknown): string | null {
  const m = err instanceof Error ? err.message : String(err);
  const col = m.match(/No such column '([^']+)'/i) || m.match(/INVALID_FIELD[^']*'([^']+)'/i);
  if (col) return col[1];
  for (const field of [SF_VOX_EXTID_FIELD, ...VOX_ROLLUP_SET]) {
    if (m.includes(field)) return field;
  }
  return null;
}

// El match trae el estado de conversión: un Lead convertido NO se puede
// actualizar, así que necesitamos saberlo ANTES de intentar el update.
const LEAD_MATCH_COLS = "Id, IsConverted, ConvertedContactId";
interface LeadMatch {
  id: string;
  isConverted: boolean;
  convertedContactId: string | null;
}
function toLeadMatch(row?: Record<string, unknown>): LeadMatch | null {
  if (!row?.Id) return null;
  return {
    id: row.Id as string,
    isConverted: !!row.IsConverted,
    convertedContactId: (row.ConvertedContactId as string) || null,
  };
}

/** Resuelve un Lead por Id con su estado de conversión. `null` si el Id ya no
 *  matchea un Lead (borrado, o un id viejo que no es de Lead) → el caller cae al
 *  resto del match en vez de pegarle un update condenado al fracaso. */
async function fetchLeadById(id: string): Promise<LeadMatch | null> {
  try {
    const rows = await soql(
      `SELECT ${LEAD_MATCH_COLS} FROM Lead WHERE Id = '${soqlEscape(id)}' LIMIT 1`,
    );
    return toLeadMatch(rows[0]);
  } catch (err) {
    // Id malformado (p.ej. se guardó un id que no es de Lead) → no-match.
    const m = err instanceof Error ? err.message : String(err);
    if (/MALFORMED_ID|INVALID_QUERY/i.test(m)) return null;
    throw err;
  }
}

/** Cláusulas SOQL `OR` para matchear por teléfono (E.164 + dígitos pelados, los
 *  dos almacenamientos comunes en SF) y email. Sirven igual para Lead y Contact
 *  (ambos tienen Phone/MobilePhone/Email). La puntuación interna la cubre el
 *  match determinístico por External Id. */
function phoneEmailClauses(phone: string, email: string): string[] {
  const clauses: string[] = [];
  for (const cand of sfPhoneCandidates(phone)) {
    const p = soqlEscape(cand);
    clauses.push(`Phone = '${p}'`, `MobilePhone = '${p}'`);
  }
  if (email) clauses.push(`Email = '${soqlEscape(email)}'`);
  return clauses;
}

/** Busca un Contact por teléfono/email (mismas cláusulas que el Lead). Devuelve
 *  el Id del Contact más reciente, o `null`. Se usa para NO crear un Lead
 *  duplicado cuando la persona ya existe como Contact (Lead convertido, etc.). */
async function findContactByPhoneEmail(clauses: string[]): Promise<string | null> {
  if (clauses.length === 0) return null;
  try {
    const rows = await soql(
      `SELECT Id FROM Contact WHERE ${clauses.join(" OR ")} ORDER BY LastModifiedDate DESC LIMIT 1`,
    );
    return rows.length > 0 ? (rows[0].Id as string) : null;
  } catch (err) {
    // El match por Contact es un best-effort: si falla, seguimos (crear Lead).
    console.warn("SF Contact match failed:", err);
    return null;
  }
}

/**
 * Upsert de un Lead en Salesforce. Orden de match (dedup):
 *   1. sfLeadId conocido (idempotente) — re-resuelto para conocer su conversión.
 *   2. `VoxLeadId__c == leadId de Vox` → determinístico, CERO duplicados (si la
 *      org tiene el campo External Id).
 *   3. Teléfono (normalizado, varias formas) / Email sobre Lead.
 *   4. Teléfono / Email sobre Contact (la persona ya pudo convertirse).
 *
 * Leads convertidos: un Lead con `IsConverted=true` NO se puede actualizar
 * (CANNOT_UPDATE_CONVERTED_LEAD). Antes el update tiraba error y el sync se
 * perdía. Ahora detectamos la conversión en el SELECT y registramos la gestión
 * (Task) contra el `ConvertedContactId` en vez de fallar. Si la persona ya es
 * Contact (paso 4), tampoco creamos un Lead duplicado: la gestión va al Contact.
 *
 * Estampa `VoxLeadId__c` en el Lead (create Y update) para que TODO sync futuro
 * matchee por ahí. Crea con LeadSource="Vox" (anti-eco) o actualiza el match.
 * Devuelve { leadId, kind, action } o null si no hay con qué matchear. `kind`
 * distingue si `leadId` es un Lead (persistible como sfLeadId) o un Contact.
 *
 * `voxLeadId` = el leadId de Vox (External Id). Sin él, cae al match por
 * teléfono/email (comportamiento previo, pero ya con teléfono normalizado).
 */
/**
 * Pilar 3 Fase C — propaga una baja/alta a Salesforce: setea `DoNotCall` en el
 * Lead que matchee (por External Id si la org lo tiene, si no por teléfono).
 * STOP → DoNotCall=true; ALTA (re-alta) → DoNotCall=false, simétrico. Best-effort:
 * si SF no está conectado, el campo no existe o no hay match → no-op silencioso.
 * El caller debe haber llamado `setActiveTenant(tenantId)` antes (token + org).
 */
export async function pushDoNotCallToSalesforce(
  phone: string,
  doNotCall: boolean,
  opts: { voxLeadId?: string } = {},
): Promise<{ updated: boolean; sfId?: string }> {
  const raw = (phone || "").trim();
  if (!raw) return { updated: false };
  try {
    let sfId: string | undefined;
    // 1. Match determinístico por External Id (si la org tiene el campo VoxLeadId__c).
    if (opts.voxLeadId && (await leadExtIdAvailable())) {
      try {
        const byExt = await soql(
          `SELECT Id FROM Lead WHERE ${SF_VOX_EXTID_FIELD} = '${soqlEscape(opts.voxLeadId)}' LIMIT 1`,
        );
        sfId = byExt[0]?.Id as string | undefined;
      } catch {
        /* campo ausente / cache viejo → caemos al match por teléfono */
      }
    }
    // 2. Fallback: teléfono (E.164 + dígitos pelados, ambos almacenamientos SF).
    if (!sfId) {
      const clauses = phoneEmailClauses(normalizePhone(raw)?.e164 || raw, "");
      if (clauses.length) {
        const found = await soql(
          `SELECT Id FROM Lead WHERE ${clauses.join(" OR ")} ORDER BY LastModifiedDate DESC LIMIT 1`,
        );
        sfId = found[0]?.Id as string | undefined;
      }
    }
    if (!sfId) return { updated: false };
    await updateSObject("Lead", sfId, { DoNotCall: doNotCall });
    return { updated: true, sfId };
  } catch (err) {
    console.warn(
      "pushDoNotCallToSalesforce falló (best-effort):",
      err instanceof Error ? err.message : err,
    );
    return { updated: false };
  }
}

export async function pushLeadToSalesforce(
  lead: LeadInput,
  extra: SfPushExtra = {},
  voxLeadId?: string,
): Promise<{
  leadId: string;
  kind: "lead" | "contact";
  action: "created" | "updated" | "skipped";
  taskId?: string | null;
} | null> {
  const phone = (lead.phone || "").trim();
  const email = (lead.email || "").trim();
  if (!lead.sfLeadId && !phone && !email && !voxLeadId) return null;

  let status = lead.leadStatus;
  if (!status && lead.stageId) status = await stageToSfStatus(lead.stageId);

  const extIdOk = !!voxLeadId && (await leadExtIdAvailable());

  // 1. Encontrar el Lead existente. Orden: sfLeadId → VoxLeadId__c → teléfono/email.
  let match: LeadMatch | null = null;
  if (lead.sfLeadId) {
    // El id conocido pudo convertirse desde el último sync (o ser viejo/borrado);
    // lo resolvemos para saberlo. Si no resuelve a un Lead, caemos al resto.
    match = await fetchLeadById(lead.sfLeadId);
  }
  if (!match && extIdOk) {
    try {
      const byExt = await soql(
        `SELECT ${LEAD_MATCH_COLS} FROM Lead WHERE ${SF_VOX_EXTID_FIELD} = '${soqlEscape(voxLeadId as string)}' LIMIT 1`,
      );
      match = toLeadMatch(byExt[0]);
    } catch (err) {
      // El campo no existe (cache viejo) → recordarlo y seguir con teléfono/email.
      if (isInvalidField(err)) voxExtId = { exists: false, at: Date.now() };
      else throw err;
    }
  }
  const clauses = phoneEmailClauses(phone, email);
  if (!match && clauses.length > 0) {
    const found = await soql(
      `SELECT ${LEAD_MATCH_COLS} FROM Lead WHERE ${clauses.join(" OR ")} ORDER BY LastModifiedDate DESC LIMIT 1`,
    );
    match = toLeadMatch(found[0]);
  }
  // 1b. Si no hay Lead, la persona puede ya ser Contact (Lead convertido por
  //     otra vía, o alta directa). Buscarla antes de crear un Lead duplicado.
  let contactId: string | null = null;
  if (!match && clauses.length > 0) {
    contactId = await findContactByPhoneEmail(clauses);
  }

  const { firstName, lastName } = splitName(lead.name);
  // Pilar 10 — mapeo del tenant (auto-cargado de connectview-connections). Aplica
  // a CUALQUIER origen del lead, no solo al wrap-up.
  const reqMapping = await loadActiveSfMapping();
  const fields: Record<string, unknown> = {};
  // Escribe cada campo en su target SF mapeado (default = estándar); target ""
  // = el admin lo deshabilitó (R24: el cliente elige qué se actualiza).
  const put = (field: SfMappableField, val: unknown) => {
    const t = sfTargetWith(reqMapping, field);
    if (t && val != null && val !== "") fields[t] = val;
  };
  put("firstName", firstName);
  // Guardamos el teléfono normalizado (E.164) → mejora el match exacto futuro.
  put("phone", phone ? normalizePhone(phone)?.e164 || phone : "");
  put("email", email);
  put("status", status);
  // Estampar el External Id (update y create) vincula el Lead de SF con el de
  // Vox → todo sync posterior matchea por ahí (determinístico). `sfWriteLead`
  // lo quita y reintenta si la org aún no tiene el campo. NO es remapeable.
  if (extIdOk) fields[SF_VOX_EXTID_FIELD] = voxLeadId;

  // F5.1 — rollup de golpes (R4). Solo si el lead trae history (señal de que hay
  // ledger que resumir); los campos que la org no tenga se descartan en sfWriteLead.
  if (Array.isArray(lead.history)) {
    const roll = await summarizeGolpes(lead.history, lead.stageId);
    const putRoll = (field: string, val: unknown) => {
      if (val != null && val !== "" && !voxRollupMissing.has(field)) fields[field] = val;
    };
    putRoll(VOX_ROLLUP_FIELDS.touches, roll.total);
    putRoll(VOX_ROLLUP_FIELDS.lastTouch, roll.lastTouchAt?.slice(0, 10));
    putRoll(VOX_ROLLUP_FIELDS.firstTouch, roll.firstTouchAt?.slice(0, 10));
    putRoll(VOX_ROLLUP_FIELDS.converted, roll.converted);
    if (roll.converted) {
      putRoll(VOX_ROLLUP_FIELDS.touchesToClose, roll.touchesToClose);
      putRoll(VOX_ROLLUP_FIELDS.daysToClose, roll.daysToClose);
    }
  }

  // Resolver el registro destino + dónde se ancla la gestión (Task).
  let leadId: string;
  let kind: "lead" | "contact";
  let action: "created" | "updated" | "skipped";
  let taskWhoId: string | null;

  if (match && !match.isConverted) {
    // Lead vivo → actualizar normal.
    leadId = match.id;
    kind = "lead";
    action = "updated";
    taskWhoId = match.id;
    if (Object.keys(fields).length > 0) {
      try {
        await sfWriteLead("update", fields, match.id);
      } catch (err) {
        if (!(err instanceof ConvertedLeadError)) throw err;
        // Raza: se convirtió entre el SELECT y el PATCH → redirigir al Contact.
        action = "skipped";
        taskWhoId = (await fetchLeadById(match.id))?.convertedContactId ?? null;
      }
    }
  } else if (match && match.isConverted) {
    // Lead convertido → NO se puede actualizar; la gestión va al Contact. Se
    // devuelve el Lead id (kind "lead", sigue siendo un Lead válido): el próximo
    // sync vuelve a detectar la conversión (idempotente).
    leadId = match.id;
    kind = "lead";
    action = "skipped";
    taskWhoId = match.convertedContactId;
  } else if (contactId) {
    // Ya es Contact → registramos la gestión contra él, sin crear Lead.
    leadId = contactId;
    kind = "contact";
    action = "skipped";
    taskWhoId = contactId;
  } else {
    // Nada matcheó → crear Lead nuevo. LastName es REQUERIDO por SF → fijo.
    fields.LastName = lastName;
    const company = (lead.company || "").trim() || "Lead sin empresa";
    put("company", company);
    // Company es requerido por SF para crear un Lead → garantizamos que esté,
    // aun si el admin remapeó "company" a un campo custom.
    if (!("Company" in fields)) fields.Company = company;
    // Origen real (web/Instagram/Facebook…) como LeadSource; las fuentes internas
    // de Vox ("Vox Wrap-up", "Vox Leads"…) quedan como "Vox" para no disparar el
    // trigger de SF (anti-eco). El valor round-trip evita churn en el inbound.
    put("source", lead.source && !/^vox/i.test(lead.source) ? lead.source : "Vox");
    leadId = await sfWriteLead("create", fields);
    kind = "lead";
    action = "created";
    taskWhoId = leadId;
  }

  // 2. (Opcional) Task con la gestión, anclado al Lead o al Contact según el caso.
  let taskId: string | null = null;
  if (extra.taskSubject || extra.taskDescription) {
    if (taskWhoId) {
      try {
        taskId = await insertSObject("Task", {
          WhoId: taskWhoId,
          Subject: (extra.taskSubject || "Vox · Gestión").slice(0, 255),
          Description: (extra.taskDescription || "").slice(0, 30000),
          Status: "Completed",
          Priority: "Normal",
          TaskSubtype: extra.taskSubtype || "Task",
        });
      } catch (err) {
        console.warn("SF Task insert failed:", err);
      }
    } else {
      // Lead convertido sin ConvertedContactId resoluble: no perdemos el sync,
      // pero dejamos rastro de que la gestión no pudo anclarse a nadie.
      console.warn(`SF Task skipped: lead ${leadId} convertido sin Contact destino`);
    }
  }
  return { leadId, kind, action, taskId };
}

// ───────────────────────── Vox Leads table (embudo) ─────────────────────────
async function scanAll(): Promise<Lead[]> {
  const out: Lead[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new ScanCommand({ TableName: LEADS_TABLE, ExclusiveStartKey: lastKey as never }),
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
  lead: LeadInput,
): Promise<{ lead: Lead; isNew: boolean; changed: boolean }> {
  const phone = (lead.phone || "").trim();
  if (!phone) throw new Error("upsertVoxLead: phone required");

  const all = await scanAll();
  // Dedup tolerante a formato (+51999… == 999…) → evita leads duplicados por la
  // misma persona escrita distinto. (El scan O(n) y la carrera quedan para el
  // fix de GSI; esto cierra la causa #1 de duplicados: el match exacto.)
  const existing = all.find((l) => samePhone(l.phone, phone)) || null;
  const now = new Date().toISOString();
  const leadId = existing?.leadId || randomUUID();
  const isNew = !existing;

  // Merge: lo nuevo gana donde trae valor; lo existente se preserva.
  const merged: Lead = {
    leadId,
    // Guardamos el teléfono normalizado (E.164) → la tabla converge a un formato.
    phone: normalizePhone(phone)?.e164 || phone,
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
    // SEC-A1: tenant dueño de la fila (del contexto activo). Preserva el existente
    // si ahora no hay tenant resuelto → un update legacy no borra un tenantId previo.
    tenantId: stampTenant() ?? existing?.tenantId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  // ¿Cambió algo material? (ignora updatedAt). Si no, no escribimos.
  const sig = (l?: Partial<Lead>) =>
    JSON.stringify([
      l?.name,
      l?.email,
      l?.company,
      l?.stageId,
      l?.source,
      l?.sfLeadId,
      l?.attributes,
    ]);
  const changed = isNew || sig(merged) !== sig(existing || undefined);
  if (!changed) return { lead: existing as Lead, isNew: false, changed: false };

  await dynamo.send(
    new PutItemCommand({
      TableName: LEADS_TABLE,
      Item: marshall(merged, { removeUndefinedValues: true }),
    }),
  );
  return { lead: merged, isNew, changed: true };
}

// ───────────────────────── Programa (membership N:N, Pilar 1) ────────────────
/**
 * Upsert de la pertenencia lead↔programa en connectview-lead-programs
 * (PK=programId, SK=leadId). Idempotente: preserva addedAt, actualiza
 * stageId (etapa POR PROGRAMA) + updatedAt. Es el auto-tagging — cada origen de
 * lead que conozca su programa lo llama. Resiliente (no rompe el guardado del lead).
 */
export async function upsertLeadProgramMembership(
  leadId: string,
  programId: string,
  stageId?: string,
  source?: string,
): Promise<void> {
  if (!leadId || !programId) return;
  const now = new Date().toISOString();
  const sets = ["addedAt = if_not_exists(addedAt, :now)", "updatedAt = :now"];
  const vals: Record<string, unknown> = { ":now": { S: now } };
  const names: Record<string, string> = {};
  if (stageId) {
    sets.push("stageId = :st");
    vals[":st"] = { S: stageId };
  }
  if (source) {
    // "source" es palabra reservada en DynamoDB → alias.
    sets.push("#src = :sr");
    names["#src"] = "source";
    vals[":sr"] = { S: source };
  }
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: LEAD_PROGRAMS_TABLE,
        Key: { programId: { S: programId }, leadId: { S: leadId } },
        UpdateExpression: "SET " + sets.join(", "),
        ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
        ExpressionAttributeValues: vals as never,
      }),
    );
  } catch (err) {
    console.warn("upsertLeadProgramMembership failed", err);
  }
}

/** Mapa código→programId (programas no archivados). Cacheado 5 min. */
async function loadProgramsByCode(): Promise<Map<string, string>> {
  if (programsByCodeCache && Date.now() - programsByCodeCache.at < PROGRAMS_TTL_MS) {
    return programsByCodeCache.map;
  }
  const map = new Map<string, string>();
  try {
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await dynamo.send(
        new ScanCommand({
          TableName: PROGRAMS_TABLE,
          ProjectionExpression: "programId, #c, #s",
          ExpressionAttributeNames: { "#c": "code", "#s": "status" }, // "code"/"status" reservados
          ExclusiveStartKey: lastKey as never,
        }),
      );
      for (const it of res.Items || []) {
        const p = unmarshall(it) as { programId?: string; code?: string; status?: string };
        if (p.programId && p.code && p.status !== "archivado") {
          map.set(p.code.trim().toLowerCase(), p.programId);
        }
      }
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
  } catch {
    /* sin acceso/tabla → mapa vacío (no rompe el guardado del lead) */
  }
  programsByCodeCache = { map, at: Date.now() };
  return map;
}

/**
 * Resuelve un programId desde los atributos del lead: busca una clave tipo
 * `utm_campaign` / columna "programa" cuyo valor sea el CÓDIGO del programa, y
 * lo matchea contra la tabla de programas (R26). Así CSV, web-form y Salesforce
 * auto-taggean a la membership N:N sin pasar el programId explícito.
 */
export async function resolveProgramIdFromAttributes(
  attributes?: Record<string, string>,
): Promise<string | undefined> {
  if (!attributes) return undefined;
  let code: string | undefined;
  for (const [k, v] of Object.entries(attributes)) {
    if (v && PROGRAM_CODE_KEYS.includes(k.trim().toLowerCase())) {
      code = String(v).trim();
      break;
    }
  }
  if (!code) return undefined;
  const map = await loadProgramsByCode();
  return map.get(code.toLowerCase());
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
  // SEC-A1: `tenantId` opcional para estampar el dueño de cada fila. Obligatorio
  // que lo pasen los callers de bulk (create-campaign / edit-campaign-contacts):
  // ellos NO llaman setActiveTenant, así que aquí NO se cae al tenant activo (sería
  // "" o stale). Sin este override las filas quedan sin tenantId (legacy).
  opts: { source?: string; deadlineMs?: number; programId?: string; tenantId?: string } = {},
): Promise<{
  attempted: number;
  created: number;
  updated: number;
  skipped: number;
  dropped: number;
}> {
  const summary = { attempted: 0, created: 0, updated: 0, skipped: 0, dropped: 0 };
  const deadline = Date.now() + Math.max(1000, opts.deadlineMs ?? 20_000);
  const source = opts.source || "Vox Campaña";
  // SEC-A1: tenant a estampar en cada fila. A DIFERENCIA de upsertVoxLead, aquí
  // usamos SOLO el override explícito (opts.tenantId), NO el activo: los únicos
  // callers de bulk (create-campaign / edit-campaign-contacts) NO llaman
  // setActiveTenant, así que getActiveTenantId() daría "" o —peor— un valor STALE
  // de otra invocación en el mismo contenedor caliente (estampar cross-tenant).
  // Sin override → filas sin tenantId (legacy, retrocompat). Ver reporte: esos dos
  // callers deben empezar a pasar opts.tenantId para el aislamiento completo.
  const tenantId = (opts.tenantId || "").trim() || undefined;

  const existing = await scanAll();
  // Map keyeado por teléfono NORMALIZADO → un contacto E.164 nuevo matchea una
  // fila legacy en otro formato (evita duplicar al recargar una campaña).
  const byPhone = new Map<string, Lead>();
  for (const l of existing) {
    const k = normalizePhone(l.phone)?.e164;
    if (k) byPhone.set(k, l);
  }

  const now = new Date().toISOString();
  const items: Lead[] = [];
  const seen = new Set<string>();
  for (const c of contacts) {
    const phone = (c.phone || "").trim();
    const key = normalizePhone(phone)?.e164 || phone;
    if (!/^\+\d{8,15}$/.test(phone) || seen.has(key)) {
      summary.skipped++;
      continue;
    }
    seen.add(key);
    const prev = byPhone.get(key) || null;
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
      // SEC-A1: dueño de la fila; preserva el previo si ahora no hay tenant resuelto.
      tenantId: tenantId ?? prev?.tenantId,
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
        .send(
          new PutItemCommand({
            TableName: LEADS_TABLE,
            Item: marshall(it, { removeUndefinedValues: true }),
          }),
        )
        .catch(() => {});
      // Auto-tag al programa (Pilar 1): programId de la campaña, o resuelto por
      // utm_campaign / columna "programa" del CSV (R26).
      const pid = opts.programId || (await resolveProgramIdFromAttributes(it.attributes));
      if (pid) {
        await upsertLeadProgramMembership(it.leadId, pid, it.stageId, it.source).catch(() => {});
      }
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
      }),
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
      { profiles: activeProfiles, domainName: activeProfilesDomain },
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
  opts: { origin?: "vox" | "salesforce"; pushToSf?: boolean; sfExtra?: SfPushExtra } = {},
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
    // 1b. Membership de programa (Pilar 1): auto-tag por programId explícito o
    // resuelto desde utm_campaign / columna "programa" del origen (R26).
    const programId = lead.programId || (await resolveProgramIdFromAttributes(lead.attributes));
    if (programId) {
      await upsertLeadProgramMembership(
        r.lead.leadId,
        programId,
        lead.stageId ?? r.lead.stageId,
        lead.source,
      );
    }
  }

  // 2. Customer Profile (Cliente 360°).
  await upsertProfile(lead);
  result.profile = (lead.phone || "").trim() ? "ok" : "skipped";

  // 3. Salesforce (salvo que el cambio venga de SF).
  if (pushToSf) {
    try {
      const sf = await pushLeadToSalesforce(
        {
          ...lead,
          sfLeadId: lead.sfLeadId ?? stored?.sfLeadId,
          // Rollup R4 (F5.1): usar el history persistido (trae el golpe recién sumado).
          history: lead.history ?? stored?.history,
        },
        opts.sfExtra,
        stored?.leadId, // External Id (VoxLeadId__c) → dedup determinístico en SF
      );
      result.sf = sf ? { leadId: sf.leadId, action: sf.action, taskId: sf.taskId } : null;
      // Guardar el sfLeadId recién creado para futuros updates idempotentes. SOLO
      // si es un Lead (kind "lead"): un Contact id guardado como sfLeadId rompería
      // el próximo update (updateSObject("Lead", contactId) → 404).
      if (sf && sf.kind === "lead" && stored && !stored.sfLeadId)
        await setSfLeadId(stored.leadId, sf.leadId);
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
  type:
    | "gestion"
    | "interaccion"
    | "stage_change"
    | "update"
    | "note"
    | "whatsapp_out"
    | "whatsapp_in"
    | "email_out"
    | "email_opened" // Fase 4 · F4.4 — apertura de email (pixel)
    | "email_clicked" // Fase 4 · F4.4 — click en link de email
    | "call"; // tipos de toque (Pilar 2)
  channel?: string; // "Llamada" | "Correo" | "WhatsApp" | …
  /** Dirección del toque (Pilar 2). */
  direction?: "out" | "in";
  /** Programa del toque (Pilar 2 / Pilar 1). */
  programId?: string;
  /** Costo del toque, si aplica (Pilar 2). */
  cost?: number;
  /** Plantilla HSM enviada (Pilar 2). */
  templateName?: string;
  /** Resultado del toque: delivered|read|failed|answered|no_answer (Pilar 2). */
  outcome?: string;
  /** URL del link clickeado (Fase 4 · F4.4 email_clicked). */
  url?: string;
  /** Token de tracking que identificó el evento (Fase 4 · F4.4). */
  trackingToken?: string;
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
        UpdateExpression:
          "SET history = list_append(if_not_exists(history, :empty), :new), updatedAt = :now",
        ExpressionAttributeValues: {
          ":empty": { L: [] },
          ":new": { L: [{ M: marshall(ev, { removeUndefinedValues: true }) }] },
          ":now": { S: ev.ts || new Date().toISOString() },
        },
      }),
    );
  } catch (err) {
    console.warn("appendLeadHistory failed", err);
    return; // si no se pudo anexar el evento, no recomputamos sobre datos viejos
  }
  // Fase 2 — recompute de score/grade. appendLeadHistory es el ÚNICO embudo por
  // el que pasan todos los golpes de todas las fuentes → es el punto natural para
  // mantener el score fresco. Solo ante un golpe real o un cambio de etapa (no
  // ante note/update). Best-effort: si falla, el evento ya quedó guardado.
  if (isGolpe(ev) || ev.type === "stage_change") {
    await recomputeLeadScore(leadId).catch((err) =>
      console.warn("recomputeLeadScore failed (best-effort):", err),
    );
  }
}

/**
 * Fase 2 · F2.1+F2.2 — recomputa `score` (comportamiento) + `grade` (fit) del
 * lead y los persiste. Lee el lead fresco (incluye el golpe recién anexado),
 * resume los golpes (ledger Pilar 2) y aplica las reglas del tenant (default si
 * no hay). NO dispara eventos (derivado → evita loops). El dialer luego prioriza
 * por `score` (F2.4). El trigger `lead_score_changed` para journeys llega en Fase 3.
 */
async function recomputeLeadScore(leadId: string): Promise<void> {
  const got = await dynamo.send(
    new GetItemCommand({ TableName: LEADS_TABLE, Key: { leadId: { S: leadId } } }),
  );
  if (!got.Item) return;
  const lead = unmarshall(got.Item) as Lead;
  const summary = await summarizeGolpes(lead.history as LeadHistoryEvent[], lead.stageId);
  const rules = await getScoringRules(dynamo, getActiveTenantId());
  const { score, inputs } = computeScore(
    {
      golpesTotal: summary.total,
      converted: summary.converted,
      lastTouchAt: summary.lastTouchAt,
      source: lead.source,
    },
    rules,
  );
  const grade = computeGrade(
    {
      source: lead.source,
      hasEmail: !!lead.email,
      hasCompany: !!lead.company,
      hasValue: !!(lead.montoEstimado && lead.montoEstimado > 0),
      attributes: lead.attributes,
    },
    rules,
  );
  await dynamo.send(
    new UpdateItemCommand({
      TableName: LEADS_TABLE,
      Key: { leadId: { S: leadId } },
      UpdateExpression: "SET score = :s, grade = :g, scoreInputs = :i, scoreComputedAt = :t",
      ExpressionAttributeValues: marshall(
        { ":s": score, ":g": grade, ":i": inputs, ":t": new Date().toISOString() },
        { removeUndefinedValues: true },
      ),
    }),
  );
}

/** Busca un lead por teléfono (tolerante a formato). null si no existe. */
export async function getLeadByPhone(phone: string): Promise<Lead | null> {
  const p = (phone || "").trim();
  if (!p) return null;
  const all = await scanAll();
  return all.find((l) => samePhone(l.phone, p)) || null;
}

/**
 * Fase 2 · F2.4 — mapa teléfono→{score,grade} para una lista de números (UN solo
 * scan). Lo usa create-campaign para estampar el score del lead en el contacto de
 * la campaña, y así el dialer prioriza por score sin lookups en el hot path. Solo
 * incluye los que tienen score. Devuelve keyed por el string de teléfono de entrada.
 */
export async function getLeadScoresByPhones(
  phones: string[],
): Promise<Map<string, { score?: number; grade?: string }>> {
  const out = new Map<string, { score?: number; grade?: string }>();
  if (!phones.length) return out;
  const all = await scanAll();
  const byDigits = new Map<string, Lead>();
  for (const l of all) {
    const d = normalizePhone(l.phone)?.digits;
    if (d) byDigits.set(d, l);
  }
  for (const p of phones) {
    const d = normalizePhone(p)?.digits;
    const l = d ? byDigits.get(d) : undefined;
    if (l && (l.score != null || l.grade)) out.set(p, { score: l.score, grade: l.grade });
  }
  return out;
}

/** Historial de un lead por teléfono (para el panel del detalle en Vox). */
export async function getLeadHistoryByPhone(phone: string): Promise<LeadHistoryEvent[]> {
  const lead = await getLeadByPhone(phone);
  return Array.isArray(lead?.history) ? (lead!.history as LeadHistoryEvent[]) : [];
}

/** stageId del embudo → label legible (para describir el evento de cambio). */
export async function stageIdToLabel(stageId?: string): Promise<string | undefined> {
  if (!stageId) return undefined;
  const stages = await loadDefaultStages();
  return stages.find((x) => x.id === stageId)?.label || undefined;
}

// ───────────────────────── Golpes / atribución (Pilar 2) ────────────────────
const GOLPE_TYPES = new Set([
  "gestion",
  "interaccion",
  "whatsapp_out",
  "whatsapp_in",
  "email_out",
  "email_opened", // Fase 4 · F4.4 — abrir un email es una señal de intención (golpe)
  "email_clicked",
  "call",
]);

/** ¿El evento del historial cuenta como "golpe" (toque real con el lead)?
 *  NO cuentan stage_change/update/note (cambios de estado/datos, no toques). */
export function isGolpe(ev: { type?: string }): boolean {
  return !!ev.type && GOLPE_TYPES.has(ev.type);
}

export interface GolpesSummary {
  total: number;
  byChannel: Record<string, number>;
  firstTouchAt?: string;
  lastTouchAt?: string;
  converted: boolean;
  touchesToClose?: number;
  daysToClose?: number;
}

/** Resume los golpes de un lead desde su history + etapa actual: total, por
 *  canal, primer/último toque, y (si convirtió a una etapa "cierre") golpes y
 *  días al cierre. Es la base de "cuántos golpes por conversión" (R4). */
export async function summarizeGolpes(
  history: LeadHistoryEvent[] | undefined,
  currentStageId?: string,
): Promise<GolpesSummary> {
  const all = Array.isArray(history) ? history : [];
  const golpes = all.filter(isGolpe);
  const byChannel: Record<string, number> = {};
  let firstTouchAt: string | undefined;
  let lastTouchAt: string | undefined;
  for (const e of golpes) {
    const ch = e.channel || "Otro";
    byChannel[ch] = (byChannel[ch] || 0) + 1;
    if (e.ts && (!firstTouchAt || e.ts < firstTouchAt)) firstTouchAt = e.ts;
    if (e.ts && (!lastTouchAt || e.ts > lastTouchAt)) lastTouchAt = e.ts;
  }

  // Conversión = llegó a una etapa con valoracion "cierre".
  const stages = await loadDefaultStages();
  const cierreIds = new Set(stages.filter((s) => s.valoracion === "cierre").map((s) => s.id));
  let closeAt: string | undefined;
  for (const h of all) {
    if (h.type === "stage_change" && h.stageId && cierreIds.has(h.stageId) && h.ts) {
      if (!closeAt || h.ts < closeAt) closeAt = h.ts;
    }
  }
  const converted = !!closeAt || (!!currentStageId && cierreIds.has(currentStageId));

  let touchesToClose: number | undefined;
  let daysToClose: number | undefined;
  if (converted) {
    const cutoff = closeAt || lastTouchAt;
    touchesToClose = cutoff ? golpes.filter((e) => e.ts && e.ts <= cutoff).length : golpes.length;
    if (firstTouchAt && cutoff) {
      daysToClose = Math.max(
        0,
        Math.round((new Date(cutoff).getTime() - new Date(firstTouchAt).getTime()) / 86_400_000),
      );
    }
  }

  return {
    total: golpes.length,
    byChannel,
    firstTouchAt,
    lastTouchAt,
    converted,
    touchesToClose,
    daysToClose,
  };
}
