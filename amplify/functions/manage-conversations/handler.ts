import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { resolveTenantId, getIdentity, isLegacyTenant } from "../_shared/cognitoAuth";
import {
  listConversations,
  getConversation,
  appendOutbound,
  patchConversation,
  closeConversation,
  scanOpenConversations,
  setAssignee,
  typifyConversation,
  type Conversation,
} from "../_shared/conversations";
import { samePhone } from "../_shared/phone";
import { sendWhatsApp } from "../_shared/whatsappSend";
import { resolveMlSecret, answerQuestion, sendMlMessage } from "../_shared/mercadolibre";
import {
  normalizeMetaAccounts,
  findMetaAccount,
  readMetaSecret,
  pageTokenFor,
  type MetaAccount,
  type MetaConfig,
} from "../_shared/metaAccounts";

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
/** Auto-cierre por inactividad: una conversación `open` YA ATENDIDA (unread=0)
 *  cuyo último movimiento (updatedAt/lastMessageAt) tenga más de INACTIVITY_MINUTES
 *  (default 10) se cierra sola (closedReason "inactivity"). Lo dispara el reaper por
 *  EventBridge (cron) y también el sweep del GET list. Cierra por silencio DEL
 *  CLIENTE: si hay unread>0, el cliente espera al agente → NO se cierra. */
const INACTIVITY_MS = Number(process.env.INACTIVITY_MINUTES || 10) * 60 * 1000;

