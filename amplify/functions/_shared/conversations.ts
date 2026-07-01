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
}
export interface Conversation {
  conversationId: string; // `${channel}#${senderId}`
  tenantId?: string;
  channel: ConvChannel;
  senderId: string;
  customerName?: string;
  status: "open" | "closed";
  unread: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  assignedAgent?: string;
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
  conv.status = "open";
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
  },
): Promise<Conversation> {
  const now = m.ts || new Date().toISOString();
  const conv =
    (await getConversation(dynamo, convId("fb_comment", m.fromId))) ||
    blank("fb_comment", m.fromId, now, m.tenantId);
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

/** Mensaje saliente (respuesta del agente) → append + unread=0. */
export async function appendOutbound(
  dynamo: DynamoDBClient,
  conversationId: string,
  text: string,
  agent?: string,
): Promise<Conversation | null> {
  const conv = await getConversation(dynamo, conversationId);
  if (!conv) return null;
  const now = new Date().toISOString();
  conv.messages = [
    ...(conv.messages || []).slice(-199),
    { id: randomUUID(), direction: "out", text, ts: now, agent },
  ];
  conv.unread = 0;
  conv.lastMessageAt = now;
  conv.lastMessagePreview = (text || "").slice(0, 120);
  conv.assignedAgent = agent || conv.assignedAgent;
  conv.updatedAt = now;
  await put(dynamo, conv);
  return conv;
}

/** Marca leída / asigna / cierra / marca dmSent. */
export async function patchConversation(
  dynamo: DynamoDBClient,
  conversationId: string,
  patch: Partial<
    Pick<
      Conversation,
      | "unread"
      | "status"
      | "assignedAgent"
      | "dmSent"
      | "leadId"
      | "phone"
      | "email"
      | "customerName"
    >
  >,
): Promise<Conversation | null> {
  const conv = await getConversation(dynamo, conversationId);
  if (!conv) return null;
  Object.assign(conv, patch, { updatedAt: new Date().toISOString() });
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
