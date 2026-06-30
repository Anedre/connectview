import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { resolveTenantId } from "../_shared/cognitoAuth";
import {
  listConversations,
  getConversation,
  appendOutbound,
  patchConversation,
  type Conversation,
} from "../_shared/conversations";
import { samePhone } from "../_shared/phone";
import { sendWhatsApp } from "../_shared/whatsappSend";

/**
 * manage-conversations — backend del inbox omnicanal (Pilar 6 · R13).
 *   GET                       → lista de conversaciones (para el inbox)
 *   GET  ?conversationId=ID   → una conversación con su thread
 *   POST { action:"reply", conversationId, text }   → responde por la Graph API + append
 *   POST { action:"markRead"|"close", conversationId }
 *
 * Conversaciones en la tabla pooled `connectview-conversations`. Para responder
 * usa el token Meta del tenant (secret) → page token → Send API.
 */
const legacyDynamo = new DynamoDBClient({});
const sm = new SecretsManagerClient({});
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const LEADS_TABLE = process.env.LEADS_TABLE || "connectview-leads";
const GRAPH = "https://graph.facebook.com/v20.0";

/** Label legible del canal para la línea de tiempo del lead (golpes · Pilar 2). */
const CH_LABEL: Record<string, string> = {
  instagram: "Instagram",
  messenger: "Messenger",
  whatsapp: "WhatsApp",
  fb_comment: "Comentario",
};

interface LeadLite {
  leadId: string;
  phone?: string;
  name?: string;
  email?: string;
  stageId?: string;
}

/** Busca un lead por teléfono (scan + `samePhone`, sin GSI hoy). Para auto-
 *  vincular una conversación social a un lead existente (Fase C). */
async function findLeadByPhone(phone: string): Promise<LeadLite | null> {
  if (!phone) return null;
  let ESK: Record<string, unknown> | undefined;
  try {
    do {
      const r = await legacyDynamo.send(
        new ScanCommand({
          TableName: LEADS_TABLE,
          ExclusiveStartKey: ESK as never,
          ProjectionExpression: "leadId, phone, #n, email, stageId",
          ExpressionAttributeNames: { "#n": "name" },
        }),
      );
      for (const it of r.Items || []) {
        const l = unmarshall(it) as LeadLite;
        if (l.phone && samePhone(String(l.phone), phone)) return l;
      }
      ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ESK);
  } catch (e) {
    console.warn("findLeadByPhone falló", (e as Error).message);
  }
  return null;
}

/** Registra un "golpe" (toque) en la línea de tiempo del lead (Pilar 2) por una
 *  interacción social. Atómico (list_append) y best-effort. */
async function appendLeadGolpe(
  leadId: string,
  ev: { channel: string; direction: "in" | "out"; text: string; agent?: string },
): Promise<void> {
  if (!leadId) return;
  const now = new Date().toISOString();
  const event = {
    ts: now,
    type: "gestion",
    channel: CH_LABEL[ev.channel] || ev.channel,
    direction: ev.direction,
    summary: (ev.text || "").slice(0, 200),
    agent: ev.agent,
    source: "inbox",
  };
  try {
    await legacyDynamo.send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: leadId } },
        UpdateExpression: "SET #h = list_append(if_not_exists(#h, :e), :ev), updatedAt = :now",
        ExpressionAttributeNames: { "#h": "history" },
        ExpressionAttributeValues: marshall(
          { ":e": [], ":ev": [event], ":now": now },
          { removeUndefinedValues: true },
        ),
        ConditionExpression: "attribute_exists(leadId)",
      }),
    );
  } catch (e) {
    console.warn("appendLeadGolpe falló", (e as Error).message);
  }
}
const CORS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({
  statusCode: c,
  headers: CORS,
  body: JSON.stringify({ error: e }),
});

