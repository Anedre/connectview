import type { Handler } from "aws-lambda";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { createHmac } from "node:crypto";
import { resolveTenantId } from "../_shared/cognitoAuth";

/**
 * get-analytics-feed — FEED DE DATOS para Power BI (y Excel/Looker/Tableau).
 * Un solo Lambda, dos modos:
 *
 *   1) META (la UI, autenticada por Cognito Bearer): `GET ?meta=1` con
 *      `Authorization: Bearer <idToken>` → devuelve { token, feedUrl, datasets }
 *      para que el panel de Analytics muestre la URL de conexión + el token.
 *
 *   2) DATOS (Power BI, sin Cognito): `GET ?token=<token>&dataset=<name>` →
 *      valida el token (determinístico, HMAC del tenantId con FEED_SECRET, sin
 *      storage) y devuelve el dataset como JSON plano que Power BI lee con
 *      "Obtener datos → Web".
 *
 * El token es POR-TENANT y de SOLO LECTURA. Va en la URL (limitación del
 * conector Web de Power BI) → tratarlo como credencial. Rotación global = rotar
 * FEED_SECRET (rota todos los tokens).
 */

const dynamo = new DynamoDBClient({});
const HSM_SENDS_TABLE = process.env.HSM_SENDS_TABLE || "connectview-hsm-sends";
const LEADS_TABLE = process.env.LEADS_TABLE || "connectview-leads";
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || "connectview-conversations";
const FEED_SECRET = process.env.FEED_SECRET || "";

// Solo Content-Type: los headers CORS los pone la Function URL (auth NONE + CORS).
// Si los seteáramos acá TAMBIÉN, el navegador vería Access-Control-Allow-Origin
// DUPLICADO (handler + Function URL) y bloquearía → "Failed to fetch".
const CORS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({
  statusCode: c,
  headers: CORS,
  body: JSON.stringify({ error: e }),
});

const DATASETS = [
  "hsm",
  "leads",
  "leads-history",
  "leads-stages",
  "conversations",
  "summary",
] as const;
type Dataset = (typeof DATASETS)[number];

