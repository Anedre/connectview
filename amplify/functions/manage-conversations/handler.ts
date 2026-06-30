import type { Handler } from "aws-lambda";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { resolveTenantId } from "../_shared/cognitoAuth";
import {
  listConversations,
  getConversation,
  appendOutbound,
  patchConversation,
} from "../_shared/conversations";

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
const GRAPH = "https://graph.facebook.com/v20.0";
const CORS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({
  statusCode: c,
  headers: CORS,
  body: JSON.stringify({ error: e }),
});

async function getTenantMeta(tenantId: string): Promise<{ token?: string; pageId?: string }> {
  let token: string | undefined, pageId: string | undefined;
  try {
    const it = await legacyDynamo.send(
      new GetItemCommand({ TableName: CONNECTIONS_TABLE, Key: { tenantId: { S: tenantId } } }),
    );
    if (it.Item) {
      const cfg = JSON.parse(unmarshall(it.Item).configJson || "{}");
      pageId = cfg.meta?.pageId;
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
  return { token, pageId };
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
        const conv = await getConversation(legacyDynamo, String(params.conversationId));
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
        const { token, pageId } = await getTenantMeta(tenantId);
        if (!token || !pageId) return bad(400, "Meta no configurado para este tenant");
        const pageToken = await resolvePageToken(token, pageId);
        const actor = typeof body.actor === "string" ? body.actor : "agente";
        const isComment = conv.channel === "fb_comment";

        try {
          if (body.action === "replyComment") {
            if (!isComment || !conv.commentId) return bad(400, "no es un comentario");
            await replyToComment(conv.commentId, conv.platform || "facebook", pageToken, text);
            const updated = await appendOutbound(
              legacyDynamo,
              conversationId,
              `↩️ (público) ${text}`,
              actor,
            );
            return ok({ conversation: updated, sent: true });
          }
          if (body.action === "commentToDm" || (body.action === "reply" && isComment)) {
            // Comentario → privado: Send API por comment_id (FB) o private_replies (IG).
            if (!isComment || !conv.commentId) return bad(400, "no es un comentario");
            await privateReplyToComment(
              pageId,
              conv.commentId,
              conv.platform || "facebook",
              pageToken,
              text,
            );
            await patchConversation(legacyDynamo, conversationId, { dmSent: true });
            const updated = await appendOutbound(legacyDynamo, conversationId, text, actor);
            return ok({ conversation: updated, sent: true });
          }
          // reply directo (IG DM / Messenger).
          await sendMetaMessage(pageId, pageToken, conv.senderId, text);
        } catch (e) {
          return bad(502, `Meta rechazó el envío: ${e instanceof Error ? e.message : "error"}`);
        }
        const updated = await appendOutbound(legacyDynamo, conversationId, text, actor);
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
