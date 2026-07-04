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

const DATASETS = ["hsm", "leads", "conversations", "summary"] as const;
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
      return scanAll(LEADS_TABLE, tenantId, (r) => ({
        leadId: s(r.leadId || r.id),
        name: s(r.name),
        phone: s(r.phone),
        email: s(r.email),
        status: s(r.status),
        stage: s(r.stage || r.subStage),
        program: s(r.program || r.programId),
        source: s(r.source),
        assignedAgent: s(r.assignedAgentUserId || r.owner),
        createdAt: s(r.createdAt),
        updatedAt: s(r.updatedAt),
      }));
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
