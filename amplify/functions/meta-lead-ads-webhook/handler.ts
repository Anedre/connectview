import type { Handler } from "aws-lambda";
import { timingSafeEqual } from "node:crypto";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { CustomerProfilesClient } from "@aws-sdk/client-customer-profiles";
import { getTenantConnect } from "../_shared/tenantConnect";
import { propagateLead, setActiveDynamo, setActiveProfiles } from "../_shared/leadSync";
import { setActiveTenant } from "../_shared/salesforceClient";
import { fireAutomation } from "../_shared/automationHook";
import { normalizePhone } from "../_shared/phone";
import { loadMetaAppSecret, verifyMetaSignature } from "../_shared/metaSignature";

/**
 * meta-lead-ads-webhook — ingesta nativa de Meta Lead Ads (Pilar 5 · R12).
 * Reemplaza Zapier: cuando un lead llena un formulario de Facebook/Instagram,
 * Meta manda un evento `leadgen` acá → leemos el lead por Graph API → lo metemos
 * al hub (`propagateLead`: tabla leads + Customer Profile + Salesforce, con dedup)
 * → `fireAutomation("lead_created")` dispara el WhatsApp de bienvenida (speed-to-lead).
 *
 *   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  → verificación
 *   POST { entry:[{ id:<pageId>, changes:[{ field:"leadgen", value:{ leadgen_id, page_id, form_id } }] }] }
 *
 * El tenant se resuelve por `page_id` (scan de connections por `meta.pageId`); el
 * token Meta sale del secret del tenant (connectview/tenant/{id}/whatsapp).
 * Env: META_LEADGEN_VERIFY_TOKEN (o WHATSAPP_VERIFY_TOKEN), CONNECTIONS_TABLE.
 */
const legacyDynamo = new DynamoDBClient({});
const sm = new SecretsManagerClient({});
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const VERIFY_TOKEN =
  process.env.META_LEADGEN_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || "";
const INTERNAL_SECRET = process.env.VOX_INTERNAL_SECRET || "";
const GRAPH = "https://graph.facebook.com/v20.0";
const cpFailClosed = new CustomerProfilesClient({ maxAttempts: 1 });

const TEXT = (statusCode: number, body: string) => ({
  statusCode,
  headers: { "Content-Type": "text/plain" },
  body,
});

/** Comparación constant-time de secretos (SEC-C4/M4). Chequea longitud antes de
 *  timingSafeEqual (que tira si difieren) y nunca lanza. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Tenant cuyo `meta.pageId` matchea el Page del evento. */