async function getTenantMeta(
  tenantId: string,
): Promise<{ token?: string; pageId?: string; waPhoneId?: string }> {
  let token: string | undefined, pageId: string | undefined, waPhoneId: string | undefined;
  try {
    const it = await legacyDynamo.send(
      new GetItemCommand({ TableName: CONNECTIONS_TABLE, Key: { tenantId: { S: tenantId } } }),
    );
    if (it.Item) {
      const cfg = JSON.parse(unmarshall(it.Item).configJson || "{}");
      pageId = cfg.meta?.pageId;
      // WhatsApp meta-mode: phone_number_id para responder por la Cloud API.
      if (cfg.whatsapp?.mode === "meta") waPhoneId = cfg.whatsapp?.metaPhoneNumberId;
    }
  } catch {
    /* */
  }
  try {
    const r = await sm.send(
      new GetSecretValueCommand({ SecretId: `connectview/tenant/${tenantId}/whatsapp` }),
    );
    const raw = r.SecretString || "";
    try {
      const j = JSON.parse(raw);
      token = typeof j.token === "string" ? j.token : raw.trim();
    } catch {
      token = raw.trim();
    }
  } catch {
    /* */
  }
  return { token, pageId, waPhoneId };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function graph(path: string, token: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`);
  const j = await r.json();
  if (!r.ok || j?.error) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j;
}

/** Page token desde el system token (cae al system token si falla). */
async function resolvePageToken(systemToken: string, pageId: string): Promise<string> {
  try {
    const pj = await graph(`${pageId}?fields=access_token`, systemToken);
    if (pj?.access_token) return pj.access_token;
  } catch {
    /* usamos el system token */
  }
  return systemToken;
}

/** POST a la Graph con token en el body (para acciones de escritura). */
async function graphPost(
  path: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const r = await fetch(`${GRAPH}/${path}?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!r.ok || j?.error) throw new Error(j?.error?.message || `HTTP ${r.status}`);
}

/** Envía un DM (Messenger / IG) por el Send API del Page. */
async function sendMetaMessage(
  pageId: string,
  pageToken: string,
  recipientId: string,
  text: string,
): Promise<void> {
  await graphPost(`${pageId}/messages`, pageToken, {
    recipient: { id: recipientId },
    messaging_type: "RESPONSE",
    message: { text },
  });
}

/** Responde EN PÚBLICO al comentario (FB: /{id}/comments · IG: /{id}/replies). */
async function replyToComment(
  commentId: string,
  platform: string,
  pageToken: string,
  message: string,
): Promise<void> {
  const path = platform === "instagram" ? `${commentId}/replies` : `${commentId}/comments`;
  await graphPost(path, pageToken, { message });
}

/** Pasa el comentario a PRIVADO (private reply). FB: Send API recipient.comment_id;
 *  IG: /{comment-id}/private_replies. Solo se permite UNA vez por comentario. */
