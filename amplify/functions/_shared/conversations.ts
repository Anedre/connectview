/**
 * conversations — modelo del inbox omnicanal (Pilar 6 · R13). Una conversación
 * por (canal, remitente): IG DM, Messenger, comentario, WhatsApp. Mensajes
 * append-only en el item (cap 200). Lo usan `meta-messaging-webhook` (inbound) y
 * `manage-conversations` (lista/thread/reply). Tabla pooled `connectview-conversations`.
 */
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "node:crypto";
import { normalizePhone } from "./phone";

/** Pistas de identidad en el texto de un DM (Fase C): teléfono / email que el
 *  cliente escribe ("mi número es 999…", "escríbeme a x@y.com"). Se usan para
 *  auto-vincular la conversación social a un lead/perfil por teléfono. */
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/;
export function extractContact(text: string): { phone?: string; email?: string } {
  const email = (text.match(EMAIL_RE)?.[0] || "").toLowerCase() || undefined;
  const phoneRaw = text.match(PHONE_RE)?.[0];
  const phone = phoneRaw ? normalizePhone(phoneRaw)?.e164 : undefined;
  return { phone: phone || undefined, email };
}

/** Normaliza para matching robusto: minúsculas + sin tildes/diacríticos. Así
 *  "Asesor", "asesór" y "ASESOR" caen todos en "asesor". */
function deburr(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Frases de intención "quiero un humano" (ya deburr-eadas: sin tildes, minúsculas). */
const HUMAN_PHRASES = [
  "hablar con alguien",
  "hablar con una persona",
  "hablar con un humano",
  "hablar con un asesor",
  "hablar con un agente",
  "hablar con un ejecutivo",
  "hablar con un representante",
  "quiero hablar con",
  "necesito hablar con",
  "con un humano",
  "con una persona",
  "con un asesor",
  "con un agente",
  "con un ejecutivo",
  "con un representante",
  "atencion humana",
  "atencion al cliente real",
  "persona real",
  "ser humano",
  "no bot",
  "no soy bot",
  "no quiero un bot",
  "no quiero hablar con un bot",
  "eres un bot",
  "sos un bot",
  "deja de responder",
];
/** Palabras sueltas que, por sí solas, señalan pedido de humano (deburr-eadas).
 *  Se matchean como palabra completa (\b) para no pegar dentro de otra palabra. */
const HUMAN_WORDS = [
  "asesor",
  "asesora",
  "humano",
  "humana",
  "ejecutivo",
  "ejecutiva",
  "representante",
  "operador",
  "operadora",
  "supervisor",
  "supervisora",
];

/**
 * ¿El cliente está pidiendo hablar con un humano? Detección robusta a tildes y
 * mayúsculas (deburr). Combina frases ("hablar con alguien", "con un asesor") y
 * palabras clave sueltas ("asesor", "humano", "agente"…). Pensado para engancharse
 * ANTES de que el bot IA genere su respuesta y así escalar a un agente humano.
 *
 * NOTA sobre "agente"/"persona": son ambiguas (el cliente puede describir su caso
 * con esas palabras). Solo cuentan cuando aparecen como pedido explícito ("con un
 * agente", "hablar con una persona"), que ya cubren las frases de HUMAN_PHRASES.
 */
export function wantsHuman(text: string): boolean {
  const t = deburr(text);
  if (!t.trim()) return false;
  if (HUMAN_PHRASES.some((p) => t.includes(p))) return true;
  return HUMAN_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(t));
}

const CONV_TABLE = process.env.CONVERSATIONS_TABLE || "connectview-conversations";

export type ConvChannel = "instagram" | "messenger" | "whatsapp" | "fb_comment" | "mercadolibre";

/** Contexto de Mercado Libre (F4.1) para responder por el endpoint correcto:
 *  una PREGUNTA se responde con POST /answers (question_id); un MENSAJE post-venta
 *  con POST /messages/packs/<packId>/sellers/<sellerId>. `buyerId` = senderId. */
export interface MlContext {
  kind: "question" | "message";
  questionId?: string;
  itemId?: string;
  packId?: string;
  sellerId?: string;
  buyerId?: string;
}

export interface ConvMessage {
  id: string;
  direction: "in" | "out";
  text: string;
  ts: string;
  agent?: string;
  attachment?: { type: string; url: string };
  /** Solo `out` — momento en que el CLIENTE leyó este mensaje (recibo de lectura
   *  de WhatsApp: statuses[].status==="read"). El hilo muestra el "visto ✓✓". */
  readAt?: string;
}
/** Tipificación (disposition) de una conversación — el agente marca en qué
 *  etapa del funnel quedó, con qué valoración y tags. Historial en
 *  `dispositions`; la más reciente cacheada en `lastDisposition` (para la lista).
 *  `stageId`/`stageLabel` se alinean con el árbol de dispositions unificado
 *  (connectview-taxonomies); `tags` puede llevar los sub-stages elegidos. */