/** Label legible del canal para la línea de tiempo del lead (golpes · Pilar 2). */
const CH_LABEL: Record<string, string> = {
  instagram: "Instagram",
  messenger: "Messenger",
  whatsapp: "WhatsApp",
  fb_comment: "Comentario",
  mercadolibre: "Mercado Libre",
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

/** Lead por id (GetItem). Para refrescar el nombre de una conversación YA
 *  vinculada sin re-escanear (uniformización del nombre: el lead manda). */
async function getLeadById(leadId: string): Promise<LeadLite | null> {
  if (!leadId) return null;
  try {
    const r = await legacyDynamo.send(
      new GetItemCommand({ TableName: LEADS_TABLE, Key: { leadId: { S: leadId } } }),
    );
    return r.Item ? (unmarshall(r.Item) as LeadLite) : null;
  } catch (e) {
    console.warn("getLeadById falló", (e as Error).message);
    return null;
  }
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

/**
 * Sweep de inactividad: recorre la lista y cierra en sitio las conversaciones
 * `open` sin actividad por más de INACTIVITY_MS (usa updatedAt, cae a
 * lastMessageAt). Persiste SOLO las que cruzan el umbral (un update por vencida,
 * en paralelo); las ya-closed no se re-escriben. Muta los items de la lista para
 * devolverlos ya cerrados. Best-effort: un fallo de persistencia no rompe el GET.
 */
async function sweepInactive(conversations: Conversation[], tenantId: string): Promise<void> {
  const nowMs = Date.now();
  const nowIso = new Date().toISOString();
  const expired = conversations.filter((c) => {
    if (c.status !== "open") return false;
    // No cierres leads SIN ATENDER: si hay mensajes no leídos el cliente está
    // esperando respuesta y el agente todavía no los vio → dejar abierta para
    // no perder el lead. El auto-cierre por inactividad es para conversaciones
    // ya atendidas (leídas) donde el cliente no volvió.
    if ((c.unread || 0) > 0) return false;
    const last = Date.parse(c.updatedAt || c.lastMessageAt || "");
    if (Number.isNaN(last)) return false;
    return nowMs - last > INACTIVITY_MS;
  });
  if (!expired.length) return;
  await Promise.all(
    expired.map(async (c) => {
      // Aviso de cortesía ANTES de cerrar (best-effort; solo canales con envío y
      // si está habilitado). Va dentro de la ventana de 24h; si el canal lo
      // rechaza, se ignora. NO debe romper el cierre.
      if (COURTESY_ENABLED) {
        try {
          await sendCourtesyMessage(tenantId, c, COURTESY_MSG);
          await appendOutbound(legacyDynamo, c.conversationId, COURTESY_MSG, "ARIA");
        } catch (e) {
          console.warn(
            "sweepInactive: aviso de cortesía no enviado",
            c.conversationId,
            (e as Error).message,
          );
        }
      }
      // Muta el item de la lista (se devuelve ya cerrado) …
      c.status = "closed";
      c.closedReason = "inactivity";
      c.closedAt = nowIso;
      c.assignee = "bot";
      c.ownerAgentId = undefined;
      c.ownerAgentName = undefined;
      // … y persiste el cierre UNIFICADO (suelta el dueño → reabre limpio con bot).
      try {
        // BUG-A2: cierre condicional a que no se haya reactivado entre el scan y
        // ahora (pasa el updatedAt visto → si un inbound la tocó, no la cierra).
        await closeConversation(legacyDynamo, c.conversationId, "inactivity", c.updatedAt);
      } catch (e) {
        console.warn("sweepInactive: cierre no persistió", c.conversationId, (e as Error).message);
      }
    }),
  );
}
const CORS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({
  statusCode: c,
  headers: CORS,
  body: JSON.stringify({ error: e }),
});

/**
 * SEC-C2 (IDOR del inbox omnicanal): la tabla `connectview-conversations` es
 * POOLED y los ids son determinísticos (`whatsapp#<telefono>`, `messenger#<psid>`…),
 * así que cualquier tenant podría adivinar el id de la conversación de OTRO y
 * operarla (GET/reply/typify/assign/close/…). Este guard compara el `tenantId`
 * DUEÑO de la conversación contra el `tenantId` verificado del solicitante.
 *
 * · `conv.tenantId` presente y distinto → NO pasa (return false).
 * · `conv.tenantId` ausente → filas ANTIGUAS de Novasys legacy sin dueño: las
 *   dejamos pasar para no romper la retrocompat (los inbounds nuevos ya persisten
 *   tenantId, así que a futuro estas filas se vuelven raras).
 *
 * Los callers deben responder `bad(404, …)` (NO 403) para no confirmar que la
 * conversación existe.
 */
function assertTenant(conv: Conversation | null | undefined, tenantId: string): boolean {
  if (!conv) return false;
  if (conv.tenantId && conv.tenantId !== tenantId) return false;
  return true;
}

async function getTenantMeta(tenantId: string): Promise<{
  token?: string;
  pageId?: string;
  waPhoneId?: string;
  accounts: MetaAccount[];
}> {
  let token: string | undefined, pageId: string | undefined, waPhoneId: string | undefined;
  let accounts: MetaAccount[] = [];
  try {
    const it = await legacyDynamo.send(
      new GetItemCommand({ TableName: CONNECTIONS_TABLE, Key: { tenantId: { S: tenantId } } }),
    );
    if (it.Item) {
      const cfg = JSON.parse(unmarshall(it.Item).configJson || "{}");
      pageId = cfg.meta?.pageId; // legacy singular (fallback)
      accounts = normalizeMetaAccounts(cfg.meta as MetaConfig);
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
  return { token, pageId, waPhoneId, accounts };
}

/**
 * Resuelve la PÁGINA desde la que responder una conversación de IG/Messenger/
 * comentario y su page token (multi-cuenta). Elige la cuenta RECEPTORA
 * (`conv.metaAccountId`) entre las conectadas; si no hay match, la primera; y por
 * último la legacy única. El page token sale del secret multi-cuenta
 * (connectview/tenant/<id>/meta); si no está (tenant legacy), se deriva del
 * system token con resolvePageToken. Devuelve null si no hay página/token.
 */
async function resolveMetaAccount(
  tenantId: string,
  conv: Conversation,
): Promise<{ pageId: string; pageToken: string } | null> {
  const meta = await getTenantMeta(tenantId);
  const acct =
    (conv.metaAccountId && findMetaAccount(meta.accounts, conv.metaAccountId)) ||
    meta.accounts[0] ||
    null;
  const pageId = acct?.pageId || meta.pageId;
  if (!pageId) return null;
  // 1) Page token guardado (flujo "Conectar con Facebook").
  try {
    const secret = await readMetaSecret(sm, tenantId);
    const pt = pageTokenFor(secret, pageId);
    if (pt) return { pageId, pageToken: pt };
  } catch {
    /* seguimos al fallback legacy */
  }
  // 2) Legacy: derivar el page token del system token del tenant.
  if (!meta.token) return null;
  const pageToken = await resolvePageToken(meta.token, pageId);
  return { pageId, pageToken };
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

/** Media (imagen/audio/video/documento) por el Send API del Page (Messenger/IG).
 *  Meta espera attachment.payload.url + is_reusable. `type` es el genérico de Meta
 *  (image/audio/video/file). WhatsApp NO usa este camino (va por whatsappSend). */
async function sendMetaMediaMessage(
  pageId: string,
  pageToken: string,
  recipientId: string,
  metaType: "image" | "audio" | "video" | "file",
  url: string,
): Promise<void> {
  await graphPost(`${pageId}/messages`, pageToken, {
    recipient: { id: recipientId },
    messaging_type: "RESPONSE",
    message: {
      attachment: { type: metaType, payload: { url, is_reusable: true } },
    },
  });
}

/** sender_action del Send API (Messenger/IG): typing_on / typing_off / mark_seen.
 *  `mark_seen` = recibo de lectura hacia el cliente. Best-effort en el caller. */
async function sendMetaSenderAction(
  pageId: string,
  pageToken: string,
  recipientId: string,
  action: "mark_seen" | "typing_on" | "typing_off",
): Promise<void> {
  await graphPost(`${pageId}/messages`, pageToken, {
    recipient: { id: recipientId },
    sender_action: action,
  });
}

/** Nuestro `mediaType` de negocio → tipo genérico de attachment de Meta (Send API).
 *  WhatsApp usa el mismo string ("image"/"audio"/"video"/"document") como `type`. */
function metaAttachmentType(mediaType: string): "image" | "audio" | "video" | "file" {
  if (mediaType === "image") return "image";
  if (mediaType === "audio") return "audio";
  if (mediaType === "video") return "video";
  return "file"; // document → file en el Send API de Messenger/IG
}

/**
 * Recibo de LECTURA hacia el cliente (markRead). Elige el mecanismo por canal:
 *   · WhatsApp   → POST /messages { status:"read", message_id } (necesita el id del
 *                  último inbound; si no lo tenemos, se omite sin romper).
 *   · Messenger/IG → sender_action "mark_seen".
 *   · fb_comment / mercadolibre → no aplica (no-op).
 * Lanza si el canal soportado falla; el caller es fail-open.
 */
async function sendReadReceipt(tenantId: string, conv: Conversation): Promise<void> {
  if (conv.channel === "whatsapp") {
    if (!conv.lastInboundMessageId) return; // sin id del inbound → no hay recibo posible
    const { token, waPhoneId } = await getTenantMeta(tenantId);
    if (!token || !waPhoneId) return;
    await sendWhatsApp(
      { mode: "meta", metaPhoneNumberId: waPhoneId, tenantId },
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: conv.lastInboundMessageId,
      },
    );
    return;
  }
  if (conv.channel === "instagram" || conv.channel === "messenger") {
    const acct = await resolveMetaAccount(tenantId, conv);
    if (!acct) return;
    await sendMetaSenderAction(acct.pageId, acct.pageToken, conv.senderId, "mark_seen");
    return;
  }
  // fb_comment / mercadolibre → sin recibo de lectura.
}

/**
 * Encuesta de cierre hacia el cliente (close?.survey). Reutiliza el envío
 * interactivo según el canal:
 *   · WhatsApp   → botones quick-reply (≤3 opciones) o lista (>3), tappables.
 *   · Messenger/IG → mensaje de texto con las opciones numeradas.
 *   · fb_comment / mercadolibre → no-op (no hay envío interactivo apropiado).
 * Lanza si el envío del canal soportado falla; el caller es best-effort.
 */
async function sendSurvey(
  tenantId: string,
  conv: Conversation,
  bodyTxt: string,
  options: string[],
): Promise<void> {
  const opts = options.slice(0, 10);
  if (conv.channel === "whatsapp") {
    const { token, waPhoneId } = await getTenantMeta(tenantId);
    if (!token || !waPhoneId) return;
    const body = bodyTxt.slice(0, 1024);
    let interactive: Record<string, unknown>;
    if (opts.length <= 3) {
      // Botones quick-reply (máx 3, título ≤20 chars).
      interactive = {
        type: "button",
        body: { text: body },
        action: {
          buttons: opts.map((o, i) => ({
            type: "reply",
            reply: { id: `survey_${i}`, title: o.slice(0, 20) },
          })),
        },
      };
    } else {
      // Lista tappable (título de fila ≤24 chars).
      interactive = {
        type: "list",
        body: { text: body },
        action: {
          button: "Responder",
          sections: [
            {
              rows: opts.map((o, i) => ({ id: `survey_${i}`, title: o.slice(0, 24) })),
            },
          ],
        },
      };
    }
    await sendWhatsApp(
      { mode: "meta", metaPhoneNumberId: waPhoneId, tenantId },
      { messaging_product: "whatsapp", to: conv.senderId, type: "interactive", interactive },
    );
    return;
  }
  if (conv.channel === "instagram" || conv.channel === "messenger") {
    const acct = await resolveMetaAccount(tenantId, conv);
    if (!acct) return;
    const numbered = `${bodyTxt}\n\n${opts.map((o, i) => `${i + 1}. ${o}`).join("\n")}`;
    await sendMetaMessage(acct.pageId, acct.pageToken, conv.senderId, numbered.slice(0, 2000));
    return;
  }
  // fb_comment / mercadolibre → sin encuesta interactiva.
}

/**
 * Envía un mensaje de TEXTO simple por el canal del cliente (WhatsApp o
 * Messenger/IG). Reutilizado por el aviso de cortesía del auto-cierre. Lanza si
 * el canal soportado falla (el caller es best-effort); no-op para comentarios/ML.
 */
async function sendCourtesyMessage(
  tenantId: string,
  conv: Conversation,
  text: string,
): Promise<void> {
  if (conv.channel === "whatsapp") {
    const { token, waPhoneId } = await getTenantMeta(tenantId);
    if (!token || !waPhoneId) return;
    await sendWhatsApp(
      { mode: "meta", metaPhoneNumberId: waPhoneId, tenantId },
      {
        messaging_product: "whatsapp",
        to: conv.senderId,
        type: "text",
        text: { body: text.slice(0, 1024) },
      },
    );
    return;
  }
  if (conv.channel === "instagram" || conv.channel === "messenger") {
    const acct = await resolveMetaAccount(tenantId, conv);
    if (!acct) return;
    await sendMetaMessage(acct.pageId, acct.pageToken, conv.senderId, text.slice(0, 2000));
    return;
  }
  // fb_comment / mercadolibre → sin envío de texto libre.
}

/**
 * Aviso de cortesía del auto-cierre por inactividad. Configurable por tenant vía
 * env `INACTIVITY_COURTESY_MSG` (pon "off" para desactivarlo). Se envía dentro
 * de la ventana de 24h (a 30min de inactividad siempre lo está); si el canal lo
 * rechaza (p.ej. fuera de ventana) el caller lo ignora. Solo canales con envío.
 */
const COURTESY_MSG =
  process.env.INACTIVITY_COURTESY_MSG ??
  "Cerramos esta conversación por inactividad, pero seguimos aquí para ayudarte 🙂. Escribinos cuando quieras y con gusto te atendemos.";
const COURTESY_ENABLED = !!COURTESY_MSG && COURTESY_MSG.trim().toLowerCase() !== "off";

/**
 * Reaper de inactividad — lo dispara la EventBridge rule `connectview-conversation-reaper`
 * (~cada 5min, server-to-server sin JWT). Scan GLOBAL de conversaciones `open` (todos
 * los tenants, tabla pooled): cierra las YA ATENDIDAS (unread=0) sin movimiento hace
 * más de INACTIVITY_MS, con aviso de cortesía best-effort. Cierre UNIFICADO (suelta el
 * dueño → el próximo inbound reabre limpio con el bot). Antes esto SOLO corría cuando
 * un agente abría el inbox (sweep del GET); ahora corre solo.
 */
async function reapInactiveConversations(): Promise<{ scanned: number; closed: number }> {
  const nowMs = Date.now();
  const open = await scanOpenConversations(legacyDynamo);
  const expired = open.filter((c) => {
    if ((c.unread || 0) > 0) return false; // el cliente espera al agente → no cerrar
    const last = Date.parse(c.updatedAt || c.lastMessageAt || "");
    return !Number.isNaN(last) && nowMs - last > INACTIVITY_MS;
  });
  let closed = 0;
  await Promise.all(
    expired.map(async (c) => {
      if (COURTESY_ENABLED && c.tenantId) {
        try {
          await sendCourtesyMessage(c.tenantId, c, COURTESY_MSG);
          await appendOutbound(legacyDynamo, c.conversationId, COURTESY_MSG, "ARIA");
        } catch (e) {
          console.warn("reaper: cortesía no enviada", c.conversationId, (e as Error).message);
        }
      }
      try {
        // BUG-A2: cierre condicional a que no se haya reactivado entre el scan y
        // ahora (pasa el updatedAt visto → si un inbound la tocó, no la cierra).
        await closeConversation(legacyDynamo, c.conversationId, "inactivity", c.updatedAt);
        closed++;
      } catch (e) {
        console.warn("reaper: cierre no persistió", c.conversationId, (e as Error).message);
      }
    }),
  );
  console.log(
    `reaper: ${open.length} open · ${closed} cerradas por inactividad (>${INACTIVITY_MS / 60000}min)`,
  );
  return { scanned: open.length, closed };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  // Reaper de inactividad (EventBridge cron): cierra conversaciones abiertas ya
  // atendidas sin respuesta del cliente hace >INACTIVITY_MS. Server-to-server (sin
  // JWT) → se intercepta ANTES del auth. Global (todos los tenants, tabla pooled).
  if (event?.reaper) {
    try {
      const r = await reapInactiveConversations();
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, ...r }) };
    } catch (e) {
      console.error("reaper falló:", (e as Error).message);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "reaper" }) };
    }
  }

  const params = event.queryStringParameters || {};
  const tenantId = await resolveTenantId(event?.headers);
  if (!tenantId) return bad(401, "no autorizado");

  // Identidad del solicitante (para ownership por agente). El tenantId ya vino de
  // este mismo token verificado, así que getIdentity no debería lanzar; aún así
  // lo blindamos (fail-safe: sin identidad → agente anónimo sin privilegios).
  let identity = null;
  try {
    identity = await getIdentity(event?.headers);
  } catch {
    /* token raro: tratamos como agente sin privilegios */
  }
  const me = identity?.email || identity?.username || identity?.sub || "";
  const myName = identity?.name || identity?.username || identity?.email || "Agente";
  const privileged = !!identity?.groups?.some((g) => g === "Admins" || g === "Supervisors");

  try {
    if (method === "GET") {
      if (params.conversationId) {
        let conv = await getConversation(legacyDynamo, String(params.conversationId));
        // SEC-C2: guard de IDOR. La conversación de OTRO tenant se trata como
        // inexistente (404, no 403 → no confirmamos que exista).
        if (!assertTenant(conv, tenantId)) return bad(404, "conversación no encontrada");
        // Auto-vínculo perezoso + REFRESCO del nombre (Fase C / uniformización):
        // el nombre del LEAD es la fuente de verdad. Si hay teléfono, resolvemos el
        // lead (por leadId si ya está vinculada, o por teléfono si no) y refrescamos
        // `customerName` para que el inbox no quede con el nombre viejo cacheado.
        if (conv && conv.phone) {
          const wasLinked = !!conv.leadId;
          const lead = wasLinked
            ? await getLeadById(conv.leadId!)
            : await findLeadByPhone(conv.phone);
          if (lead?.leadId) {
            const patch: Partial<Pick<Conversation, "leadId" | "customerName">> = {};
            if (!wasLinked) patch.leadId = lead.leadId;
            if (lead.name && lead.name !== conv.customerName) patch.customerName = lead.name;
            if (Object.keys(patch).length) {
              conv = (await patchConversation(legacyDynamo, conv.conversationId, patch)) || conv;
            }
            // El golpe de vínculo se registra SOLO la primera vez (al vincular).
            if (!wasLinked && conv?.leadId) {
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
      // SEC-C1: el listado se filtra por el `tenantId` verificado. Novasys legacy
      // ve también las filas antiguas sin `tenantId`; un tenant real solo las suyas.
      const conversations = await listConversations(legacyDynamo, {
        limit: 500,
        tenantId,
        legacy: isLegacyTenant(tenantId),
      });
      // Auto-cierre por inactividad ANTES de devolver: cierra (y persiste) las
      // `open` vencidas (con aviso de cortesía); la lista sale ya con "Cerrado".
      await sweepInactive(conversations, tenantId);
      // Ownership por agente: admin/supervisor ven TODO; un agente solo ve las
      // suyas (ownerAgentId === me) + la cola sin dueño (sin ownerAgentId). Las
      // tomadas por OTRO agente se ocultan. El `unread` total se calcula SOBRE la
      // lista ya filtrada (para no contar chats de otros agentes).
      const visible = privileged
        ? conversations
        : conversations.filter((c) => !c.ownerAgentId || c.ownerAgentId === me);
      const unread = visible.reduce((n, c) => n + (c.unread || 0), 0);
      return ok({ conversations: visible, unread });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const conversationId = String(body.conversationId || "");
      if (!conversationId) return bad(400, "conversationId requerido");

      if (body.action === "markRead") {
        // SEC-C2: verificar dueño ANTES de mutar (patchConversation no chequea tenant).
        const target = await getConversation(legacyDynamo, conversationId);
        if (!assertTenant(target, tenantId)) return bad(404, "conversación no encontrada");
        // 1) marcar leída localmente (como siempre).
        const conv = await patchConversation(legacyDynamo, conversationId, { unread: 0 });
        // 2) recibo de lectura HACIA EL CLIENTE cuando el canal lo soporta.
        //    Fail-open: cualquier error del recibo NO rompe el markRead.
        if (conv) {
          try {
            await sendReadReceipt(tenantId, conv);
          } catch (e) {
            console.warn("read receipt falló (fail-open):", (e as Error).message);
          }
        }
        return ok({ conversation: conv });
      }
      if (body.action === "close") {
        // Encuesta de cierre opcional: si viene `survey`, la enviamos ANTES de
        // cerrar (reutiliza el envío interactivo por canal). Degrada elegante.
        const conv = await getConversation(legacyDynamo, conversationId);
        if (!assertTenant(conv, tenantId)) return bad(404, "conversación no encontrada");
        const survey = body.survey as { body?: string; options?: unknown } | undefined;
        const surveyBody = String(survey?.body || "").trim();
        const surveyOptions = Array.isArray(survey?.options)
          ? (survey!.options as unknown[]).map((o) => String(o)).filter(Boolean)
          : [];
        if (surveyBody && surveyOptions.length) {
          try {
            await sendSurvey(tenantId, conv, surveyBody, surveyOptions);
          } catch (e) {
            // La encuesta es best-effort: si el canal la rechaza, igual cerramos.
            console.warn("encuesta de cierre falló (best-effort):", (e as Error).message);
          }
        }
        // Cierre UNIFICADO: además de status=closed, suelta el dueño → el próximo
        // inbound del cliente reabre limpio con el bot. reason "manual" = lo cerró
        // un agente desde el inbox.
        const updated = await closeConversation(legacyDynamo, conversationId, "manual");
        return ok({ conversation: updated });
      }

      // Tipificar la conversación (disposition) + opcionalmente cerrarla. Si la
      // conversación tiene identidad (leadId / phone), añade un golpe "gestion" al
      // historial del lead (Pilar 2). Todo degrada elegante: el golpe no rompe la
      // tipificación.
      if (body.action === "typify") {
        const d = (body.disposition || {}) as {
          stageId?: unknown;
          stageLabel?: unknown;
          valoracion?: unknown;
          tags?: unknown;
          notes?: unknown;
        };
        const stageId = String(d.stageId || "").trim();
        const stageLabel = String(d.stageLabel || "").trim();
        if (!stageId || !stageLabel)
          return bad(400, "disposition.stageId y disposition.stageLabel son requeridos");
        const agent = typeof body.agent === "string" ? body.agent : "agente";
        const tags = Array.isArray(d.tags)
          ? (d.tags as unknown[]).map((t) => String(t)).filter(Boolean)
          : undefined;
        const valoracion =
          typeof d.valoracion === "string" && d.valoracion ? d.valoracion : undefined;
        const notes = typeof d.notes === "string" && d.notes ? d.notes : undefined;

        // SEC-C2: verificar dueño antes de tipificar (typifyConversation no chequea).
        if (!assertTenant(await getConversation(legacyDynamo, conversationId), tenantId))
          return bad(404, "conversación no encontrada");
        let conv = await typifyConversation(legacyDynamo, conversationId, {
          stageId,
          stageLabel,
          valoracion,
          tags,
          notes,
          agent,
        });
        if (!conv) return bad(404, "conversación no encontrada");

        // Golpe canónico en el lead (Pilar 2). Best-effort: solo si hay leadId.
        // (Si la conversación tiene phone pero no leadId, el auto-vínculo perezoso
        //  del GET ?conversationId= ya materializa el leadId antes de tipificar.)
        if (conv.leadId) {
          const golpeText = [stageLabel, notes].filter(Boolean).join(" — ");
          await appendLeadGolpe(conv.leadId, {
            channel: conv.channel,
            direction: "out",
            text: golpeText,
            agent,
          });
        }

        // Cierre opcional tras tipificar (closedReason "manual").
        if (body.closeAfter) {
          conv =
            (await patchConversation(legacyDynamo, conversationId, {
              status: "closed",
              closedReason: "manual",
              closedAt: new Date().toISOString(),
            })) || conv;
        }
        return ok({ conversation: conv });
      }

      // Reasignar quién atiende (bot ↔ agent) sin enviar nada.
      //   · assignee="agent" (TOMAR)  → el que toma es el del token: se vuelve
      //     dueño (ownerAgentId = me, ownerAgentName = myName).
      //   · assignee="bot"   (DEVOLVER A LA IA) → limpia el dueño (vuelve a la
      //     cola/bot: ownerAgentId/ownerAgentName = undefined).
      if (body.action === "assign") {
        const assignee = body.assignee === "agent" ? "agent" : body.assignee === "bot" ? "bot" : "";
        if (!assignee) return bad(400, "assignee inválido (bot|agent)");
        // SEC-C2: no reasignar la conversación de otro tenant.
        if (!assertTenant(await getConversation(legacyDynamo, conversationId), tenantId))
          return bad(404, "conversación no encontrada");
        const patch: Partial<Pick<Conversation, "assignee" | "ownerAgentId" | "ownerAgentName">> =
          assignee === "agent"
            ? { assignee, ownerAgentId: me, ownerAgentName: myName }
            : { assignee, ownerAgentId: undefined, ownerAgentName: undefined };
        const conv = await patchConversation(legacyDynamo, conversationId, patch);
        if (!conv) return bad(404, "conversación no encontrada");
        return ok({ conversation: conv });
      }

      // Traspasar / derivar la conversación a OTRO agente (ownership → agentId).
      // Cualquier agente o privilegiado puede traspasar. Queda en modo "agente".
      if (body.action === "assignTo") {
        const agentId = String(body.agentId || "").trim();
        if (!agentId) return bad(400, "agentId requerido");
        // SEC-C2: no traspasar la conversación de otro tenant.
        if (!assertTenant(await getConversation(legacyDynamo, conversationId), tenantId))
          return bad(404, "conversación no encontrada");
        const agentName =
          typeof body.agentName === "string" && body.agentName.trim()
            ? body.agentName.trim()
            : agentId;
        const conv = await patchConversation(legacyDynamo, conversationId, {
          assignee: "agent",
          ownerAgentId: agentId,
          ownerAgentName: agentName,
        });
        if (!conv) return bad(404, "conversación no encontrada");
        return ok({ conversation: conv });
      }

      // Soltar a la cola de agentes (sin dueño): limpia el dueño pero mantiene
      // assignee="agent" (queda disponible para que otro agente la tome).
      if (body.action === "release") {
        // SEC-C2: no soltar a la cola la conversación de otro tenant.
        if (!assertTenant(await getConversation(legacyDynamo, conversationId), tenantId))
          return bad(404, "conversación no encontrada");
        const conv = await patchConversation(legacyDynamo, conversationId, {
          assignee: "agent",
          ownerAgentId: undefined,
          ownerAgentName: undefined,
        });
        if (!conv) return bad(404, "conversación no encontrada");
        return ok({ conversation: conv });
      }

      // Vincular / desvincular identidad (Fase C). El agente elige un lead; o se
      // auto-vincula por teléfono. Al vincular, registra el toque entrante (golpe).
      if (body.action === "link") {
        const leadId = String(body.leadId || "");
        if (!leadId) return bad(400, "leadId requerido");
        // SEC-C2: no vincular identidades en la conversación de otro tenant.
        if (!assertTenant(await getConversation(legacyDynamo, conversationId), tenantId))
          return bad(404, "conversación no encontrada");
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
        // SEC-C2: no desvincular en la conversación de otro tenant.
        if (!assertTenant(await getConversation(legacyDynamo, conversationId), tenantId))
          return bad(404, "conversación no encontrada");
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
        // SEC-C2: guard de IDOR cross-tenant (404, no confirma existencia). Va
        // ANTES del chequeo de ownership por agente (que es intra-tenant).
        if (!assertTenant(conv, tenantId)) return bad(404, "conversación no encontrada");
        // Defensa de ownership: no puedes responder el chat de OTRO agente. Si la
        // conversación tiene dueño y no eres tú (ni eres admin/supervisor), 403.
        // (No aplica a assignTo/release/markRead — esos sí pueden reasignarla.)
        if (conv.ownerAgentId && conv.ownerAgentId !== me && !privileged)
          return bad(403, "owned_by_other");
        // Defensa: no se responde en una conversación cerrada (el frontend ya lo
        // gatea; esto blinda el backend). Solo aplica al reply directo — los
        // flujos de comentario (replyComment/commentToDm) no dependen de la
        // ventana de conversación. Para reabrir cerrada se usa sendTemplate (HSM).
        if (body.action === "reply" && conv.status === "closed")
          return bad(409, "conversation_closed");

        // Mercado Libre (F4.1): reply por la API de ML (no Meta). Una PREGUNTA se
        // responde con POST /answers; un MENSAJE post-venta con /messages/packs/…
        if (conv.channel === "mercadolibre" && body.action === "reply") {
          const actorMl = typeof body.actor === "string" ? body.actor : "agente";
          const secret = await resolveMlSecret(tenantId);
          if (!secret?.accessToken)
            return bad(400, "Mercado Libre no está conectado para este tenant");
          const ml = conv.ml;
          if (!ml) return bad(400, "conversación de ML sin contexto (ml)");
          try {
            if (ml.kind === "question") {
              if (!ml.questionId) return bad(400, "falta el questionId de la pregunta");
              await answerQuestion(secret.accessToken, ml.questionId, text);
            } else {
              if (!ml.packId || !ml.sellerId) return bad(400, "faltan packId/sellerId del mensaje");
              await sendMlMessage(
                secret.accessToken,
                ml.packId,
                ml.sellerId,
                ml.buyerId || conv.senderId,
                text,
              );
            }
          } catch (e) {
            return bad(
              502,
              `Mercado Libre rechazó el envío: ${e instanceof Error ? e.message : "error"}`,
            );
          }
          let updatedMl = await appendOutbound(legacyDynamo, conversationId, text, actorMl);
          // Un humano respondió → la atiende el agente.
          updatedMl = (await setAssignee(legacyDynamo, conversationId, "agent")) || updatedMl;
          if (conv.leadId) {
            await appendLeadGolpe(conv.leadId, {
              channel: conv.channel,
              direction: "out",
              text,
              agent: actorMl,
            });
          }
          return ok({ conversation: updatedMl, sent: true });
        }

        const actor = typeof body.actor === "string" ? body.actor : "agente";
        const isComment = conv.channel === "fb_comment";
        const isWhatsApp = conv.channel === "whatsapp";
        let outboundText = text; // lo que se loguea como mensaje saliente

        // Resolvemos con qué credenciales responder según el canal:
        //  · WhatsApp        → system token del tenant + waPhoneId (Cloud API).
        //  · IG/Messenger/FB → la PÁGINA RECEPTORA de esta conversación (multi-
        //    cuenta) con SU page token; fallback a la cuenta legacy única.
        let pageId = "";
        let pageToken = "";
        let waPhoneId: string | undefined;
        if (isWhatsApp) {
          const meta = await getTenantMeta(tenantId);
          if (!meta.token) return bad(400, "Meta no configurado para este tenant");
          waPhoneId = meta.waPhoneId;
        } else {
          const acct = await resolveMetaAccount(tenantId, conv);
          if (!acct) return bad(400, "Meta (Página) no configurado para este tenant");
          pageId = acct.pageId;
          pageToken = acct.pageToken;
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
              pageId,
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
            await sendMetaMessage(pageId, pageToken, conv.senderId, text);
          }
        } catch (e) {
          return bad(502, `Meta rechazó el envío: ${e instanceof Error ? e.message : "error"}`);
        }
        let updated = await appendOutbound(legacyDynamo, conversationId, outboundText, actor);
        // Un humano respondió por el DM directo → la atiende el agente. (No aplica
        // a replyComment/commentToDm, que son flujos de comentario.)
        if (body.action === "reply") {
          updated = (await setAssignee(legacyDynamo, conversationId, "agent")) || updated;
        }
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

      // Enviar un ADJUNTO (imagen/audio/video/documento) al canal correcto.
      //   WhatsApp: type=mediaType con { link, caption? } por la Cloud API.
      //   Messenger/IG: attachment con payload.url por el Send API.
      //   Comentarios FB/IG y Mercado Libre no soportan media saliente → error claro.
      if (body.action === "sendMedia") {
        const conv = await getConversation(legacyDynamo, conversationId);
        // SEC-C2: guard de IDOR cross-tenant antes del ownership por agente.
        if (!assertTenant(conv, tenantId)) return bad(404, "conversación no encontrada");
        // Defensa de ownership: no puedes mandar adjuntos en el chat de OTRO agente.
        if (conv.ownerAgentId && conv.ownerAgentId !== me && !privileged)
          return bad(403, "owned_by_other");
        // Defensa: no se envían adjuntos en una conversación cerrada (para reabrir
        // fuera de ventana lo único permitido es sendTemplate / HSM).
        if (conv.status === "closed") return bad(409, "conversation_closed");
        const mediaUrl = String(body.mediaUrl || "").trim();
        const mediaType = String(body.mediaType || "");
        const caption = typeof body.caption === "string" ? body.caption : "";
        const filename = typeof body.filename === "string" ? body.filename : "";
        const actor = typeof body.actor === "string" ? body.actor : "agente";
        if (!mediaUrl) return bad(400, "mediaUrl requerido");
        if (!["image", "audio", "video", "document"].includes(mediaType))
          return bad(400, "mediaType inválido (image|audio|video|document)");

        try {
          if (conv.channel === "whatsapp") {
            const { token, waPhoneId } = await getTenantMeta(tenantId);
            if (!token) return bad(400, "Meta no configurado para este tenant");
            if (!waPhoneId) return bad(400, "WhatsApp (meta) no configurado para este tenant");
            // WhatsApp Cloud API: { type, [type]: { link, caption?, filename? } }.
            // audio NO admite caption; document admite filename.
            const media: Record<string, unknown> = { link: mediaUrl };
            if (mediaType !== "audio" && caption) media.caption = caption.slice(0, 1024);
            if (mediaType === "document" && filename) media.filename = filename.slice(0, 240);
            await sendWhatsApp(
              { mode: "meta", metaPhoneNumberId: waPhoneId, tenantId },
              {
                messaging_product: "whatsapp",
                to: conv.senderId,
                type: mediaType,
                [mediaType]: media,
              },
            );
          } else if (conv.channel === "instagram" || conv.channel === "messenger") {
            const acct = await resolveMetaAccount(tenantId, conv);
            if (!acct) return bad(400, "Meta (Página) no configurado para este tenant");
            await sendMetaMediaMessage(
              acct.pageId,
              acct.pageToken,
              conv.senderId,
              metaAttachmentType(mediaType),
              mediaUrl,
            );
            // El Send API no manda caption junto al attachment; si hay, va aparte.
            if (caption) await sendMetaMessage(acct.pageId, acct.pageToken, conv.senderId, caption);
          } else {
            return bad(400, `el canal ${conv.channel} no soporta adjuntos salientes`);
          }
        } catch (e) {
          return bad(502, `Meta rechazó el envío: ${e instanceof Error ? e.message : "error"}`);
        }

        // Log del saliente con el attachment + caption como texto.
        const updated = await appendOutbound(legacyDynamo, conversationId, caption || "", actor, {
          type: mediaType,
          url: mediaUrl,
        });
        if (conv.leadId) {
          await appendLeadGolpe(conv.leadId, {
            channel: conv.channel,
            direction: "out",
            text: caption || `[${mediaType}]`,
            agent: actor,
          });
        }
        return ok({ conversation: updated, sent: true });
      }

      // Enviar una PLANTILLA HSM (solo WhatsApp) por la Cloud API. Para reabrir
      // la ventana de 24h o mandar utilitarios. Otros canales → error claro.
      if (body.action === "sendTemplate") {
        const conv = await getConversation(legacyDynamo, conversationId);
        // SEC-C2: guard de IDOR cross-tenant.
        if (!assertTenant(conv, tenantId)) return bad(404, "conversación no encontrada");
        if (conv.channel !== "whatsapp")
          return bad(400, "las plantillas HSM son solo para WhatsApp");
        const templateName = String(body.templateName || "").trim();
        const language = String(body.language || "").trim();
        const bodyParams = Array.isArray(body.bodyParams)
          ? (body.bodyParams as unknown[]).map((p) => String(p))
          : [];
        const actor = typeof body.actor === "string" ? body.actor : "agente";
        if (!templateName) return bad(400, "templateName requerido");
        if (!language) return bad(400, "language requerido (ej. es, es_MX, en_US)");

        const { token, waPhoneId } = await getTenantMeta(tenantId);
        if (!token || !waPhoneId)
          return bad(400, "WhatsApp (meta) no configurado para este tenant");

        // components solo si hay parámetros de cuerpo.
        const template: Record<string, unknown> = {
          name: templateName,
          language: { code: language },
        };
        if (bodyParams.length) {
          template.components = [
            { type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) },
          ];
        }
        try {
          await sendWhatsApp(
            { mode: "meta", metaPhoneNumberId: waPhoneId, tenantId },
            { messaging_product: "whatsapp", to: conv.senderId, type: "template", template },
          );
        } catch (e) {
          return bad(502, `Meta rechazó el envío: ${e instanceof Error ? e.message : "error"}`);
        }
        // Render legible del saliente: [Plantilla: nombre] + params.
        const rendered =
          `[Plantilla: ${templateName}]` + (bodyParams.length ? ` ${bodyParams.join(" · ")}` : "");
        const updated = await appendOutbound(legacyDynamo, conversationId, rendered, actor);
        if (conv.leadId) {
          await appendLeadGolpe(conv.leadId, {
            channel: conv.channel,
            direction: "out",
            text: rendered,
            agent: actor,
          });
        }
        return ok({ conversation: updated, sent: true });
      }

      // Fase 4 · F4.2a — enviar un LIST interactivo (menú tappable) por WhatsApp.
      if (body.action === "sendListInteractive") {
        const conv = await getConversation(legacyDynamo, conversationId);
        // SEC-C2: guard de IDOR cross-tenant.
        if (!assertTenant(conv, tenantId)) return bad(404, "conversación no encontrada");
        if (conv.channel !== "whatsapp")
          return bad(400, "el list interactivo es solo para WhatsApp");
        const { token, waPhoneId } = await getTenantMeta(tenantId);
        if (!token || !waPhoneId)
          return bad(400, "WhatsApp (meta) no configurado para este tenant");
        const actor = typeof body.actor === "string" ? body.actor : "agente";
        const bodyTxt = String(body.body || "").trim();
        const rowsIn = Array.isArray(body.rows) ? body.rows : [];
        const rows = rowsIn.slice(0, 10).map((r: Record<string, unknown>, i: number) => ({
          id: String(r.id || `row_${i}`).slice(0, 200),
          title: String(r.title || `Opción ${i + 1}`).slice(0, 24),
          ...(r.description ? { description: String(r.description).slice(0, 72) } : {}),
        }));
        if (!bodyTxt || !rows.length) return bad(400, "body y al menos una fila son requeridos");
        const interactive: Record<string, unknown> = {
          type: "list",
          body: { text: bodyTxt.slice(0, 4096) },
          action: {
            button: String(body.button || "Ver opciones").slice(0, 20),
            sections: [{ rows }],
          },
        };
        if (body.header)
          interactive.header = { type: "text", text: String(body.header).slice(0, 60) };
        if (body.footer) interactive.footer = { text: String(body.footer).slice(0, 60) };
        try {
          await sendWhatsApp(
            { mode: "meta", metaPhoneNumberId: waPhoneId, tenantId },
            { messaging_product: "whatsapp", to: conv.senderId, type: "interactive", interactive },
          );
        } catch (e) {
          return bad(502, `Meta rechazó el envío: ${e instanceof Error ? e.message : "error"}`);
        }
        const summary = `📋 Lista enviada: “${bodyTxt}” (${rows.length} opciones)`;
        const updated = await appendOutbound(legacyDynamo, conversationId, summary, actor);
        if (conv.leadId) {
          await appendLeadGolpe(conv.leadId, {
            channel: conv.channel,
            direction: "out",
            text: summary,
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
