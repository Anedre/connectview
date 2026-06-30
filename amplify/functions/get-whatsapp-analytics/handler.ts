import type { Handler } from "aws-lambda";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

/**
 * get-whatsapp-analytics — entrega agregada por plantilla desde Meta (Pilar 4 ·
 * Fase C). Para un número de WhatsApp en modo Meta Cloud API (no anclado a
 * Connect), Meta NO empuja eventos a ARIA, pero SÍ expone analytics por la
 * Graph API. Acá los traemos con el token del tenant:
 *   message_templates → ids · template_analytics → sent/delivered/read por plantilla.
 *
 * Es la "HSM Shipment Summary" de Chattigo (delivered%, read%) sin tocar el
 * event destination ni depender del webhook. Ver design/pilar-4-deliverability.md.
 *
 * Env: WHATSAPP_ANALYTICS_WABA_ID, WHATSAPP_TOKEN_SECRET (default "WhatsAppKeyPin").
 * Query: ?days=30 (ventana).
 */
const sm = new SecretsManagerClient({});
const WABA_ID = process.env.WHATSAPP_ANALYTICS_WABA_ID || "";
const TOKEN_SECRET = process.env.WHATSAPP_TOKEN_SECRET || "WhatsAppKeyPin";
const GRAPH = "https://graph.facebook.com/v20.0";
const CORS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });

let cachedToken: string | null = null;
async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const r = await sm.send(new GetSecretValueCommand({ SecretId: TOKEN_SECRET }));
  const raw = r.SecretString || "";
  // El secreto puede ser el token plano o un JSON {token}.
  let token = raw.trim();
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.token === "string") token = j.token;
  } catch { /* string plano */ }
  cachedToken = token;
  return token;
}

interface TemplateAgg {
  templateId: string;
  name: string;
  status: string;
  sent: number;
  delivered: number;
  read: number;
}

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
  if (!WABA_ID) return ok({ configured: false, error: "WABA de analytics no configurada" });
  try {
    const days = Math.min(90, Math.max(1, Number(event?.queryStringParameters?.days) || 30));
    const token = await getToken();
    const end = Math.floor(Date.now() / 1000);
    const start = end - days * 86400;

    // 1) Plantillas (id, name, status).
    const tmplMap = new Map<string, { name: string; status: string }>();
    let after: string | undefined;
    do {
      const q = `${WABA_ID}/message_templates?fields=id,name,status&limit=100${after ? `&after=${after}` : ""}`;
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
      const q = `${WABA_ID}/template_analytics?start=${start}&end=${end}&granularity=DAILY&metric_types=${metrics}&template_ids=${tids}`;
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
            agg.set(tid, { templateId: tid, name: meta.name, status: meta.status, sent: 0, delivered: 0, read: 0 });
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
    let wabaActivity = { sent: 0, delivered: 0 };
    try {
      const a = await graph(
        `${WABA_ID}?fields=analytics.start(${start}).end(${end}).granularity(DAY)`,
        token
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
      (acc, t) => ({ sent: acc.sent + t.sent, delivered: acc.delivered + t.delivered, read: acc.read + t.read }),
      { sent: 0, delivered: 0, read: 0 }
    );
    const deliveredRate = totals.sent > 0 ? Math.round((totals.delivered / totals.sent) * 100) : 0;
    const readRate = totals.delivered > 0 ? Math.round((totals.read / totals.delivered) * 100) : 0;

    return ok({
      configured: true,
      source: "meta_graph",
      wabaId: WABA_ID,
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
    return ok({ configured: true, error: err instanceof Error ? err.message : "analytics failed", templates: [] });
  }
};