/** Firma HMAC (base64url, 22 chars) del tenantId. */
function sign(tenantId: string): string {
  return createHmac("sha256", FEED_SECRET).update(tenantId).digest("base64url").slice(0, 22);
}
/** token = base64url(tenantId)."."firma. */
function makeToken(tenantId: string): string {
  return `${Buffer.from(tenantId).toString("base64url")}.${sign(tenantId)}`;
}
/** Valida el token → tenantId, o null. Comparación en tiempo constante. */
function verifyToken(token: string): string | null {
  const parts = (token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let tenantId: string;
  try {
    tenantId = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!tenantId) return null;
  const expected = sign(tenantId);
  if (parts[1].length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= parts[1].charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? tenantId : null;
}

/** Scan completo (paginado + capado) de una tabla, aplicando `pick` por fila del tenant. */
async function scanAll<T>(
  table: string,
  tenantId: string,
  pick: (row: Record<string, unknown>) => T | null,
): Promise<T[]> {
  const out: T[] = [];
  let ESK: Record<string, unknown> | undefined;
  let pages = 0;
  do {
    const r = await dynamo.send(
      new ScanCommand({ TableName: table, ExclusiveStartKey: ESK as never }),
    );
    for (const it of r.Items || []) {
      const row = unmarshall(it) as Record<string, unknown>;
      // Aislamiento por tenant: si la fila trae tenantId y no es el nuestro, fuera.
      if (row.tenantId && row.tenantId !== tenantId) continue;
      const v = pick(row);
      if (v != null) out.push(v);
    }
    ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ESK && ++pages < 80);
  return out;
}

const s = (v: unknown): string => (v == null ? "" : String(v));

// ── Golpes / historial de leads (Pilar 2) ────────────────────────────────────
// Espejo de _shared/leadSync GOLPE_TYPES. Se replica acá (en vez de importar
// leadSync) para no arrastrar el SDK de Salesforce/Profiles a este Lambda público
// chico. Si cambian los tipos de golpe allá, sincronizar acá.
const GOLPE_TYPES = new Set([
  "gestion",
  "interaccion",
  "whatsapp_out",
  "whatsapp_in",
  "email_out",
  "email_opened",
  "email_clicked",
  "call",
]);

type Hist = {
  ts?: string;
  type?: string;
  channel?: string;
  direction?: string;
  stageLabel?: string;
  summary?: string;
  notes?: string;
  agent?: string;
  templateName?: string;
  outcome?: string;
};

const histOf = (row: Record<string, unknown>): Hist[] =>
  Array.isArray(row.history) ? (row.history as Hist[]) : [];

/** Etiqueta de etapa actual: el último stageLabel visto en el history, o el stageId. */
function stageLabelOf(hist: Hist[], stageId: string): string {
  for (let i = hist.length - 1; i >= 0; i--) if (hist[i]?.stageLabel) return s(hist[i].stageLabel);
  return stageId;
}

/** Etapa legible y uniforme: "no_contactado"/"No contactado" → "No Contactado".
 *  Los datos traen la misma etapa con casing/guiones distintos (stageId crudo vs
 *  stageLabel del history); normalizar evita que el embudo la cuente doble. */
function prettyStage(raw: string): string {
  const t = (raw || "").replace(/[_-]+/g, " ").trim().replace(/\s+/g, " ");
  if (!t) return "(sin etapa)";
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}
/** Clave canónica para agrupar etapas equivalentes (sin casing/espacios/guiones). */
const stageKey = (raw: string): string => (raw || "").toLowerCase().replace(/[_\s-]+/g, "");

/** Resumen de golpes de un lead desde su history (Pilar 2, sin taxonomía). */
function golpesOf(hist: Hist[]) {
  let golpes = 0,
    wa = 0,
    call = 0,
    email = 0,
    gestion = 0;
  let firstTouchAt = "",
    lastTouchAt = "";
  for (const e of hist) {
    const t = e.type || "";
    if (!GOLPE_TYPES.has(t)) continue;
    golpes++;
    if (t.startsWith("whatsapp")) wa++;
    else if (t === "call") call++;
    else if (t.startsWith("email")) email++;
    else if (t === "gestion" || t === "interaccion") gestion++;
    const ts = e.ts || "";
    if (ts && (!firstTouchAt || ts < firstTouchAt)) firstTouchAt = ts;
    if (ts && (!lastTouchAt || ts > lastTouchAt)) lastTouchAt = ts;
  }
  return { golpes, wa, call, email, gestion, firstTouchAt, lastTouchAt };
}

async function buildDataset(dataset: Dataset, tenantId: string): Promise<unknown[]> {
  switch (dataset) {
    case "hsm":
      return scanAll(HSM_SENDS_TABLE, tenantId, (r) => ({
        sendId: s(r.sendId),
        template: s(r.templateName || r.template),
        phone: s(r.phone || r.to),
        status: s(r.status || "sent"),
        sentAt: s(r.sentAt),
        campaign: s(r.campaign || r.campaignId),
      }));
    case "leads":
      return scanAll(LEADS_TABLE, tenantId, (r) => {
        const hist = histOf(r);
        const g = golpesOf(hist);
        const stageId = s(r.stageId || r.stage);
        return {
          leadId: s(r.leadId || r.id),
          name: s(r.name),
          phone: s(r.phone),
          email: s(r.email),
          status: s(r.status),
          stage: prettyStage(stageLabelOf(hist, stageId)),
          stageId,
          program: s(r.programId || r.program),
          source: s(r.source),
          assignedAgent: s(r.assignedAgentUserId || r.owner),
          golpes: g.golpes,
          whatsapp: g.wa,
          llamadas: g.call,
          emails: g.email,
          gestiones: g.gestion,
          primerToque: g.firstTouchAt,
          ultimoToque: g.lastTouchAt,
          createdAt: s(r.createdAt),
          updatedAt: s(r.updatedAt),
        };
      });
    case "leads-history": {
      // Una fila por evento del history de cada lead (el timeline completo de golpes).
      const rows: Record<string, unknown>[] = [];
      await scanAll(LEADS_TABLE, tenantId, (r) => {
        const leadId = s(r.leadId || r.id);
        const name = s(r.name);
        const phone = s(r.phone);
        for (const e of histOf(r)) {
          rows.push({
            leadId,
            name,
            phone,
            ts: s(e.ts),
            tipo: s(e.type),
            golpe: GOLPE_TYPES.has(e.type || "") ? "sí" : "no",
            canal: s(e.channel),
            direccion: s(e.direction),
            etapa: s(e.stageLabel),
            detalle: s(e.summary || e.notes),
            agente: s(e.agent),
            plantilla: s(e.templateName),
            resultado: s(e.outcome),
          });
        }
        return null; // acumulamos los eventos, no el lead
      });
      rows.sort((a, b) => s(a.ts).localeCompare(s(b.ts)));
      return rows;
    }
    case "leads-stages": {
      // Embudo: conteo de leads + golpes por etapa (con % de conversión).
      const map = new Map<
        string,
        { etapa: string; leads: number; golpes: number; convertidos: number }
      >();
      await scanAll(LEADS_TABLE, tenantId, (r) => {
        const hist = histOf(r);
        const etapa = prettyStage(stageLabelOf(hist, s(r.stageId || r.stage)));
        const key = stageKey(etapa); // fusiona "contactado"/"Contactado"/"no_contactado"
        const g = golpesOf(hist);
        const m = map.get(key) || { etapa, leads: 0, golpes: 0, convertidos: 0 };
        m.leads++;
        m.golpes += g.golpes;
        if (s(r.status) === "converted") m.convertidos++;
        map.set(key, m);
        return null;
      });
      return [...map.values()]
        .sort((a, b) => b.leads - a.leads)
        .map((m) => ({
          etapa: m.etapa,
          leads: m.leads,
          golpesTotal: m.golpes,
          golpesProm: m.leads ? Math.round((m.golpes / m.leads) * 10) / 10 : 0,
          convertidos: m.convertidos,
        }));
    }
    case "conversations":
      return scanAll(CONVERSATIONS_TABLE, tenantId, (r) => {
        const msgs = Array.isArray(r.messages) ? (r.messages as unknown[]) : [];
        return {
          conversationId: s(r.conversationId || r.id),
          channel: s(r.channel),
          senderId: s(r.senderId || r.customerPhone),
          name: s(r.customerName || r.name),
          messages: msgs.length,
          lastMessageAt: s(r.lastMessageAt),
          assignedAgent: s(r.assignedAgentUserId),
          status: s(r.status),
        };
      });
    case "summary": {
      // Un resumen chico (una fila) para tablas de KPIs en Power BI.
      const hsm = await scanAll(HSM_SENDS_TABLE, tenantId, (r) => s(r.status || "sent"));
      const leads = await scanAll(LEADS_TABLE, tenantId, () => 1);
      const by = (st: string) => hsm.filter((x) => x === st).length;
      return [
        {
          hsmTotal: hsm.length,
          hsmDelivered: by("delivered") + by("read"),
          hsmRead: by("read"),
          hsmFailed: by("failed"),
          hsmPending: by("pending") + by("sent"),
          leadsTotal: leads.length,
          generatedAt: new Date().toISOString(),
        },
      ];
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (!FEED_SECRET) return bad(500, "feed no configurado (falta FEED_SECRET)");

  const q = event?.queryStringParameters || {};

  // ── Modo META (autenticado): devuelve el token + la URL para el panel ──────
  if (q.meta) {
    const tenantId = await resolveTenantId(event?.headers);
    if (!tenantId) return bad(401, "no autorizado");
    const domain = event?.requestContext?.domainName || event?.headers?.host || "";
    const feedUrl = domain ? `https://${domain}/` : "";
    return ok({
      token: makeToken(tenantId),
      feedUrl,
      datasets: DATASETS,
    });
  }

  // ── Modo DATOS: Power BI usa ?token=; la app (autenticada) puede pedir el
  //    mismo dataset con su Bearer de Cognito (para el catálogo de Descargas). ──
  let tenantId = verifyToken(q.token || "");
  if (!tenantId && event?.headers?.authorization) {
    tenantId = await resolveTenantId(event.headers);
  }
  if (!tenantId) return bad(401, "token inválido o ausente");
  const dataset = (q.dataset || "hsm") as Dataset;
  if (!DATASETS.includes(dataset)) {
    return bad(400, `dataset desconocido. Válidos: ${DATASETS.join(", ")}`);
  }
  try {
    const rows = await buildDataset(dataset, tenantId);
    return ok({ dataset, count: rows.length, rows, generatedAt: new Date().toISOString() });
  } catch (e) {
    console.warn("feed dataset falló:", e instanceof Error ? e.message : e);
    return bad(500, "no se pudo generar el dataset");
  }
};
