import type { Handler } from "aws-lambda";
import {
  soql,
  soqlAll,
  soqlEscape,
  sfFetch,
  getToken,
  setActiveTenant,
  getActiveTenantId,
  describeSObject,
  updateSObject,
  insertSObject,
} from "../_shared/salesforceClient";
import { resolveTenantId } from "../_shared/cognitoAuth";
import {
  propagateLead,
  pushLeadToSalesforce,
  sfStatusToStage,
  channelToSf,
  appendLeadHistory,
  getLeadHistoryByPhone,
  stageIdToLabel,
  setActiveDynamo,
  setActiveProfiles,
} from "../_shared/leadSync";
import { sfPhoneCandidates } from "../_shared/phone";
import {
  resolveDynamo,
  resolveCustomerProfiles,
  getTenantConnect,
  isTenantDataPlaneEnabled,
} from "../_shared/tenantConnect";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { CustomerProfilesClient } from "@aws-sdk/client-customer-profiles";

// BYO Data Plane (#46): leadSync escribe a DynamoDB. Si el tenant lo activó,
// las escrituras van a SU tabla (`connectview-leads` en su cuenta).
const legacyDynamo = new DynamoDBClient({});
// CP legacy (Novasys) — solo para el tenant fundador; resolveCustomerProfiles
// bloquea a un tenant real sin CP (jamás escribe el perfil en Novasys).
const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 2 });
const LEGACY_PROFILES_DOMAIN = process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";
const LEADS_TABLE = process.env.LEADS_TABLE || "connectview-leads";

/**
 * salesforce-sync — Vox → Salesforce (outbound). Lo llama el agent desktop
 * justo después de guardar un wrap-up. Ahora delega en el hub propagateLead():
 * el lead se escribe en las TRES superficies (tabla de Leads, Customer Profile
 * y Salesforce: Lead + Status + un Task con la gestión). Antes solo tocaba SF.
 *
 * Body (de WrapUpView):
 *   { customerPhone, customerName?, email?, company?,
 *     leadStatus?,                     // SF Lead Status (salesforceValue)
 *     stageLabel, subStageLabel, valoracion,
 *     notes?, summary?, agentUsername?, contactId? }
 */
const CORS: Record<string, string> = { "Content-Type": "application/json" };

interface SyncBody {
  customerPhone?: string;
  customerName?: string;
  email?: string;
  company?: string;
  leadStatus?: string;
  stageId?: string;
  stageLabel?: string;
  subStageLabel?: string;
  valoracion?: string;
  notes?: string;
  summary?: string;
  agentUsername?: string;
  contactId?: string;
  /** Canal del contacto (VOICE/CHAT/EMAIL/TASK) — define cómo se registra la actividad. */
  channel?: string;
  /** true ⇒ el agente cerró el contacto SIN tipificar → registrar interacción "sin tipificar". */
  untyped?: boolean;
  durationSeconds?: number;
  mode?: string;
  /** mode:"lead" — buscar por teléfono (alias de customerPhone) o por Id de SF. */
  phone?: string;
  sfLeadId?: string;
  /** mode:"updateLead" — { <SfApiName>: value } a escribir en el Lead de SF. */
  fields?: Record<string, unknown>;
  /** mode:"pullFromSf" — ventana (días) hacia atrás por LastModifiedDate. Default 7. */
  sinceDays?: number;
  /** mode:"pullFromSf"/"pushAll" — tope de registros por tanda. */
  limit?: number;
  /** mode:"importAll" — cursor de SF (nextRecordsUrl de la tanda previa). */
  startUrl?: string;
  /** mode:"importAll" — tamaño de página SOQL por tanda (200..2000). */
  batchSize?: number;
  /** mode:"pushAll" — cursor de DynamoDB (LastEvaluatedKey de la tanda previa). */
  startKey?: Record<string, unknown>;
  /** mode:"createCampaigns" — Campaigns (programas) a crear en SF, cada una con N leads. */
  campaigns?: { name: string; leadCount?: number }[];
  /** mode:"campaignMembers" — Id de la Campaign de la que traer sus leads. */
  campaignId?: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * PARIDAD TOTAL del detalle de Lead (Pilar 10 / detalle de lead en ARIA)
 *
 * `describeSObject` (de _shared) solo devuelve campos ESCRIBIBLES (createable ||
 * updateable) — sirve para el mapeo, no para leer el Lead completo. Para paridad
 * necesitamos TODOS los campos consultables (incluidos read-only: CreatedDate,
 * IsConverted, formulas…). Por eso aquí hacemos un describe "crudo" propio, con
 * cache de módulo (TTL 5 min como la taxonomía), sin tocar _shared → no hay que
 * re-desplegar los 9 Lambdas que bundlean salesforceClient.ts.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Un campo del describe crudo del Lead: lo mínimo para armar SELECT + allFields. */
interface LeadFieldMeta {
  name: string;
  label: string;
  type: string;
  custom: boolean;
  updateable: boolean;
  /** false ⇒ no se puede poner en un SELECT (compound: address/location). */
  queryable: boolean;
}

interface LeadDescribeCache {
  fields: LeadFieldMeta[];
  byName: Map<string, LeadFieldMeta>;
  fetchedAt: number;
}

// Cache POR TENANT (el describe del Lead varía por org): key = tenantId crudo.
const leadDescribeCache = new Map<string, LeadDescribeCache>();
const DESCRIBE_TTL_MS = 5 * 60 * 1000;

// Campos compound de SF que NO se pueden poner en un SELECT plano (rompen SOQL).
// Sus sub-campos (Street/City/…, Latitude/Longitude) sí son consultables y ya
// vienen aparte, así que basta con excluir el contenedor.
const COMPOUND_FIELD_TYPES = new Set(["address", "location"]);

// Ruido de sistema que NO queremos mostrar en allFields (aunque tengan valor).
const NOISE_FIELDS = new Set([
  "Id",
  "IsDeleted",
  "SystemModstamp",
  "LastReferencedDate",
  "LastViewedDate",
  "attributes",
]);

// Orden humano de los campos "core" del Lead (lo demás va después).
const CORE_ORDER = [
  "Name",
  "FirstName",
  "LastName",
  "Company",
  "Title",
  "Email",
  "Phone",
  "MobilePhone",
  "Status",
  "LeadSource",
  "Rating",
  "Industry",
  "Website",
  "Street",
  "City",
  "State",
  "Country",
  "PostalCode",
  "Description",
];
const CORE_RANK = new Map(CORE_ORDER.map((n, i) => [n, i]));

/** Describe crudo del Lead (TODOS los campos, incl. read-only), cacheado por
 *  tenant. Se usa para el SELECT dinámico y para el metadata de allFields. */
async function describeLeadFull(): Promise<LeadDescribeCache> {
  const key = getActiveTenantId() || "__master__";
  const hit = leadDescribeCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < DESCRIBE_TTL_MS) return hit;

