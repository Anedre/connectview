import type { Handler } from "aws-lambda";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { appendInbound, type ConvChannel } from "../_shared/conversations";

/**
 * meta-messaging-webhook — inbound de Instagram DM + Messenger (Pilar 6 · R13).
 * Gente que escribe directo a FB/IG → cae en el inbox omnicanal de ARIA
 * (connectview-conversations). El agente responde por la Graph API (manage-conversations).
 *
 *   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  → verificación
 *   POST { object:"page"|"instagram", entry:[{ id:<page|ig id>, messaging:[{ sender:{id}, message:{text,attachments} }] }] }
 *
 * Tenant por page_id/ig_id (scan connections meta.pageId/meta.igId). El token del
 * tenant (secret) sirve para resolver el nombre del remitente (best-effort).
 * Env: META_LEADGEN_VERIFY_TOKEN (o WHATSAPP_VERIFY_TOKEN), CONNECTIONS_TABLE.
 */
const legacyDynamo = new DynamoDBClient({});
const sm = new SecretsManagerClient({});
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const VERIFY_TOKEN = process.env.META_LEADGEN_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || "";
// El Page tiene UN solo override_callback_uri para todos sus campos → este webhook
// es el unificado del Page: maneja messaging acá y reenvía leadgen al webhook de leads.
const LEADGEN_WEBHOOK_URL = process.env.LEADGEN_WEBHOOK_URL || "";
const GRAPH = "https://graph.facebook.com/v20.0";

const TEXT = (statusCode: number, body: string) => ({ statusCode, headers: { "Content-Type": "text/plain" }, body });

/** Tenant cuyo meta.pageId o meta.igId matchea el id del evento. */
async function findTenant(metaId: string): Promise<{ tenantId: string } | null> {
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await legacyDynamo.send(new ScanCommand({ TableName: CONNECTIONS_TABLE, ExclusiveStartKey: lastKey as never }));
    for (const it of res.Items || []) {
      const row = unmarshall(it) as { tenantId?: string; configJson?: string };
      try {
        const cfg = JSON.parse(row.configJson || "{}");
        if (cfg.meta?.pageId === metaId || cfg.meta?.igId === metaId) return { tenantId: row.tenantId || "" };
      } catch { /* */ }
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return null;
}

async function getTenantToken(tenantId: string): Promise<string | null> {
  try {
    const r = await sm.send(new GetSecretValueCommand({ SecretId: `connectview/tenant/${tenantId}/whatsapp` }));
    const raw = r.SecretString || "";
    try { const j = JSON.parse(raw); if (j && typeof j.token === "string") return j.token; } catch { /* */ }
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

/** Nombre del remitente (best-effort). */
async function fetchName(senderId: string, channel: ConvChannel, token: string | null): Promise<string | undefined> {
  if (!token) return undefined;
  try {
    if (channel === "instagram") {
      const j = await graph(`${senderId}?fields=username,name`, token);
      return j.name || (j.username ? `@${j.username}` : undefined);
    }
    const j = await graph(`${senderId}?fields=name,first_name,last_name`, token);
    return j.name || [j.first_name, j.last_name].filter(Boolean).join(" ") || undefined;
  } catch {
    return undefined;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || "GET";

  if (method === "GET") {
    const q = event?.queryStringParameters || {};
    if (q["hub.mode"] === "subscribe" && VERIFY_TOKEN && q["hub.verify_token"] === VERIFY_TOKEN) {
      return TEXT(200, String(q["hub.challenge"] || ""));
    }
    return TEXT(403, "forbidden");
  }
  if (method !== "POST") return TEXT(200, "ok");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {};
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || {});
  } catch {
    return TEXT(200, "ok");
  }

  // El Page expone UN solo override_callback_uri para TODOS sus campos, así que
  // este webhook recibe también los leadgen del Pilar 5 → los reenvía al webhook
  // de leads (fire-and-forget). Los eventos de messaging se manejan acá.
  const hasLeadgen = (body.entry || []).some(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => Array.isArray(e.changes) && e.changes.some((c: any) => c.field === "leadgen"),
  );
  if (hasLeadgen && LEADGEN_WEBHOOK_URL) {
    try {
      await fetch(LEADGEN_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      console.log("leadgen reenviado al webhook de leads");
    } catch (e) {
      console.error("no se pudo reenviar leadgen:", e);
    }
  }

  const channel: ConvChannel = body.object === "instagram" ? "instagram" : "messenger";

  try {
    for (const entry of body.entry || []) {
      // Las entradas puramente leadgen no traen messaging[] → el loop las saltea solo.
      const metaId = String(entry.id || "");
      if (!Array.isArray(entry.messaging) || entry.messaging.length === 0) continue;
      const t = await findTenant(metaId);
      if (!t?.tenantId) {
        console.warn(`messaging: ${metaId} no mapeado a tenant`);
        continue;
      }
      const token = await getTenantToken(t.tenantId);
      // Messenger usa entry.messaging[]; IG también (objeto "instagram").
      for (const ev of entry.messaging || []) {
        const msg = ev.message;
        if (!msg || msg.is_echo) continue; // ignorar echoes (nuestros propios envíos)
        const senderId = String(ev.sender?.id || "");
        if (!senderId) continue;
        const text = String(msg.text || "");
        const att = msg.attachments?.[0];
        const attachment = att?.payload?.url ? { type: String(att.type || "file"), url: String(att.payload.url) } : undefined;
        const customerName = await fetchName(senderId, channel, token);
        await appendInbound(legacyDynamo, {
          channel,
          senderId,
          text,
          customerName,
          tenantId: t.tenantId,
          attachment,
          ts: ev.timestamp ? new Date(Number(ev.timestamp)).toISOString() : undefined,
        });
        console.log(`messaging inbound: ${channel} from=${senderId} tenant=${t.tenantId}`);
      }
    }
  } catch (e) {
    console.error("messaging webhook falló:", e);
  }

  return TEXT(200, "ok");
};
