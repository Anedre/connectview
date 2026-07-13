import type { Handler } from "aws-lambda";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { resolveTenantId, isLegacyTenant } from "../_shared/cognitoAuth";

/**
 * get-whatsapp-analytics — entrega agregada por plantilla desde Meta (Pilar 4 ·
 * Fase C). Para un número de WhatsApp en modo Meta Cloud API (no anclado a
 * Connect), Meta NO empuja eventos a ARIA, pero SÍ expone analytics por la
 * Graph API. Aquí los traemos con el token del tenant:
 *   message_templates → ids · template_analytics → sent/delivered/read por plantilla.
 *
 * Es la "HSM Shipment Summary" de Chattigo (delivered%, read%) sin tocar el
 * event destination ni depender del webhook. Ver design/pilar-4-deliverability.md.
 *
 * Env: WHATSAPP_ANALYTICS_WABA_ID, WHATSAPP_TOKEN_SECRET (default "WhatsAppKeyPin").
 * Query: ?days=30 (ventana).
 */
const sm = new SecretsManagerClient({});
const legacyDynamo = new DynamoDBClient({});
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const WABA_ID = process.env.WHATSAPP_ANALYTICS_WABA_ID || "";
const TOKEN_SECRET = process.env.WHATSAPP_TOKEN_SECRET || "WhatsAppKeyPin";
const GRAPH = "https://graph.facebook.com/v20.0";
const CORS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });

/** Extrae el token de un secreto (token plano o JSON {token}). */
function parseTokenSecret(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.token === "string") return j.token;
  } catch {
    /* string plano */
  }
  return t;
}

/** Token de Meta del env (fundador/Novasys). */
let cachedToken: string | null = null;
async function getLegacyToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  const r = await sm.send(new GetSecretValueCommand({ SecretId: TOKEN_SECRET }));
  cachedToken = parseTokenSecret(r.SecretString || "");
  return cachedToken;
}

/** WABA del TENANT (de su config en connectview-connections). "" si no configuró. */
async function getTenantWaba(tenantId: string): Promise<string> {
  try {
    const it = await legacyDynamo.send(
      new GetItemCommand({ TableName: CONNECTIONS_TABLE, Key: { tenantId: { S: tenantId } } }),
    );
    if (!it.Item) return "";
    const cfg = JSON.parse(unmarshall(it.Item).configJson || "{}");
    return cfg.whatsapp?.wabaId || "";
  } catch {
    return "";
  }
}

/** Token de Meta del TENANT (Secrets Manager por-tenant). null si no lo cargó. */
async function getTenantToken(tenantId: string): Promise<string | null> {
  try {
    const r = await sm.send(
      new GetSecretValueCommand({ SecretId: `connectview/tenant/${tenantId}/whatsapp` }),
    );
    return parseTokenSecret(r.SecretString || "");
  } catch {
    return null;
  }
}