  const res = await sfFetch("GET", "sobjects/Lead/describe/");
  if (!res.ok) {
    throw new Error(`Describe Lead failed: ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (res.body as { fields?: any[] }).fields || [];
  const fields: LeadFieldMeta[] = raw
    .filter((f) => f && f.name)
    .map((f) => ({
      name: String(f.name),
      label: String(f.label || f.name),
      type: String(f.type || "string"),
      custom: !!f.custom,
      updateable: !!f.updateable,
      // Excluir compound del SELECT; el resto (incl. formula/read-only) es OK.
      queryable: !COMPOUND_FIELD_TYPES.has(String(f.type || "")),
    }));
  const byName = new Map(fields.map((f) => [f.name, f]));
  const entry: LeadDescribeCache = { fields, byName, fetchedAt: Date.now() };
  leadDescribeCache.set(key, entry);
  return entry;
}

/** Formatea un valor crudo de SF a string legible (fechas, bool, números). */
function formatFieldValue(type: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (type === "date" && typeof value === "string") {
    // SF manda YYYY-MM-DD → dejamos tal cual (ya es legible y estable).
    return value;
  }
  if (type === "datetime" && typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString().replace("T", " ").slice(0, 16);
  }
  if (
    (type === "double" || type === "currency" || type === "percent") &&
    typeof value === "number"
  ) {
    // Miles con separador, sin forzar decimales artificiales.
    return value.toLocaleString("es-PE");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export interface LeadFieldOut {
  name: string;
  label: string;
  value: string;
  type: string;
  updateable: boolean;
}

/** Construye el array `allFields` a partir del registro del Lead + el describe.
 *  Solo campos con valor no vacío, sin ruido de sistema, ordenados core→std→__c. */
function buildAllFields(
  lead: Record<string, unknown>,
  byName: Map<string, LeadFieldMeta>,
): LeadFieldOut[] {
  const out: LeadFieldOut[] = [];
  for (const [name, rawVal] of Object.entries(lead)) {
    if (NOISE_FIELDS.has(name)) continue;
    if (rawVal === null || rawVal === undefined || rawVal === "") continue;
    const meta = byName.get(name);
    const type = meta?.type || "string";
    const value = formatFieldValue(type, rawVal);
    if (value === "") continue;
    out.push({
      name,
      label: meta?.label || name,
      value,
      type,
      updateable: meta?.updateable ?? false,
    });
  }
  // Orden: core (orden humano) → resto estándar (alfabético por label) → __c.
  return out.sort((a, b) => {
    const ra = CORE_RANK.has(a.name) ? CORE_RANK.get(a.name)! : Infinity;
    const rb = CORE_RANK.has(b.name) ? CORE_RANK.get(b.name)! : Infinity;
    if (ra !== rb) return ra - rb;
    const ca = a.name.endsWith("__c") ? 1 : 0;
    const cb = b.name.endsWith("__c") ? 1 : 0;
    if (ca !== cb) return ca - cb;
    return a.label.localeCompare(b.label);
  });
}

/** Lista de campos para el SELECT del Lead. Prioriza estándar + TODOS los __c;
 *  si el total supera un tope conservador (SOQL/URL), recorta estándar no-core
 *  pero NUNCA los custom ni los core. */
function buildSelectFields(fields: LeadFieldMeta[]): string[] {
  const queryable = fields.filter((f) => f.queryable);
  // Garantizamos Id + los core aunque el describe los reordene.
  const names = queryable.map((f) => f.name);
  const MAX_FIELDS = 380; // Lead real ~100-250 campos; margen holgado para el SELECT.
  if (names.length <= MAX_FIELDS) return Array.from(new Set(["Id", ...names]));
  // Demasiados: core + custom + relleno de estándar hasta el tope.
  const core = queryable.filter((f) => CORE_RANK.has(f.name)).map((f) => f.name);
  const custom = queryable.filter((f) => f.custom).map((f) => f.name);
  const rest = queryable.filter((f) => !CORE_RANK.has(f.name) && !f.custom).map((f) => f.name);
  const picked = new Set<string>(["Id", ...core, ...custom]);
  for (const n of rest) {
    if (picked.size >= MAX_FIELDS) break;
    picked.add(n);
  }
  return Array.from(picked);
}

/* ────────────────────────────────────────────────────────────────────────────
 * PULL inverso (mode:"pullFromSf") — SF → ARIA on-demand.
 *
 * El PUSH (salesforce-inbound-webhook) depende de que el cliente configure un
 * record-triggered Flow en su org. El PULL no: ARIA consulta los Leads
 * modificados en los últimos N días y los abanica por el MISMO hub
 * propagateLead({ origin:"salesforce" }) (anti-loop: NO re-empuja a SF). Es la
 * cara inversa exacta del webhook, en batch y disparada por ARIA.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Row del SELECT de pullFromSf (subset fijo del Lead). */
interface SfLeadRow {
  Id?: string;
  FirstName?: string;
  LastName?: string;
  Phone?: string;
  MobilePhone?: string;
  Email?: string;
  Company?: string;
  Status?: string;
  LeadSource?: string;
}

/** Best-effort E.164 — COPIA EXACTA de la normalización del inbound-webhook
 *  (SF guarda teléfonos en cualquier forma; un 9 dígitos pelado se asume PE +51).
 *  Distinta de `normalizePhone` de _shared/phone (que devuelve un objeto): aquí
 *  queremos el mismo string E.164-o-null que produce el webhook, para paridad. */
function normalizeSfPhone(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\+\d{8,15}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.length === 9) return `+51${digits}`; // PE mobile
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** Lee un número de queryStringParameters (GET ?sinceDays=…&limit=…). null si ausente. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function qsNum(event: any, key: string): number | null {
  const v = event?.queryStringParameters?.[key];
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Procesa UN Lead de SF por el hub propagateLead (origin="salesforce", anti-loop).
 *  Idéntico al inbound-webhook: mismo shape de LeadInput, misma huella en attributes,
 *  mismo appendLeadHistory "stage_change" cuando hubo cambio real. Devuelve la
 *  acción para los contadores. */
async function pullOneLead(
  row: SfLeadRow,
): Promise<"created" | "updated" | "unchanged" | "skipped"> {
  const phone = normalizeSfPhone(row.Phone) || normalizeSfPhone(row.MobilePhone);
  if (!phone) return "skipped"; // sin teléfono usable no hay clave de Customer Profile

  const name = [row.FirstName, row.LastName].filter(Boolean).join(" ").trim();
  const status = row.Status;
  const source = row.LeadSource;

  // Misma huella de SF que el webhook.
  const attributes: Record<string, string> = {};
  if (status) attributes.sf_lead_status = status;
  if (source) attributes.sf_lead_source = source;

  const stageId = await sfStatusToStage(status);
  const result = await propagateLead(
    {
      phone,
      email: row.Email,
      name,
      // Ignorar la empresa default basura que ARIA pone al crear el Lead en SF.
      company: row.Company && row.Company !== "Lead sin empresa" ? row.Company : undefined,
      stageId,
      sfLeadId: row.Id,
      source: source || "Salesforce",
      attributes,
    },
    { origin: "salesforce" }, // no re-empuja a SF (anti-loop) — igual que el webhook
  );

  // Registrar el cambio venido de SF en el historial del lead (si hubo cambio real).
  if (result.leadId && result.voxAction !== "unchanged") {
    await appendLeadHistory(result.leadId, {
      ts: new Date().toISOString(),
      type: "stage_change",
      channel: "Salesforce",
      stageId,
      stageLabel: await stageIdToLabel(stageId),
      summary: `Actualización desde Salesforce${status ? ` · ${status}` : ""} (pull)`,
    });
  }
  return result.voxAction || "unchanged";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  // Setea el tenant activo a partir del JWT del agente que cerró la gestión.
  // Todos los helpers (getToken / soql / propagateLead / appendLeadHistory)
  // pegan a SU Salesforce. Si el tenant no conectó SF, salesforceClient cae
  // al JWT bearer legacy (single-tenant Novasys) — el comportamiento actual
  // queda intacto para los Lambdas y para el path de transición.
  const tenantId = await resolveTenantId(event?.headers);
  setActiveTenant(tenantId);
  // Pilar 10 — el mapeo de campos ARIA→SF se auto-carga dentro de leadSync
  // (pushLeadToSalesforce) desde connectview-connections, así que NO hay que
  // cablearlo aquí: aplica a este path y a todos los callers de propagateLead.
  // BYO Data Plane (#46): DynamoDB del tenant para leadSync (propagateLead,
  // appendLeadHistory, …). Fallback a Vox pooled si no aplicó el template.
  {
    const r = await resolveDynamo(event?.headers, legacyDynamo);
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
  let body: SyncBody;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "bad json" }) };
  }

  // Read-only connectivity check (no writes) — verifies OAuth + SOQL end-to-end.
  // Trigger with ?mode=ping or {"mode":"ping"}.
  if (event?.queryStringParameters?.mode === "ping" || body.mode === "ping") {
    try {
      const tok = await getToken();
      const rows = await soql("SELECT Id, Name, InstanceName FROM Organization LIMIT 1");
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          ok: true,
          mode: "ping",
          instanceUrl: tok.instanceUrl,
          org: rows[0] ?? null,
        }),
      };
    } catch (err) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          ok: false,
          mode: "ping",
          error: err instanceof Error ? err.message : String(err),
        }),
      };
    }
  }

  // ── SF Campaigns (= "programas" agrupadores de campañas). Objetos ESTÁNDAR de SF
  //    (Campaign + CampaignMember): NO tocan el esquema. createCampaigns crea N
  //    Campaigns con leads asociados; listCampaigns lista; campaignMembers trae los
  //    leads de una (para importarla a ARIA como programa + su membresía). ──────────
  if (body.mode === "createCampaigns") {
    try {
      const specs = (body.campaigns || []).filter((c) => c && c.name);
      if (specs.length === 0) throw new Error("campaigns requeridos");
      const totalNeeded = specs.reduce((n, s) => n + Math.max(1, s.leadCount ?? 3), 0);
      const leads = await soql(
        `SELECT Id FROM Lead WHERE IsConverted = false ORDER BY CreatedDate DESC LIMIT ${Math.min(200, totalNeeded)}`,
      );
      let cursor = 0;
      const out: { id: string; name: string; members: number }[] = [];
      for (const s of specs) {
        const campaignId = await insertSObject("Campaign", { Name: s.name, IsActive: true });
        const n = Math.max(1, s.leadCount ?? 3);
        let members = 0;
        for (let i = 0; i < n && cursor < leads.length; i++, cursor++) {
          try {
            await insertSObject("CampaignMember", {
              CampaignId: campaignId,
              LeadId: leads[cursor].Id as string,
            });
            members++;
          } catch {
            /* ya es miembro / sin permiso → sigue */
          }
        }
        out.push({ id: campaignId, name: s.name, members });
      }
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ ok: true, mode: "createCampaigns", campaigns: out }),
      };
    } catch (err) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      };
    }
  }

  if (event?.queryStringParameters?.mode === "listCampaigns" || body.mode === "listCampaigns") {
    try {
      const rows = await soql(
        "SELECT Id, Name, IsActive, NumberOfLeads, NumberOfContacts FROM Campaign ORDER BY CreatedDate DESC LIMIT 100",
      );
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ ok: true, mode: "listCampaigns", campaigns: rows }),
      };
    } catch (err) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      };
    }
  }

  if (event?.queryStringParameters?.mode === "campaignMembers" || body.mode === "campaignMembers") {
    const cid = String(event?.queryStringParameters?.campaignId || body.campaignId || "").replace(
      /[^A-Za-z0-9]/g,
      "",
    );
    if (!cid)
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: "campaignId requerido" }),
      };
    try {
      const rows = await soql(
        `SELECT LeadId, Lead.Name, Lead.Phone, Lead.Email, Lead.Company FROM CampaignMember WHERE CampaignId = '${cid}' AND LeadId != null LIMIT 2000`,
      );
      const members = rows.map((r) => {
        const l = (r.Lead as Record<string, unknown>) || {};
        return {
          leadId: r.LeadId,
          name: l.Name,
          phone: l.Phone,
          email: l.Email,
          company: l.Company,
        };
      });
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ ok: true, mode: "campaignMembers", members }),
      };
    } catch (err) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      };
    }
  }

  // ── PULL mode (SF → ARIA on-demand): trae los Leads modificados en los
  //    últimos `sinceDays` días y los abanica por propagateLead(origin:
  //    "salesforce") — la cara inversa del inbound-webhook, en batch. NO
  //    depende de un Flow en la org del cliente. POST {mode:"pullFromSf",
  //    sinceDays?, limit?}. ────────────────────────────────────────────────────
  if (event?.queryStringParameters?.mode === "pullFromSf" || body.mode === "pullFromSf") {
    // Ventana y tope, saneados (sinceDays 1..365 def 7; limit 1..500 def 200).
    const sinceDaysRaw = Number(body.sinceDays ?? qsNum(event, "sinceDays") ?? 7);
    const limitRaw = Number(body.limit ?? qsNum(event, "limit") ?? 200);
    const sinceDays = Number.isFinite(sinceDaysRaw)
      ? Math.min(365, Math.max(1, Math.floor(sinceDaysRaw)))
      : 7;
    const limit = Number.isFinite(limitRaw)
      ? Math.min(500, Math.max(1, Math.floor(limitRaw))) // tope duro 500
      : 200;

    // Data plane del tenant (mismo criterio que el inbound-webhook): un tenant
    // real SIN BYO Data Plane no tiene dónde escribir aislado → 403 en vez de caer
    // al pooled de Novasys. `tenantId` ya se resolvió del JWT arriba y
    // setActiveTenant(tenantId) ya apuntó a SU org SF (o al master del fundador).
    const tc = await getTenantConnect(tenantId);
    const dpOn = await isTenantDataPlaneEnabled(tenantId);
    if (!tc || !dpOn) {
      return {
        statusCode: 403,
        headers: CORS,
        body: JSON.stringify({
          error: "El tenant no tiene Data Plane (BYO) habilitado para sincronizar leads",
        }),
      };
    }
    // BYO Data Plane: su DynamoDB (assumed creds → su cuenta). Sobreescribe el
    // default que puso resolveDynamo arriba, forzando tenant-scoped explícito.
    setActiveDynamo(tc.dynamo);
    // Customer Profiles fail-closed del tenant (por tenantId explícito, no headers).
    {
      const cp = await resolveCustomerProfiles(
        undefined,
        legacyProfiles,
        LEGACY_PROFILES_DOMAIN,
        tenantId,
      );
      setActiveProfiles(cp.client, cp.domainName);
    }

    // SOQL con literal de fecha SOQL (LAST_N_DAYS:N), NO un timestamp.
    const pullSoql =
      `SELECT Id, FirstName, LastName, Phone, MobilePhone, Email, Company, Status, LeadSource ` +
      `FROM Lead WHERE LastModifiedDate >= LAST_N_DAYS:${sinceDays} ` +
      `ORDER BY LastModifiedDate DESC LIMIT ${limit}`;

    try {
      const rows = (await soql(pullSoql)) as SfLeadRow[];
      const counts = { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0 };

      // Concurrencia acotada (~5 en paralelo) para no saturar SF/DynamoDB. Un lead
      // que falla NO aborta el resto: se cuenta en `errors` y seguimos.
      const CONCURRENCY = 5;
      let cursor = 0;
      async function worker() {
        while (cursor < rows.length) {
          const row = rows[cursor++];
          try {
            const action = await pullOneLead(row);
            counts[action]++;
          } catch (err) {
            counts.errors++;
            console.error("pullFromSf: lead falló", row?.Id, err);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));

      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          ok: true,
          mode: "pullFromSf",
          sinceDays,
          limit,
          scanned: rows.length,
          ...counts,
        }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Tenant real sin SF conectado → "no configurado", no un 500.
      if (msg.startsWith("SF_NOT_CONNECTED")) {
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ ok: false, mode: "pullFromSf", sfNotConnected: true }),
        };
      }
      console.error("salesforce-sync pullFromSf error", err);
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ ok: false, mode: "pullFromSf", error: "pull failed", message: msg }),
      };
    }
  }

  // ── IMPORT ALL (SF → ARIA "desde 0"): trae TODOS los Leads por tandas
  //    (paginación cursor nextRecordsUrl). POST {mode:"importAll", startUrl?, batchSize?}.
  if (event?.queryStringParameters?.mode === "importAll" || body.mode === "importAll") {
    const batchSize = Math.min(2000, Math.max(200, Math.floor(Number(body.batchSize) || 500)));
    const startUrl = typeof body.startUrl === "string" && body.startUrl ? body.startUrl : undefined;
    const tc = await getTenantConnect(tenantId);
    const dpOn = await isTenantDataPlaneEnabled(tenantId);
    if (!tc || !dpOn) {
      return {
        statusCode: 403,
        headers: CORS,
        body: JSON.stringify({ error: "El tenant no tiene Data Plane (BYO) habilitado" }),
      };
    }
    setActiveDynamo(tc.dynamo);
    {
      const cp = await resolveCustomerProfiles(
        undefined,
        legacyProfiles,
        LEGACY_PROFILES_DOMAIN,
        tenantId,
      );
      setActiveProfiles(cp.client, cp.domainName);
    }
    const importSoql =
      `SELECT Id, FirstName, LastName, Phone, MobilePhone, Email, Company, Status, LeadSource ` +
      `FROM Lead ORDER BY CreatedDate`;
    try {
      const page = await soqlAll(importSoql, { batchSize, startUrl });
      const rows = page.records as SfLeadRow[];
      const counts = { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0 };
      const CONCURRENCY = 5;
      let cursor = 0;
      const worker = async () => {
        while (cursor < rows.length) {
          const row = rows[cursor++];
          try {
            counts[await pullOneLead(row)]++;
          } catch (err) {
            counts.errors++;
            console.error("importAll: lead falló", row?.Id, err);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker()));
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          ok: true,
          mode: "importAll",
          scanned: rows.length,
          ...counts,
          nextUrl: page.nextUrl ?? null,
          done: page.done,
        }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("SF_NOT_CONNECTED")) {
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ ok: false, mode: "importAll", sfNotConnected: true }),
        };
      }
      console.error("importAll error", err);
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          ok: false,
          mode: "importAll",
          error: "import failed",
          message: msg,
        }),
      };
    }
  }

  // ── EXPORT ALL (ARIA → SF "desde 0"): empuja TODOS los leads de ARIA a SF por
  //    tandas (Scan cursor). Reusa pushLeadToSalesforce (dedup determinístico, NO
  //    duplica). POST {mode:"pushAll", startKey?, limit?}.
  if (event?.queryStringParameters?.mode === "pushAll" || body.mode === "pushAll") {
    const limit = Math.min(300, Math.max(20, Math.floor(Number(body.limit) || 100)));
    const tc = await getTenantConnect(tenantId);
    const dpOn = await isTenantDataPlaneEnabled(tenantId);
    if (!tc || !dpOn) {
      return {
        statusCode: 403,
        headers: CORS,
        body: JSON.stringify({ error: "El tenant no tiene Data Plane (BYO) habilitado" }),
      };
    }
    setActiveDynamo(tc.dynamo);
    const startKey = body.startKey && typeof body.startKey === "object" ? body.startKey : undefined;
    try {
      const scan = await tc.dynamo.send(
        new ScanCommand({
          TableName: LEADS_TABLE,
          Limit: limit,
          ExclusiveStartKey: startKey as never,
        }),
      );
      const leads = (scan.Items || []).map((it) => unmarshall(it) as Record<string, unknown>);
      const s = (v: unknown) => (typeof v === "string" && v ? v : undefined);
      const counts = { pushed: 0, skipped: 0, errors: 0 };
      const CONCURRENCY = 4;
      let cursor = 0;
      const worker = async () => {
        while (cursor < leads.length) {
          const l = leads[cursor++];
          const phone = s(l.phone);
          if (!phone) {
            counts.skipped++;
            continue;
          }
          try {
            await pushLeadToSalesforce(
              {
                phone,
                name: s(l.name),
                email: s(l.email),
                stageId: s(l.stageId),
                sfLeadId: s(l.sfLeadId),
                source: s(l.source),
              },
              undefined,
              s(l.leadId),
            );
            counts.pushed++;
          } catch (err) {
            counts.errors++;
            console.error("pushAll: lead falló", l?.leadId, err);
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, leads.length) }, () => worker()),
      );
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          ok: true,
          mode: "pushAll",
          scanned: leads.length,
          ...counts,
          nextKey: scan.LastEvaluatedKey ?? null,
          done: !scan.LastEvaluatedKey,
        }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("SF_NOT_CONNECTED")) {
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ ok: false, mode: "pushAll", sfNotConnected: true }),
        };
      }
      console.error("pushAll error", err);
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ ok: false, mode: "pushAll", error: "export failed", message: msg }),
      };
    }
  }

  // ── DESCRIBE mode (Pilar 10): campos escribibles del Lead de la org del
  //    tenant → alimenta la UI de mapeo schema-aware. Solo lectura.
  //    GET ?mode=describe[&sobject=Lead]. ─────────────────────────────────────
  if (event?.queryStringParameters?.mode === "describe" || body.mode === "describe") {
    const sobject = (event?.queryStringParameters?.sobject || "Lead").replace(/[^A-Za-z0-9_]/g, "");
    try {
      const fields = await describeSObject(sobject || "Lead");
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ ok: true, mode: "describe", sobject: sobject || "Lead", fields }),
      };
    } catch (err) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({
          ok: false,
          mode: "describe",
          error: err instanceof Error ? err.message : String(err),
        }),
      };
    }
  }

  // ── READ mode: detalle del Lead + su actividad en SF (alimenta el panel
  //    "Salesforce" del detalle de lead en Vox). GET ?mode=lead&phone=… o
  //    POST {mode:"lead", phone|sfLeadId}. Solo lectura. ──────────────────────
  const qs = event?.queryStringParameters || {};
  if (qs.mode === "lead" || body.mode === "lead") {
    const phoneQ = (body.customerPhone || body.phone || qs.phone || "").trim();
    const sfId = (body.sfLeadId || qs.sfLeadId || "").trim();
    if (!phoneQ && !sfId) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: "need phone or sfLeadId" }),
      };
    }
    const activitiesSoql = (leadId: string) =>
      `SELECT Id, Subject, Description, Status, ActivityDate, CreatedDate, TaskSubtype FROM Task WHERE WhoId = '${soqlEscape(leadId)}' ORDER BY CreatedDate DESC LIMIT 25`;
    try {
      // Describe (cacheado) + voxHistory + Lead corren en paralelo. El describe
      // alimenta el SELECT dinámico y el metadata de allFields.
      // Match por teléfono tolerante a formato (E.164 + dígitos pelados) → el
      // panel encuentra el Lead aunque SF lo guarde distinto a Vox.
      const phoneClause = sfPhoneCandidates(phoneQ)
        .flatMap((c) => {
          const p = soqlEscape(c);
          return [`Phone = '${p}'`, `MobilePhone = '${p}'`];
        })
        .join(" OR ");
      const where = sfId
        ? `Id = '${soqlEscape(sfId)}'`
        : phoneClause || `Phone = '${soqlEscape(phoneQ)}'`;

      const [describe, voxHistory] = await Promise.all([
        describeLeadFull(),
        phoneQ ? getLeadHistoryByPhone(phoneQ) : Promise.resolve([]),
      ]);

      // SELECT dinámico con TODOS los campos consultables (paridad total con SF).
      const selectFields = buildSelectFields(describe.fields);
      const leadSoql = `SELECT ${selectFields.join(", ")} FROM Lead WHERE ${where} ORDER BY LastModifiedDate DESC LIMIT 1`;

      // ¿Podemos correr Lead + Activities en paralelo? Solo si ya tenemos el Id
      // (vino sfLeadId). Si buscamos por teléfono, primero resolvemos el Lead y
      // luego sus Activities (el WhoId sale del Lead).
      let lead: Record<string, unknown> | undefined;
      let activities: Record<string, unknown>[] = [];
      if (sfId) {
        const [leads, acts] = await Promise.all([soql(leadSoql), soql(activitiesSoql(sfId))]);
        lead = leads[0];
        activities = acts;
      } else {
        const leads = await soql(leadSoql);
        lead = leads[0];
        if (lead?.Id) activities = await soql(activitiesSoql(String(lead.Id)));
      }

      if (!lead) {
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ found: false, voxHistory }),
        };
      }
      const hist = voxHistory.length
        ? voxHistory
        : await getLeadHistoryByPhone(String(lead.Phone || lead.MobilePhone || ""));
      const allFields = buildAllFields(lead, describe.byName);
      const tok = await getToken();
      const lightningUrl = tok.instanceUrl.replace(".my.salesforce.com", ".lightning.force.com");
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          found: true,
          lead,
          allFields,
          activities,
          lightningUrl,
          voxHistory: hist,
        }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Tenant real sin SF conectado → no es un error de lectura, es "no
      // configurado". El panel SF del detalle de lead lo muestra como vacío.
      if (msg.startsWith("SF_NOT_CONNECTED")) {
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ found: false, sfNotConnected: true }),
        };
      }
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: "sf read failed", message: msg }),
      };
    }
  }

  // ── UPDATE mode: editar campos del Lead en SF desde ARIA. Solo se aplican los
  //    campos updateable === true del describe; el resto se ignora (se reporta).
  //    POST {mode:"updateLead", sfLeadId, fields:{ <SfApiName>: value, … }}. ────
  if (qs.mode === "updateLead" || body.mode === "updateLead") {
    const sfId = (body.sfLeadId || qs.sfLeadId || "").trim();
    const fields = body.fields;
    if (!sfId) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: "need sfLeadId" }),
      };
    }
    if (
      !fields ||
      typeof fields !== "object" ||
      Array.isArray(fields) ||
      !Object.keys(fields).length
    ) {
      return {
        statusCode: 400,
        headers: CORS,
        body: JSON.stringify({ error: "need a non-empty fields object" }),
      };
    }
    try {
      const describe = await describeLeadFull();
      const allowed: Record<string, unknown> = {};
      const ignored: string[] = [];
      for (const [name, value] of Object.entries(fields)) {
        const meta = describe.byName.get(name);
        if (meta && meta.updateable) allowed[name] = value;
        else ignored.push(name);
      }
      if (!Object.keys(allowed).length) {
        return {
          statusCode: 400,
          headers: CORS,
          body: JSON.stringify({ error: "no updateable fields in payload", ignored }),
        };
      }
      // PATCH sobjects/Lead/{id} vía el helper existente (retry-on-401 incluido).
      await updateSObject("Lead", sfId, allowed);
      // Invalidar el cache del describe NO hace falta (no cambió el schema); pero
      // el detalle se re-lee con mode:"lead" tras el update, así que el usuario
      // ve los valores nuevos. NOTA: no reflejamos en connectview-leads local
      // (los api-names de SF no mapean 1:1 a los campos de Vox; se resuelve al
      // re-leer desde SF, que es la fuente de verdad del panel).
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify(ignored.length ? { updated: true, ignored } : { updated: true }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("SF_NOT_CONNECTED")) {
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ updated: false, sfNotConnected: true }),
        };
      }
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ updated: false, error: "sf update failed", message: msg }),
      };
    }
  }

  const phone = (body.customerPhone || "").trim();
  const email = (body.email || "").trim();
  if (!phone && !email) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "need customerPhone or email to match a Lead" }),
    };
  }

  try {
    // Canal del contacto → cómo se registra la actividad en SF (Call/Email/Task).
    const ch = channelToSf(body.channel);

    // ── Interacción SIN tipificar (el agente cerró sin tipificar) ──
    // Se registra en el lead de Vox (aparece en Recientes + historial marcada "sin
    // tipificar"). NO va a Salesforce ni cambia estado — solo las gestiones tipificadas.
    if (body.untyped) {
      const result = await propagateLead(
        { phone, email, name: body.customerName, company: body.company, source: "Llamada" },
        { origin: "vox", pushToSf: false },
      );
      if (result.leadId) {
        const s = typeof body.durationSeconds === "number" ? body.durationSeconds : 0;
        const dur = s > 0 ? `${Math.floor(s / 60)}m ${s % 60}s` : "";
        await appendLeadHistory(result.leadId, {
          ts: new Date().toISOString(),
          type: "interaccion",
          channel: ch.label,
          untyped: true,
          contactId: body.contactId,
          summary: dur ? `${ch.label} de ${dur} · sin tipificar` : `${ch.label} · sin tipificar`,
          agent: body.agentUsername,
        });
      }
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ ok: true, untyped: true, ...result }),
      };
    }

    // El Task de SF documenta la gestión: canal + stage › substage + notas/resumen.
    const subjectBits = [body.stageLabel, body.subStageLabel].filter(Boolean);
    const subject = `${ch.emoji} Vox · ${subjectBits.join(" › ") || "Gestión"}`;
    const taskDescription = [
      `Canal: ${ch.label}`,
      body.summary ? `Resumen: ${body.summary}` : "",
      body.notes ? `Notas: ${body.notes}` : "",
      body.valoracion ? `Valoración: ${body.valoracion}` : "",
      body.agentUsername ? `Agente: ${body.agentUsername}` : "",
      body.contactId ? `ContactId: ${body.contactId}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // stageId del embudo: explícito si vino, si no lo derivamos del SF Status.
    const stageId = body.stageId || (await sfStatusToStage(body.leadStatus));

    const result = await propagateLead(
      {
        phone,
        email,
        name: body.customerName,
        company: body.company,
        leadStatus: body.leadStatus || undefined,
        stageId,
        source: "Vox Wrap-up",
      },
      {
        origin: "vox",
        sfExtra: {
          taskSubject: subject,
          taskDescription,
          taskSubtype: ch.subtype,
          // Tipificación ARIA (hoja: substage, o stage) → el push la escribe al campo
          // SF configurado SOLO si el tenant eligió source="aria".
          tipificacionLabel: body.subStageLabel || body.stageLabel || undefined,
        },
      },
    );

    // Registrar el evento en el historial del lead de Vox (contacto + tipificación).
    if (result.leadId) {
      await appendLeadHistory(result.leadId, {
        ts: new Date().toISOString(),
        type: "gestion",
        channel: ch.label,
        contactId: body.contactId,
        stageId,
        stageLabel: body.stageLabel,
        subStageLabel: body.subStageLabel,
        valoracion: body.valoracion,
        summary: body.summary,
        notes: body.notes,
        agent: body.agentUsername,
        sfTaskId: result.sf?.taskId || undefined,
      });
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, ...result }) };
  } catch (err) {
    console.error("salesforce-sync error", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: "sync failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