export interface Disposition {
  id: string;
  stageId: string;
  stageLabel: string;
  valoracion?: string;
  tags?: string[];
  notes?: string;
  agent?: string;
  ts: string;
}
export interface Conversation {
  conversationId: string; // `${channel}#${senderId}`
  tenantId?: string;
  channel: ConvChannel;
  senderId: string;
  customerName?: string;
  status: "open" | "closed";
  /** Quién atiende AHORA (estado visible del inbox):
   *  · assignee="bot"   + status:"open"  → "Bot"    (el agente IA atiende)
   *  · assignee="agent" + status:"open"  → "Agente" (un humano atiende)
   *  · status:"closed"                    → "Cerrado"
   *  Un inbound reabre en "bot"; un reply/assign lo pasa a "agent". */
  assignee?: "bot" | "agent";
  /** Historial de tipificaciones (append) + la más reciente (para la lista). */
  dispositions?: Disposition[];
  lastDisposition?: Disposition;
  /** Cierre: por qué y cuándo se cerró, y cuándo se reabrió (inbound del cliente).
   *  · "manual"     — el agente cerró (o closeAfter en typify)
   *  · "inactivity" — auto-cierre por >30 min sin actividad (sweep del list)
   *  · "resolved"   — cierre marcado como resuelto */
  closedReason?: "manual" | "inactivity" | "resolved";
  closedAt?: string;
  reopenedAt?: string;
  unread: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  assignedAgent?: string;
  /** Ownership por agente (inbox omnicanal). Campo CANÓNICO de "de quién es este
   *  chat": el agente que TOMA la conversación se vuelve su dueño y a los DEMÁS
   *  agentes deja de aparecerles (admin/supervisor ven TODO). Ausente = sin
   *  dueño → cola compartida (visible para todos los agentes).
   *  · `ownerAgentId`   — EMAIL (o id) del agente-dueño.
   *  · `ownerAgentName` — nombre para mostrar en el badge.
   *  NO confundir con `assignedAgent` (legacy = "quién respondió último"). */
  ownerAgentId?: string;
  ownerAgentName?: string;
  /** Identidad unificada (Fase C): lead vinculado + teléfono/email cacheados
   *  (de WhatsApp, del texto del DM, o de un vínculo manual del agente). El
   *  panel "Cliente 360" del hilo usa el teléfono para traer perfil + golpes. */
  leadId?: string;
  phone?: string;
  email?: string;
  /** Solo `fb_comment` (Fase B): id del ÚLTIMO comentario (para responder en
   *  público), id del post, y la plataforma (FB vs IG → endpoints distintos de
   *  la Graph). `dmSent` evita mandar dos veces el private-reply. */
  commentId?: string;
  postId?: string;
  platform?: "facebook" | "instagram";
  dmSent?: boolean;
  /** Solo `mercadolibre` (F4.1): contexto para responder por el endpoint correcto. */
  ml?: MlContext;
  /** Meta multi-cuenta (Instagram/Messenger/comentarios): id de la CUENTA
   *  RECEPTORA (page id de Messenger/FB o IG business account id de Instagram)
   *  = `entry.id` del webhook. Permite responder DESDE la página correcta cuando
   *  el tenant conectó varias cuentas. Ausente → cae a la cuenta legacy única. */
  metaAccountId?: string;
  /** Read + typing entrantes (bandeja "en vivo"):
   *  · `lastInboundMessageId` — id del ÚLTIMO mensaje entrante (WhatsApp lo exige
   *    para mandar el read-receipt POST /messages status:read). Se guarda en cada
   *    inbound de WhatsApp; en otros canales no aplica.
   *  · `lastCustomerReadAt` — última vez que el cliente marcó leído (WhatsApp
   *    statuses[].status==="read"). El hilo pinta "visto".
   *  · `typingUntil` — instante (ISO) hasta el cual mostrar "escribiendo…" (typing
   *    entrante de Messenger/IG). WhatsApp Cloud API NO envía typing entrante. */
  lastInboundMessageId?: string;
  lastCustomerReadAt?: string;
  typingUntil?: string;
  messages: ConvMessage[];
  createdAt: string;
  updatedAt: string;
}

export const convId = (channel: string, senderId: string): string => `${channel}#${senderId}`;