async function privateReplyToComment(
  pageId: string,
  commentId: string,
  platform: string,
  pageToken: string,
  text: string,
): Promise<void> {
  if (platform === "instagram") {
    await graphPost(`${commentId}/private_replies`, pageToken, { message: text });
  } else {
    await graphPost(`${pageId}/messages`, pageToken, {
      recipient: { comment_id: commentId },
      message: { text },
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  const params = event.queryStringParameters || {};
  const tenantId = await resolveTenantId(event?.headers);
  if (!tenantId) return bad(401, "no autorizado");

  try {
    if (method === "GET") {
      if (params.conversationId) {
        let conv = await getConversation(legacyDynamo, String(params.conversationId));
        // Auto-vínculo perezoso (Fase C): si hay teléfono (de WhatsApp o extraído
        // del DM) y todavía no hay lead, intentamos matchear uno existente.
        if (conv && conv.phone && !conv.leadId) {
          const lead = await findLeadByPhone(conv.phone);
          if (lead?.leadId) {
            conv =
              (await patchConversation(legacyDynamo, conv.conversationId, {
                leadId: lead.leadId,
                customerName: conv.customerName || lead.name,
              })) || conv;
            if (conv?.leadId) {
              await appendLeadGolpe(lead.leadId, {
                channel: conv.channel,
                direction: "in",
                text: conv.lastMessagePreview || "(conversación social)",
              });
            }
          }
        }
        return ok({ conversation: conv });
      }
      const conversations = await listConversations(legacyDynamo, { limit: 500 });
      const unread = conversations.reduce((n, c) => n + (c.unread || 0), 0);
      return ok({ conversations, unread });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const conversationId = String(body.conversationId || "");
      if (!conversationId) return bad(400, "conversationId requerido");

      if (body.action === "markRead") {
        const conv = await patchConversation(legacyDynamo, conversationId, { unread: 0 });
        return ok({ conversation: conv });
      }
      if (body.action === "close") {
        const conv = await patchConversation(legacyDynamo, conversationId, { status: "closed" });
        return ok({ conversation: conv });
      }

      // Vincular / desvincular identidad (Fase C). El agente elige un lead; o se
      // auto-vincula por teléfono. Al vincular, registra el toque entrante (golpe).
      if (body.action === "link") {
        const leadId = String(body.leadId || "");
        if (!leadId) return bad(400, "leadId requerido");
        const patch: Partial<Pick<Conversation, "leadId" | "phone" | "email" | "customerName">> = {
          leadId,
        };
        if (body.phone) patch.phone = String(body.phone);
        if (body.email) patch.email = String(body.email);
        if (body.customerName) patch.customerName = String(body.customerName);
        const conv = await patchConversation(legacyDynamo, conversationId, patch);
        if (conv) {
          await appendLeadGolpe(leadId, {
            channel: conv.channel,
            direction: "in",
            text: conv.lastMessagePreview || "(conversación social)",
          });
        }
        return ok({ conversation: conv });
      }
      if (body.action === "unlink") {
        const conv = await patchConversation(legacyDynamo, conversationId, { leadId: "" });
        return ok({ conversation: conv });
      }

      // reply (DM directo), replyComment (público) y commentToDm (privado) comparten
      // la resolución de token + el manejo de errores de Meta.
      if (
        body.action === "reply" ||
        body.action === "replyComment" ||
        body.action === "commentToDm"
      ) {
        const text = String(body.text || "").trim();
        if (!text) return bad(400, "text requerido");
        const conv = await getConversation(legacyDynamo, conversationId);
        if (!conv) return bad(404, "conversación no encontrada");
        const { token, pageId, waPhoneId } = await getTenantMeta(tenantId);
        if (!token) return bad(400, "Meta no configurado para este tenant");
        const actor = typeof body.actor === "string" ? body.actor : "agente";
        const isComment = conv.channel === "fb_comment";
        const isWhatsApp = conv.channel === "whatsapp";
        let outboundText = text; // lo que se loguea como mensaje saliente

        // El page token solo hace falta para IG/Messenger/comentarios (no WhatsApp).
        let pageToken = token;
        if (!isWhatsApp) {
          if (!pageId) return bad(400, "Meta (Página) no configurado para este tenant");
          pageToken = await resolvePageToken(token, pageId);
        }

        try {
          if (body.action === "replyComment") {
            if (!isComment || !conv.commentId) return bad(400, "no es un comentario");
            await replyToComment(conv.commentId, conv.platform || "facebook", pageToken, text);
            outboundText = `↩️ (público) ${text}`;
          } else if (body.action === "commentToDm" || (body.action === "reply" && isComment)) {
            // Comentario → privado: Send API por comment_id (FB) o private_replies (IG).
            if (!isComment || !conv.commentId) return bad(400, "no es un comentario");
            await privateReplyToComment(
              pageId!,
              conv.commentId,
              conv.platform || "facebook",
              pageToken,
              text,
            );
            await patchConversation(legacyDynamo, conversationId, { dmSent: true });
          } else if (isWhatsApp) {
            // WhatsApp (meta) → respuesta libre por la Cloud API (ventana 24h).
            if (!waPhoneId) return bad(400, "WhatsApp (meta) no configurado para este tenant");
            await sendWhatsApp(
              { mode: "meta", metaPhoneNumberId: waPhoneId, tenantId },
              {
                messaging_product: "whatsapp",
                to: conv.senderId,
                type: "text",
                text: { body: text },
              },
            );
          } else {
            // reply directo (IG DM / Messenger).
            await sendMetaMessage(pageId!, pageToken, conv.senderId, text);
          }
        } catch (e) {
          return bad(502, `Meta rechazó el envío: ${e instanceof Error ? e.message : "error"}`);
        }
        const updated = await appendOutbound(legacyDynamo, conversationId, outboundText, actor);
        // Golpe en el lead (Pilar 2) si la conversación está vinculada a una identidad.
        if (conv.leadId) {
          await appendLeadGolpe(conv.leadId, {
            channel: conv.channel,
            direction: "out",
            text,
            agent: actor,
          });
        }
        return ok({ conversation: updated, sent: true });
      }

      return bad(400, "acción inválida");
    }

    return bad(405, `Method not allowed: ${method}`);
  } catch (err) {
    console.error("manage-conversations error", err);
    return bad(500, err instanceof Error ? err.message : "internal error");
  }
};
