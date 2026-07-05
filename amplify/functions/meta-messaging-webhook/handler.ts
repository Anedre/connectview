import type { Handler } from "aws-lambda";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import {
  appendInbound,
  appendComment,
  setTyping,
  convId,
  type ConvChannel,
} from "../_shared/conversations";
import { normalizeMetaAccounts, findMetaAccount } from "../_shared/metaAccounts";
import { loadMetaAppSecret, verifyMetaSignature } from "../_shared/metaSignature";

/**
 * meta-messaging-webhook — inbound de Instagram DM + Messenger + comentarios
 * FB/IG (Pilar 6 · R13). Gente que escribe directo o comenta en FB/IG → cae en
 * el inbox omnicanal de ARIA (connectview-conversations). El agente responde por
 * la Graph API (manage-conversations).
 *
 *   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  → verificación
 *   POST { object:"page"|"instagram", entry:[{ id, messaging:[…], changes:[…] }] }
 *     · messaging[]      → DM (Fase A)
 *     · changes[] feed   → comentario de Página FB (Fase B)
 *     · changes[] comments → comentario de IG (Fase B)
 *     · changes[] leadgen  → se REENVÍA al webhook de leads (Pilar 5)
 *
 * Tenant por page_id/ig_id (scan connections meta.pageId/meta.igId). El token del
 * tenant (secret) sirve para resolver el nombre del remitente (best-effort).
 * Env: META_LEADGEN_VERIFY_TOKEN (o WHATSAPP_VERIFY_TOKEN), CONNECTIONS_TABLE.
 */
const legacyDynamo = new DynamoDBClient({});
const sm = new SecretsManagerClient({});
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const VERIFY_TOKEN =
  process.env.META_LEADGEN_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || "";
// El Page tiene UN solo override_callback_uri para todos sus campos → este webhook
// es el unificado del Page: maneja messaging acá y reenvía leadgen al webhook de leads.
const LEADGEN_WEBHOOK_URL = process.env.LEADGEN_WEBHOOK_URL || "";
const GRAPH = "https://graph.facebook.com/v20.0";

const TEXT = (statusCode: number, body: string) => ({
  statusCode,
  headers: { "Content-Type": "text/plain" },
  body,
});

/** Tenant cuya CUENTA (page/ig id) matchea el id del evento. Multi-cuenta:
 *  busca en meta.accounts[] y además en el legacy singular (meta.pageId/igId),
 *  ambos vía normalizeMetaAccounts. */
async function findTenant(metaId: string): Promise<{ tenantId: string } | null> {
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await legacyDynamo.send(
      new ScanCommand({ TableName: CONNECTIONS_TABLE, ExclusiveStartKey: lastKey as never }),
    );
    for (const it of res.Items || []) {
      const row = unmarshall(it) as { tenantId?: string; configJson?: string };
      try {
        const cfg = JSON.parse(row.configJson || "{}");
        const accounts = normalizeMetaAccounts(cfg.meta);
        if (findMetaAccount(accounts, metaId)) return { tenantId: row.tenantId || "" };
      } catch {
        /* */
      }
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return null;
}

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
      /* */
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

/** Nombre del remitente (best-effort). */
async function fetchName(
  senderId: string,
  channel: ConvChannel,
  token: string | null,
): Promise<string | undefined> {
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

  // SEC-C5 — validar la firma HMAC de Meta (X-Hub-Signature-256) sobre el body
  // CRUDO antes de procesar. Solo tras validar reenviamos leadgen al webhook de
  // leads y espejeamos DMs/comentarios al inbox. El GET de verificación (arriba)
  // no lleva firma y va por otro camino.
  const hdrs = (event.headers || {}) as Record<string, string | undefined>;
  const rawBody: string =
    typeof event.body === "string"
      ? event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body
      : JSON.stringify(event.body || {});
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
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
      const metaId = String(entry.id || "");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const changes: any[] = Array.isArray(entry.changes) ? entry.changes : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messaging: any[] = Array.isArray(entry.messaging) ? entry.messaging : [];
      const hasComments = changes.some((c) => c.field === "feed" || c.field === "comments");
      // Entradas puramente leadgen (ya reenviadas) o sin nada que hacer → saltar.
      if (!messaging.length && !hasComments) continue;

      const t = await findTenant(metaId);
      if (!t?.tenantId) {
        console.warn(`${metaId} no mapeado a tenant`);
        continue;
      }
      const token = await getTenantToken(t.tenantId);

      // ── Comentarios FB (feed) / IG (comments) → conversación fb_comment (Fase B) ──
      for (const ch of changes) {
        if (ch.field !== "feed" && ch.field !== "comments") continue;
        const v = ch.value || {};
        // FB feed trae muchísimos verbos (like, status, share…); solo comentarios nuevos.
        if (ch.field === "feed" && (v.item !== "comment" || v.verb !== "add")) continue;
        const fromId = String(v.from?.id || "");
        const commentId = String(v.comment_id || v.id || "");
        if (!fromId || !commentId) continue;
        if (fromId === metaId) continue; // comentario nuestro (de la propia Página/IG)
        const platform: "facebook" | "instagram" =
          ch.field === "comments" ? "instagram" : "facebook";
        const text = String(v.message ?? v.text ?? "");
        const fromName = v.from?.name || (v.from?.username ? `@${v.from.username}` : undefined);
        const postId = String(v.post_id || v.media?.id || "");
        await appendComment(legacyDynamo, {
          platform,
          fromId,
          fromName,
          text,
          commentId,
          postId,
          tenantId: t.tenantId,
          metaAccountId: metaId,
          // FB created_time viene en segundos epoch; IG normalmente no lo trae.
          ts: v.created_time ? new Date(Number(v.created_time) * 1000).toISOString() : undefined,
        });
        console.log(
          `comment inbound: ${platform} from=${fromId} comment=${commentId} tenant=${t.tenantId}`,
        );
      }

      // ── Mensajería IG DM / Messenger → conversación instagram|messenger (Fase A) ──
      for (const ev of messaging) {
        const senderId = String(ev.sender?.id || "");
        if (!senderId) continue;

        // Typing entrante: cuando Meta lo entrega, llega como `sender_action`
        // ("typing_on"/"typing_off") en el evento de messaging. Set `typingUntil`
        // ~8s → la bandeja muestra "escribiendo…". NOTA: el Messenger Platform NO
        // garantiza estos eventos para todos los usuarios (a diferencia de un DM);
        // por eso es aditivo y no bloquea nada. Recibo de LECTURA del cliente
        // (`read`) tampoco se recibe acá de forma estándar → no lo inventamos.
        const senderAction = String(ev.sender_action || "");
        if (senderAction === "typing_on") {
          try {
            await setTyping(legacyDynamo, convId(channel, senderId));
          } catch (e) {
            console.warn("setTyping falló:", (e as Error).message);
          }
          continue; // un typing no es un mensaje
        }
        if (senderAction === "typing_off") continue;

        const msg = ev.message;
        if (!msg || msg.is_echo) continue; // ignorar echoes (nuestros propios envíos)
        const text = String(msg.text || "");
        const att = msg.attachments?.[0];
        const attachment = att?.payload?.url
          ? { type: String(att.type || "file"), url: String(att.payload.url) }
          : undefined;
        const customerName = await fetchName(senderId, channel, token);
        await appendInbound(legacyDynamo, {
          channel,
          senderId,
          text,
          customerName,
          tenantId: t.tenantId,
          attachment,
          metaAccountId: metaId,
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