interface TemplateAgg {
  templateId: string;
  name: string;
  status: string;
  sent: number;
  delivered: number;
  read: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- respuesta JSON de la Graph API de Meta (forma dinámica)
async function graph(path: string, token: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`);
  const j = await r.json();
  if (!r.ok || j?.error) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  // Per-tenant: el WABA + token salen de la config del TENANT del JWT. Antes se
  // usaba una WABA de env GLOBAL → todos los tenants veían la misma. Anónimo →
  // bloqueado; fundador/Novasys → env (comportamiento histórico); real → el suyo.
  const tenantId = await resolveTenantId(event?.headers);
  if (!tenantId) return ok({ configured: false, error: "No autenticado" });
  let wabaId: string;
  let token: string | null;
  if (isLegacyTenant(tenantId)) {
    wabaId = WABA_ID;
    token = await getLegacyToken();
  } else {
    wabaId = await getTenantWaba(tenantId);
    token = await getTenantToken(tenantId);
  }
  if (!wabaId || !token) {
    return ok({ configured: false, error: "WhatsApp (Meta) no configurado para tu organización" });
  }
  try {
    const days = Math.min(90, Math.max(1, Number(event?.queryStringParameters?.days) || 30));
    const end = Math.floor(Date.now() / 1000);
    const start = end - days * 86400;

    // 1) Plantillas (id, name, status).
    const tmplMap = new Map<string, { name: string; status: string }>();
    let after: string | undefined;
    do {
      const q = `${wabaId}/message_templates?fields=id,name,status&limit=100${after ? `&after=${after}` : ""}`;
      const res = await graph(q, token);
      for (const t of res.data || []) tmplMap.set(String(t.id), { name: t.name, status: t.status });
      after = res.paging?.cursors?.after && res.data?.length ? res.paging.cursors.after : undefined;
    } while (after);

    const ids = [...tmplMap.keys()];
    const agg = new Map<string, TemplateAgg>();

    // 2) template_analytics en lotes (Meta tope ~10 ids/llamada).
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const metrics = encodeURIComponent(JSON.stringify(["SENT", "DELIVERED", "READ"]));
      const tids = encodeURIComponent(JSON.stringify(batch));
      const q = `${wabaId}/template_analytics?start=${start}&end=${end}&granularity=DAILY&metric_types=${metrics}&template_ids=${tids}`;
      let res;
      try {
        res = await graph(q, token);
      } catch (e) {
        console.warn("template_analytics batch falló:", e instanceof Error ? e.message : e);
        continue;
      }
      for (const block of res.data || []) {
        for (const dp of block.data_points || []) {
          const tid = String(dp.template_id);
          if (!agg.has(tid)) {
            const meta = tmplMap.get(tid) || { name: tid, status: "" };
            agg.set(tid, {
              templateId: tid,
              name: meta.name,
              status: meta.status,
              sent: 0,
              delivered: 0,
              read: 0,
            });
          }
          const a = agg.get(tid)!;
          a.sent += dp.sent || 0;
          a.delivered += dp.delivered || 0;
          a.read += dp.read || 0;
        }
      }
    }

    // 2b) Actividad WABA-level (mensajes enviados/entregados del número) — da un
    //     headline real aunque template_analytics esté ralo (mensajes de sesión, etc.).
    const wabaActivity = { sent: 0, delivered: 0 };
    try {
      const a = await graph(
        `${wabaId}?fields=analytics.start(${start}).end(${end}).granularity(DAY)`,
        token,
      );
      for (const dp of a?.analytics?.data_points || []) {
        wabaActivity.sent += dp.sent || 0;
        wabaActivity.delivered += dp.delivered || 0;
      }
    } catch (e) {
      console.warn("waba analytics falló:", e instanceof Error ? e.message : e);
    }

    // 3) Agregados + tasas. Solo plantillas con envíos.
    const templates = [...agg.values()].filter((t) => t.sent > 0).sort((a, b) => b.sent - a.sent);
    const totals = templates.reduce(
      (acc, t) => ({
        sent: acc.sent + t.sent,
        delivered: acc.delivered + t.delivered,
        read: acc.read + t.read,
      }),
      { sent: 0, delivered: 0, read: 0 },
    );
    const deliveredRate = totals.sent > 0 ? Math.round((totals.delivered / totals.sent) * 100) : 0;
    const readRate = totals.delivered > 0 ? Math.round((totals.read / totals.delivered) * 100) : 0;

    return ok({
      configured: true,
      source: "meta_graph",
      wabaId,
      windowDays: days,
      templateCount: tmplMap.size,
      templates: templates.map((t) => ({
        ...t,
        deliveredRate: t.sent > 0 ? Math.round((t.delivered / t.sent) * 100) : 0,
        readRate: t.delivered > 0 ? Math.round((t.read / t.delivered) * 100) : 0,
      })),
      totals,
      rates: { deliveredRate, readRate },
      wabaActivity,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("get-whatsapp-analytics error", err);
    return ok({
      configured: true,
      error: err instanceof Error ? err.message : "analytics failed",
      templates: [],
    });
  }
};