async function findTenantByPageId(pageId: string): Promise<string | null> {
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await legacyDynamo.send(
      new ScanCommand({ TableName: CONNECTIONS_TABLE, ExclusiveStartKey: lastKey as never }),
    );
    for (const it of res.Items || []) {
      const row = unmarshall(it) as { tenantId?: string; configJson?: string };
      try {
        const cfg = JSON.parse(row.configJson || "{}");
        if (cfg.meta?.pageId === pageId) return row.tenantId || null;
      } catch {
        /* config malformada → seguimos */
      }
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return null;
}

/** Token Meta del tenant (secret connectview/tenant/{id}/whatsapp = {token} o plano). */
async function getTenantToken(tenantId: string): Promise<string | null> {
  try {
    const r = await sm.send(
      new GetSecretValueCommand({ SecretId: `connectview/tenant/${tenantId}/whatsapp` }),
    );
    const raw = r.SecretString || "";
    try {
      const j = JSON.parse(raw);
      if (j && typeof j.token === "string") return j.token;
    } catch {
      /* plano */
    }
    return raw.trim() || null;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function graph(path: string, token: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`);
  const j = await r.json();
  if (!r.ok || j?.error) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j;
}

/** field_data del lead de Meta → {phone,name,email,attributes}. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLead(fieldData: any[]): {
  phone?: string;
  name?: string;
  email?: string;
  attributes: Record<string, string>;
} {
  const attributes: Record<string, string> = {};
  let phone: string | undefined,
    name: string | undefined,
    email: string | undefined,
    firstName: string | undefined,
    lastName: string | undefined;
  for (const f of fieldData || []) {
    const k = String(f?.name || "").toLowerCase();
    const v = Array.isArray(f?.values) ? f.values[0] : f?.values;
    if (v == null || v === "") continue;
    if (k.includes("phone") || k === "telefono" || k === "celular" || k === "teléfono")
      phone = String(v);
    else if (k === "email" || k.includes("correo") || k.includes("e-mail")) email = String(v);
    else if (k === "full_name" || k === "name" || k === "nombre" || k === "nombre_completo")
      name = String(v);
    else if (k.includes("first") || k === "nombres") firstName = String(v);
    else if (k.includes("last") || k === "apellidos" || k === "apellido") lastName = String(v);
    else attributes[`meta_${k}`.slice(0, 64)] = String(v).slice(0, 512);
  }
  if (!name && (firstName || lastName)) name = [firstName, lastName].filter(Boolean).join(" ");
  return { phone, name, email, attributes };
}

async function handleLead(pageId: string, leadgenId: string, source: string): Promise<void> {
  const tenantId = await findTenantByPageId(pageId);
  if (!tenantId) {
    console.warn(`leadgen: page ${pageId} no mapeado a ningún tenant (meta.pageId)`);
    return;
  }
  const token = await getTenantToken(tenantId);
  if (!token) {
    console.warn(`leadgen: tenant ${tenantId} sin token Meta`);
    return;
  }

  // Leer el lead por Graph API (leads_retrieval).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lead: any;
  try {
    lead = await graph(
      `${leadgenId}?fields=field_data,form_id,ad_id,campaign_name,platform,created_time`,
      token,
    );
  } catch (e) {
    console.error("leadgen read falló:", e instanceof Error ? e.message : e);
    return;
  }
  const mapped = mapLead(lead.field_data);
  if (!mapped.phone && !mapped.email) {
    console.warn("leadgen sin teléfono ni email — se ignora");
    return;
  }
  const phone = normalizePhone(mapped.phone)?.e164 || mapped.phone || "";
  // Instagram vs Facebook por `platform` si viene.
  const src = lead.platform === "ig" || lead.platform === "instagram" ? "instagram" : source;

  // Contexto del tenant (mismo patrón que web-form/flow webhook).
  setActiveTenant(tenantId);
  try {
    const tc = await getTenantConnect(tenantId);
    setActiveDynamo(tc?.dynamo ?? null);
    if (tc?.customerProfiles)
      setActiveProfiles(tc.customerProfiles, tc.customerProfilesDomain ?? "");
    else setActiveProfiles(cpFailClosed, "");
  } catch {
    setActiveDynamo(null);
    setActiveProfiles(cpFailClosed, "");
  }

  const attributes: Record<string, string> = {
    ...mapped.attributes,
    meta_form_id: String(lead.form_id || ""),
    meta_leadgen_id: String(leadgenId),
  };
  // Auto-tag de programa: el nombre de campaña Meta = código de programa (resolveProgramIdFromAttributes).
  if (lead.campaign_name) attributes.utm_campaign = String(lead.campaign_name);

  try {
    const result = await propagateLead(
      { phone, name: mapped.name, email: mapped.email, source: src, attributes },
      { origin: "vox" },
    );
    // Speed-to-lead: solo en leads nuevos.
    if (result.voxAction === "created") {
      await fireAutomation({
        type: "lead_created",
        tenantId,
        lead: { leadId: result.leadId, phone, name: mapped.name, source: src },
      });
    }
    console.log(
      `leadgen: tenant=${tenantId} phone=${phone} source=${src} lead=${result.leadId || "—"} action=${result.voxAction}`,
    );
  } catch (e) {
    console.error("leadgen propagate falló:", e instanceof Error ? e.message : e);
  }
}

/** Page access token a partir del system-user token (para /{form}/leads). */
async function getPageToken(systemToken: string, pageId: string): Promise<string | null> {
  try {
    const j = await graph(`${pageId}?fields=access_token`, systemToken);
    return j?.access_token || null;
  } catch {
    return null;
  }
}

/**
 * Backfill (Fase C): trae los leads históricos de los formularios del Page y los
 * mete por el hub (dedup). Para la reconciliación del corte de Zapier (doble-
 * ingesta). Gated por x-vox-internal. body: {action:"backfill", tenantId, days?}.
 */
async function backfill(tenantId: string, days: number): Promise<Record<string, number>> {
  const out = { forms: 0, leads: 0, created: 0, updated: 0, skipped: 0 };
  const systemToken = await getTenantToken(tenantId);
  if (!systemToken) return out;
  // page id del tenant
  let pageId = "";
  try {
    const it = await legacyDynamo.send(
      new (await import("@aws-sdk/client-dynamodb")).GetItemCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { tenantId: { S: tenantId } },
      }),
    );
    if (it.Item) {
      const cfg = JSON.parse(unmarshall(it.Item).configJson || "{}");
      pageId = cfg.meta?.pageId || "";
    }
  } catch {
    /* */
  }
  if (!pageId) return out;
  const pageToken = await getPageToken(systemToken, pageId);
  if (!pageToken) return out;

  // contexto del tenant (una vez)
  setActiveTenant(tenantId);
  try {
    const tc = await getTenantConnect(tenantId);
    setActiveDynamo(tc?.dynamo ?? null);
    if (tc?.customerProfiles)
      setActiveProfiles(tc.customerProfiles, tc.customerProfilesDomain ?? "");
    else setActiveProfiles(cpFailClosed, "");
  } catch {
    setActiveDynamo(null);
    setActiveProfiles(cpFailClosed, "");
  }

  const sinceMs = Date.now() - days * 86400000;
  let formsAfter: string | undefined;
  do {
    const fres = await graph(
      `${pageId}/leadgen_forms?fields=id&limit=50${formsAfter ? `&after=${formsAfter}` : ""}`,
      pageToken,
    );
    for (const f of fres.data || []) {
      out.forms++;
      let leadsAfter: string | undefined;
      do {
        const lres = await graph(
          `${f.id}/leads?fields=field_data,created_time,platform&limit=100${leadsAfter ? `&after=${leadsAfter}` : ""}`,
          pageToken,
        );
        for (const lead of lres.data || []) {
          if (lead.created_time && new Date(lead.created_time).getTime() < sinceMs) {
            out.skipped++;
            continue;
          }
          out.leads++;
          const mapped = mapLead(lead.field_data);
          if (!mapped.phone && !mapped.email) {
            out.skipped++;
            continue;
          }
          const phone = normalizePhone(mapped.phone)?.e164 || mapped.phone || "";
          const src =
            lead.platform === "ig" || lead.platform === "instagram" ? "instagram" : "facebook";
          try {
            const r = await propagateLead(
              {
                phone,
                name: mapped.name,
                email: mapped.email,
                source: src,
                attributes: { ...mapped.attributes, meta_form_id: String(f.id) },
              },
              { origin: "vox" },
            );
            if (r.voxAction === "created") out.created++;
            else out.updated++;
          } catch {
            out.skipped++;
          }
        }
        leadsAfter =
          lres.paging?.cursors?.after && lres.data?.length ? lres.paging.cursors.after : undefined;
      } while (leadsAfter);
    }
    formsAfter =
      fres.paging?.cursors?.after && fres.data?.length ? fres.paging.cursors.after : undefined;
  } while (formsAfter);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || "GET";

  // Verificación del webhook (Meta lo llama al suscribir).
  if (method === "GET") {
    const q = event?.queryStringParameters || {};
    if (q["hub.mode"] === "subscribe" && VERIFY_TOKEN && q["hub.verify_token"] === VERIFY_TOKEN) {
      return TEXT(200, String(q["hub.challenge"] || ""));
    }
    return TEXT(403, "forbidden");
  }
  if (method !== "POST") return TEXT(200, "ok");

  // rawBody CRUDO (decodificando base64 si hace falta): lo necesita el HMAC de
  // Meta (SEC-C5); re-serializar rompería la firma.
  const rawBody: string =
    typeof event.body === "string"
      ? event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body
      : JSON.stringify(event.body || {});

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return TEXT(200, "ok");
  }

  // Backfill (Fase C) — admin, gated por x-vox-internal (NO viene de Meta → no
  // lleva firma HMAC; su auth es el secreto interno, así que se valida aparte).
  if (body.action === "backfill") {
    const hdrs = event?.headers || {};
    const internalOk =
      !!INTERNAL_SECRET &&
      safeEqual(hdrs["x-vox-internal"] || hdrs["X-Vox-Internal"] || "", INTERNAL_SECRET);
    const JSONH = { "Content-Type": "application/json" };
    if (!internalOk)
      return { statusCode: 401, headers: JSONH, body: JSON.stringify({ error: "no autorizado" }) };
    const tenantId = String(body.tenantId || "");
    if (!tenantId)
      return {
        statusCode: 400,
        headers: JSONH,
        body: JSON.stringify({ error: "tenantId requerido" }),
      };
    const days = Math.min(365, Math.max(1, Number(body.days) || 90));
    try {
      const res = await backfill(tenantId, days);
      return { statusCode: 200, headers: JSONH, body: JSON.stringify(res) };
    } catch (e) {
      return {
        statusCode: 500,
        headers: JSONH,
        body: JSON.stringify({ error: e instanceof Error ? e.message : "backfill failed" }),
      };
    }
  }

  // SEC-C5 — validar la firma HMAC de Meta (X-Hub-Signature-256) sobre el body
  // CRUDO antes de procesar los leadgen. El backfill (arriba) ya retornó; acá solo
  // entran eventos server-to-server de Meta, que sí llevan firma.
  {
    const hdrs = (event?.headers || {}) as Record<string, string | undefined>;
    const sig = hdrs["x-hub-signature-256"] || hdrs["X-Hub-Signature-256"];
    // Firma con el App Secret del secret connectview/meta (el mismo que usan
    // meta-oauth-start/callback). Build-ahead: hoy ese secret NO existe →
    // loadMetaAppSecret devuelve "" y se hace fail-open (no rompe el webhook actual).
    // Go-live Meta (pendiente/cliente): crear connectview/meta {appId,appSecret} +
    // attachear la managed policy connectview-meta-secret-access al rol → la firma se
    // activa sola. Ver design/auditoria-codigo-2026-07-04.md.
    const appSecret = await loadMetaAppSecret();
    if (!appSecret) {
      console.warn("meta signature: sin app secret, saltando validación");
    } else if (!verifyMetaSignature(rawBody, sig, appSecret)) {
      console.warn("meta signature inválida — rechazando POST");
      return TEXT(403, "forbidden");
    }
  }

  try {
    for (const entry of body.entry || []) {
      const pageId = String(entry.id || "");
      for (const change of entry.changes || []) {
        if (change.field !== "leadgen") continue;
        const v = change.value || {};
        const leadgenId = v.leadgen_id || v.leadgenId;
        if (leadgenId) await handleLead(String(v.page_id || pageId), String(leadgenId), "facebook");
      }
    }
  } catch (e) {
    console.error("leadgen webhook procesamiento falló:", e);
  }

  // Meta exige 200 rápido para no reintentar.
  return TEXT(200, "ok");
};