export async function getConversation(
  dynamo: DynamoDBClient,
  conversationId: string,
): Promise<Conversation | null> {
  try {
    const r = await dynamo.send(
      new GetItemCommand({ TableName: CONV_TABLE, Key: { conversationId: { S: conversationId } } }),
    );
    return r.Item ? (unmarshall(r.Item) as Conversation) : null;
  } catch {
    return null;
  }
}

function blank(
  channel: ConvChannel,
  senderId: string,
  now: string,
  tenantId?: string,
): Conversation {
  return {
    conversationId: convId(channel, senderId),
    tenantId,
    channel,
    senderId,
    status: "open",
    assignee: "bot",
    unread: 0,
    lastMessageAt: now,
    lastMessagePreview: "",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function put(dynamo: DynamoDBClient, conv: Conversation): Promise<void> {
  await dynamo.send(
    new PutItemCommand({
      TableName: CONV_TABLE,
      Item: marshall(conv, { removeUndefinedValues: true }),
    }),
  );
}

/** Mensaje entrante (del cliente) → upsert de la conversación + unread++. */
export async function appendInbound(
  dynamo: DynamoDBClient,
  m: {
    channel: ConvChannel;
    senderId: string;
    text: string;
    customerName?: string;
    ts?: string;
    tenantId?: string;
    attachment?: { type: string; url: string };
    /** Id del mensaje en la plataforma (WhatsApp `messages[].id`). Se guarda como
     *  `lastInboundMessageId` para poder mandar el read-receipt luego. */
    messageId?: string;
    /** Meta multi-cuenta: id de la cuenta receptora (page/ig id = entry.id). */
    metaAccountId?: string;
  },
): Promise<Conversation> {
  const now = m.ts || new Date().toISOString();
  const conv =
    (await getConversation(dynamo, convId(m.channel, m.senderId))) ||
    blank(m.channel, m.senderId, now, m.tenantId);
  conv.messages = [
    ...(conv.messages || []).slice(-199),
    { id: randomUUID(), direction: "in", text: m.text, ts: now, attachment: m.attachment },
  ];
  if (m.messageId) conv.lastInboundMessageId = m.messageId;
  if (m.metaAccountId) conv.metaAccountId = m.metaAccountId;
  conv.unread = (conv.unread || 0) + 1;
  conv.lastMessageAt = now;
  conv.lastMessagePreview = (m.text || "").slice(0, 120) || "[adjunto]";
  if (m.customerName) conv.customerName = m.customerName;
  if (m.tenantId) conv.tenantId = m.tenantId;
  // Fase C: si el cliente escribió su teléfono/email en el DM, lo guardamos como
  // pista de identidad para auto-vincular después (no pisa lo ya conocido).
  const hint = extractContact(m.text || "");
  if (hint.phone && !conv.phone) conv.phone = hint.phone;
  if (hint.email && !conv.email) conv.email = hint.email;
  // En WhatsApp el remitente ES el teléfono → identidad directa (auto-vínculo).
  if (m.channel === "whatsapp" && !conv.phone) {
    conv.phone = normalizePhone(m.senderId)?.e164 || `+${m.senderId.replace(/\D/g, "")}`;
  }
  // Regla de negocio: una conversación cerrada SOLO se reabre cuando el cliente
  // escribe. Al reabrir, el bot atiende primero de nuevo (assignee="bot"),
  // se registra `reopenedAt` y se limpia el motivo/instante de cierre. Si ya
  // estaba abierta, NO tocamos assignee (respeta que un humano la tomara).
  if (conv.status === "closed") {
    conv.status = "open";
    conv.assignee = "bot";
    conv.reopenedAt = now;
    conv.closedReason = undefined;
    conv.closedAt = undefined;
  }
  conv.updatedAt = now;
  await put(dynamo, conv);
  return conv;
}

/**
 * Comentario entrante de FB/IG (Fase B) → upsert de una conversación `fb_comment`
 * agrupada por autor del comentario (`fb_comment#<from.id>`). Guarda el id del
 * ÚLTIMO comentario + post (para responder en público / pasar a privado) y
 * resetea `dmSent` (es un comentario nuevo). El texto entra como mensaje "in".
 */
export async function appendComment(
  dynamo: DynamoDBClient,
  m: {
    platform: "facebook" | "instagram";
    fromId: string;
    fromName?: string;
    text: string;
    commentId: string;
    postId?: string;
    ts?: string;
    tenantId?: string;
    /** Meta multi-cuenta: id de la cuenta receptora (page/ig id = entry.id). */
    metaAccountId?: string;
  },
): Promise<Conversation> {
  const now = m.ts || new Date().toISOString();
  const conv =
    (await getConversation(dynamo, convId("fb_comment", m.fromId))) ||
    blank("fb_comment", m.fromId, now, m.tenantId);
  if (m.metaAccountId) conv.metaAccountId = m.metaAccountId;
  conv.messages = [
    ...(conv.messages || []).slice(-199),
    { id: randomUUID(), direction: "in", text: m.text, ts: now },
  ];
  conv.unread = (conv.unread || 0) + 1;
  conv.lastMessageAt = now;
  conv.lastMessagePreview = (m.text || "").slice(0, 120) || "[comentario]";
  if (m.fromName) conv.customerName = m.fromName;
  if (m.tenantId) conv.tenantId = m.tenantId;
  conv.platform = m.platform;
  conv.commentId = m.commentId;
  conv.postId = m.postId;
  conv.dmSent = false;
  conv.status = "open";
  conv.updatedAt = now;
  await put(dynamo, conv);
  return conv;
}

/**
 * Entrante de Mercado Libre (F4.1) → upsert de una conversación `mercadolibre`
 * agrupada por el comprador (`mercadolibre#<buyerId>`). Guarda el contexto `ml`
 * (question vs message + ids) para poder responder por el endpoint correcto. El
 * texto entra como mensaje "in". Reusa la lógica común de `appendInbound`.
 */
export async function appendMlInbound(
  dynamo: DynamoDBClient,
  m: {
    buyerId: string;
    text: string;
    customerName?: string;
    ml: MlContext;
    ts?: string;
    tenantId?: string;
  },
): Promise<Conversation> {
  const now = m.ts || new Date().toISOString();
  const conv =
    (await getConversation(dynamo, convId("mercadolibre", m.buyerId))) ||
    blank("mercadolibre", m.buyerId, now, m.tenantId);
  conv.messages = [
    ...(conv.messages || []).slice(-199),
    { id: randomUUID(), direction: "in", text: m.text, ts: now },
  ];
  conv.unread = (conv.unread || 0) + 1;
  conv.lastMessageAt = now;
  conv.lastMessagePreview = (m.text || "").slice(0, 120) || "[pregunta]";
  if (m.customerName) conv.customerName = m.customerName;
  if (m.tenantId) conv.tenantId = m.tenantId;
  conv.ml = { ...m.ml, buyerId: m.buyerId };
  // Pista de identidad si el comprador dejó teléfono/email en el texto.
  const hint = extractContact(m.text || "");
  if (hint.phone && !conv.phone) conv.phone = hint.phone;
  if (hint.email && !conv.email) conv.email = hint.email;
  conv.status = "open";
  conv.updatedAt = now;
  await put(dynamo, conv);
  return conv;
}

/** Mensaje saliente (respuesta del agente) → append + unread=0. `attachment`
 *  opcional para salientes con media (imagen/audio/video/documento). */
export async function appendOutbound(
  dynamo: DynamoDBClient,
  conversationId: string,
  text: string,
  agent?: string,
  attachment?: { type: string; url: string },
): Promise<Conversation | null> {
  const conv = await getConversation(dynamo, conversationId);
  if (!conv) return null;
  const now = new Date().toISOString();
  conv.messages = [
    ...(conv.messages || []).slice(-199),
    { id: randomUUID(), direction: "out", text, ts: now, agent, attachment },
  ];
  conv.unread = 0;
  conv.lastMessageAt = now;
  conv.lastMessagePreview = (text || "").slice(0, 120) || (attachment ? "[adjunto]" : "");
  conv.assignedAgent = agent || conv.assignedAgent;
  conv.updatedAt = now;
  await put(dynamo, conv);
  return conv;
}

/** Marca leída / asigna / cierra / marca dmSent / typing / visto del cliente. */
export async function patchConversation(
  dynamo: DynamoDBClient,
  conversationId: string,
  patch: Partial<
    Pick<
      Conversation,
      | "unread"
      | "status"
      | "assignedAgent"
      | "assignee"
      | "ownerAgentId"
      | "ownerAgentName"
      | "dmSent"
      | "leadId"
      | "phone"
      | "email"
      | "customerName"
      | "typingUntil"
      | "lastCustomerReadAt"
      | "lastInboundMessageId"
      | "closedReason"
      | "closedAt"
      | "reopenedAt"
    >
  >,
): Promise<Conversation | null> {
  const conv = await getConversation(dynamo, conversationId);
  if (!conv) return null;
  Object.assign(conv, patch, { updatedAt: new Date().toISOString() });
  await put(dynamo, conv);
  return conv;
}

/**
 * Recibo de LECTURA entrante (WhatsApp statuses[].status==="read"): el cliente
 * leyó nuestros mensajes. Marca `readAt` en TODOS los mensajes salientes que aún
 * no lo tenían y setea `lastCustomerReadAt`. Best-effort (no rompe si no hay
 * conversación / mensajes). Devuelve la conversación actualizada o null.
 */
export async function markOutboundRead(
  dynamo: DynamoDBClient,
  conversationId: string,
  readAt?: string,
): Promise<Conversation | null> {
  const conv = await getConversation(dynamo, conversationId);
  if (!conv) return null;
  const ts = readAt || new Date().toISOString();
  conv.messages = (conv.messages || []).map((msg) =>
    msg.direction === "out" && !msg.readAt ? { ...msg, readAt: ts } : msg,
  );
  // Guardamos siempre `lastCustomerReadAt` (aunque no haya saliente aún): sirve
  // para pintar "visto" incluso si el recibo llegó antes de registrar el saliente.
  conv.lastCustomerReadAt = ts;
  conv.updatedAt = new Date().toISOString();
  await put(dynamo, conv);
  return conv;
}

/**
 * Typing entrante (Messenger/IG `sender_action:"typing_on"`): el cliente está
 * escribiendo. Marca `typingUntil` ~8s en el futuro; el hilo muestra "escribiendo…"
 * mientras `Date.now() < typingUntil`. Best-effort. NOTA: WhatsApp Cloud API NO
 * envía typing entrante, así que este helper solo se usa desde meta-messaging-webhook.
 */
export async function setTyping(
  dynamo: DynamoDBClient,
  conversationId: string,
  ttlMs = 8000,
): Promise<Conversation | null> {
  const conv = await getConversation(dynamo, conversationId);
  if (!conv) return null;
  conv.typingUntil = new Date(Date.now() + ttlMs).toISOString();
  conv.updatedAt = new Date().toISOString();
  await put(dynamo, conv);
  return conv;
}

/** Setea quién atiende AHORA (bot ↔ agent) + updatedAt. Muta el record en sitio
 *  y persiste. Devuelve la conversación actualizada o null si no existe. */
export async function setAssignee(
  dynamo: DynamoDBClient,
  conversationId: string,
  assignee: "bot" | "agent",
): Promise<Conversation | null> {
  const conv = await getConversation(dynamo, conversationId);
  if (!conv) return null;
  conv.assignee = assignee;
  conv.updatedAt = new Date().toISOString();
  await put(dynamo, conv);
  return conv;
}

/** Tipifica una conversación: genera el id de la disposition (randomUUID, como el
 *  resto del archivo), la empuja al historial `dispositions` (crea el array si no
 *  existe), setea `lastDisposition` (para la lista) y `updatedAt`. Persiste y
 *  devuelve la conversación actualizada o null si no existe. */
export async function typifyConversation(
  dynamo: DynamoDBClient,
  conversationId: string,
  disposition: {
    stageId: string;
    stageLabel: string;
    valoracion?: string;
    tags?: string[];
    notes?: string;
    agent?: string;
  },
): Promise<Conversation | null> {
  const conv = await getConversation(dynamo, conversationId);
  if (!conv) return null;
  const entry: Disposition = {
    id: randomUUID(),
    stageId: disposition.stageId,
    stageLabel: disposition.stageLabel,
    valoracion: disposition.valoracion,
    tags: disposition.tags,
    notes: disposition.notes,
    agent: disposition.agent,
    ts: new Date().toISOString(),
  };
  conv.dispositions = [...(conv.dispositions || []), entry];
  conv.lastDisposition = entry;
  conv.updatedAt = entry.ts;
  await put(dynamo, conv);
  return conv;
}

/** Lista de conversaciones (scan, ordenada por último mensaje desc). Para el inbox. */
export async function listConversations(
  dynamo: DynamoDBClient,
  opts: { limit?: number } = {},
): Promise<Conversation[]> {
  const out: Conversation[] = [];
  let ESK: Record<string, unknown> | undefined;
  try {
    do {
      const r = await dynamo.send(
        new ScanCommand({ TableName: CONV_TABLE, ExclusiveStartKey: ESK as never }),
      );
      for (const it of r.Items || []) out.push(unmarshall(it) as Conversation);
      ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ESK && out.length < (opts.limit || 500));
  } catch {
    /* tabla nueva / vacía */
  }
  return out.sort((a, b) => (b.lastMessageAt || "").localeCompare(a.lastMessageAt || ""));
}
