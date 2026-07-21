/**
 * conversations — modelo del inbox omnicanal (Pilar 6 · R13). Una conversación
 * por (canal, remitente): IG DM, Messenger, comentario, WhatsApp. Mensajes
 * append-only en el item (cap 200). Lo usan `meta-messaging-webhook` (inbound) y
 * `manage-conversations` (lista/thread/reply). Tabla pooled `connectview-conversations`.
 */
import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  type PutItemCommandInput,
  ScanCommand,
  UpdateItemCommand,
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
  return (text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
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
  "eres un bot",
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
  /** BUG-audit P1-#7: revisión para optimistic locking. Cada escritura la
   *  incrementa y la condiciona a que no haya cambiado desde la lectura → dos
   *  webhooks concurrentes ya no se pisan (mensaje perdido / unread mal). */
  rev?: number;
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

/**
 * BUG-audit P1-#7: escribe la conversación incrementando `rev`. El `guard`
 * habilita el optimistic locking: `undefined` = incondicional (retrocompat);
 * `{rev:null}` = debe NO existir (creación); `{rev:N}` = `rev` debe seguir en N
 * (nadie la tocó desde la lectura). Lanza ConditionalCheckFailedException en
 * conflicto → `mutateConversation` reintenta. */
async function put(
  dynamo: DynamoDBClient,
  conv: Conversation,
  guard?: { rev: number | null | undefined },
): Promise<void> {
  conv.rev = (conv.rev ?? 0) + 1;
  const cmd: PutItemCommandInput = {
    TableName: CONV_TABLE,
    Item: marshall(conv, { removeUndefinedValues: true }),
  };
  if (guard) {
    if (guard.rev === null) {
      cmd.ConditionExpression = "attribute_not_exists(conversationId)"; // debe ser NUEVA
    } else if (guard.rev === undefined) {
      // Item LEGACY: existe pero sin `rev` (creado antes de este cambio). El guard
      // `rev = 0` fallaría (el atributo está AUSENTE, no vale 0) → la primera
      // mutación de toda conversación previa reintentaría en vano. `attribute_not_exists`
      // deja pasar exactamente al primer escritor que le pone rev; el resto reintenta.
      cmd.ConditionExpression = "attribute_not_exists(rev)";
    } else {
      cmd.ConditionExpression = "rev = :grev";
      cmd.ExpressionAttributeValues = marshall({ ":grev": guard.rev });
    }
  }
  await dynamo.send(new PutItemCommand(cmd));
}

/**
 * BUG-audit P1-#7: aplica una mutación a una conversación con optimistic
 * locking + reintentos. Lee → `apply(cur)` (síncrono y RE-EJECUTABLE, sobre el
 * estado fresco) → escribe condicional a que `rev` no cambió. Si otro escritor
 * ganó, re-lee y re-aplica (hasta `maxTries`). `apply` devuelve el conv mutado o
 * `null` para no escribir (p.ej. la conversación no existe). El caller resuelve
 * FUERA cualquier trabajo async (lookups) y lo pasa capturado a `apply`. */
async function mutateConversation(
  dynamo: DynamoDBClient,
  conversationId: string,
  apply: (cur: Conversation | null) => Conversation | null,
  maxTries = 8,
): Promise<Conversation | null> {
  for (let i = 0; i < maxTries; i++) {
    const cur = await getConversation(dynamo, conversationId);
    const next = apply(cur);
    if (!next) return null;
    try {
      // cur=null → creación (guard attribute_not_exists). cur con rev=N → `rev=N`.
      // cur SIN rev (legacy) → cur.rev es undefined → guard attribute_not_exists(rev).
      await put(dynamo, next, { rev: cur ? cur.rev : null });
      return next;
    } catch (err) {
      if (
        (err as { name?: string })?.name === "ConditionalCheckFailedException" &&
        i < maxTries - 1
      ) {
        // Backoff con jitter: bajo una ráfaga concurrente sobre la MISMA conversación
        // espacia los reintentos → evita el thundering-herd y converge sin agotar.
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 12) * (i + 1)));
        continue; // otro escritor tocó la conversación → re-leer y re-aplicar
      }
      throw err;
    }
  }
  return null;
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
    /** Lead ya resuelto por el caller (auto-vínculo). Persiste `conv.leadId`. */
    leadId?: string;
  },
  /** Opcional: resolver el lead por teléfono para AUTO-VINCULAR la conversación
   *  (persiste `leadId` + `customerName`) sin que el agente lo haga a mano. Solo
   *  se invoca cuando hay teléfono, aún no hay lead vinculado, y la conversación
   *  es nueva o el teléfono se acaba de detectar → evita scanear en cada mensaje
   *  de un número desconocido. El caller inyecta el resolver ya con el dynamo del
   *  tenant activo (getLeadByPhone), así este módulo no acopla con leadSync. */
  opts?: {
    resolveLead?: (phone: string) => Promise<{ leadId?: string; name?: string } | null>;
  },
): Promise<Conversation> {
  const cid = convId(m.channel, m.senderId);
  const now = m.ts || new Date().toISOString();
  // Teléfono candidato, DETERMINISTA desde `m` (no depende del estado leído): en
  // WhatsApp el remitente ES el teléfono; en otros canales, lo que el cliente
  // haya escrito en el texto. Se usa para decidir/ejecutar el auto-vínculo.
  const hint = extractContact(m.text || "");
  const waPhone =
    m.channel === "whatsapp"
      ? normalizePhone(m.senderId)?.e164 || `+${m.senderId.replace(/\D/g, "")}`
      : undefined;
  const candidatePhone = waPhone || hint.phone;

  // ── Auto-vínculo al lead por teléfono (async, UNA sola vez) ────────────────
  // BUG-audit P1-#7: el resolve es async y NO puede vivir dentro del retry loop
  // (el `apply` debe ser síncrono y re-ejecutable). Lo resolvemos aquí, guiados
  // por una lectura previa; el `apply` re-verifica `!c.leadId` antes de usarlo,
  // así que si otro inbound concurrente ya vinculó, no lo pisamos. Solo cuando
  // hay teléfono y la conversación aún no tiene lead ni teléfono conocidos → no
  // scaneamos leads en cada mensaje de un número ya identificado.
  let resolvedLead: { leadId?: string; name?: string } | null = null;
  if (candidatePhone && opts?.resolveLead) {
    const pre = await getConversation(dynamo, cid);
    if (!pre?.leadId && !pre?.phone) {
      try {
        resolvedLead = await opts.resolveLead(candidatePhone);
      } catch {
        /* best-effort: sin vínculo automático, el agente puede hacerlo a mano */
      }
    }
  }

  const conv = await mutateConversation(dynamo, cid, (cur) => {
    const c = cur || blank(m.channel, m.senderId, now, m.tenantId);
    c.messages = [
      ...(c.messages || []).slice(-199),
      { id: randomUUID(), direction: "in", text: m.text, ts: now, attachment: m.attachment },
    ];
    if (m.messageId) c.lastInboundMessageId = m.messageId;
    if (m.metaAccountId) c.metaAccountId = m.metaAccountId;
    c.unread = (c.unread || 0) + 1;
    c.lastMessageAt = now;
    c.lastMessagePreview = (m.text || "").slice(0, 120) || "[adjunto]";
    if (m.customerName) c.customerName = m.customerName;
    if (m.leadId && !c.leadId) c.leadId = m.leadId;
    // SEC-C1: persistimos el `tenantId` del webhook receptor (dueño de la fila en
    // la tabla pooled) para que el listado pueda filtrar por tenant. Novasys legacy
    // pasa "" (fila sin dueño) → queda sin `tenantId` y el listado legacy la incluye.
    if (m.tenantId) c.tenantId = m.tenantId;
    // Fase C: si el cliente escribió su teléfono/email en el DM, lo guardamos como
    // pista de identidad para auto-vincular después (no pisa lo ya conocido).
    if (hint.phone && !c.phone) c.phone = hint.phone;
    if (hint.email && !c.email) c.email = hint.email;
    // En WhatsApp el remitente ES el teléfono → identidad directa (auto-vínculo).
    if (m.channel === "whatsapp" && !c.phone && waPhone) c.phone = waPhone;
    // Aplica el lead ya resuelto (si aún no hay vínculo). El nombre del lead solo
    // pisa un `customerName` ausente o que no aporta (era el senderId crudo); un
    // nombre real ya resuelto (p.ej. de Graph) gana.
    if (resolvedLead?.leadId && !c.leadId) c.leadId = resolvedLead.leadId;
    if (resolvedLead?.name && (!c.customerName || c.customerName === m.senderId)) {
      c.customerName = resolvedLead.name;
    }
    // Regla de negocio: una conversación cerrada SOLO se reabre cuando el cliente
    // escribe. Al reabrir, el bot atiende primero de nuevo (assignee="bot"),
    // se registra `reopenedAt` y se limpia el motivo/instante de cierre. Si ya
    // estaba abierta, NO tocamos assignee (respeta que un humano la tomara).
    if (c.status === "closed") {
      c.status = "open";
      c.assignee = "bot";
      c.reopenedAt = now;
      c.closedReason = undefined;
      c.closedAt = undefined;
      // Reabrir LIMPIO: soltar el dueño anterior. Si un agente la cerró (o se cerró
      // por inactividad tras una derivación), al reabrir vuelve al bot SIN quedar
      // pegada a ese agente — si no, el bot/Agente IA no la volvía a atender.
      c.ownerAgentId = undefined;
      c.ownerAgentName = undefined;
      c.assignedAgent = undefined;
    }
    c.updatedAt = now;
    return c;
  });
  // `apply` nunca devuelve null aquí (siempre upserta) → mutateConversation
  // devuelve la conversación. El `?? ` es un fallback defensivo por el tipo.
  return conv ?? blank(m.channel, m.senderId, now, m.tenantId);
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
  const conv = await mutateConversation(dynamo, convId("fb_comment", m.fromId), (cur) => {
    const c = cur || blank("fb_comment", m.fromId, now, m.tenantId);
    if (m.metaAccountId) c.metaAccountId = m.metaAccountId;
    c.messages = [
      ...(c.messages || []).slice(-199),
      { id: randomUUID(), direction: "in", text: m.text, ts: now },
    ];
    c.unread = (c.unread || 0) + 1;
    c.lastMessageAt = now;
    c.lastMessagePreview = (m.text || "").slice(0, 120) || "[comentario]";
    if (m.fromName) c.customerName = m.fromName;
    if (m.tenantId) c.tenantId = m.tenantId;
    c.platform = m.platform;
    c.commentId = m.commentId;
    c.postId = m.postId;
    c.dmSent = false;
    c.status = "open";
    c.updatedAt = now;
    return c;
  });
  return conv ?? blank("fb_comment", m.fromId, now, m.tenantId);
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
  const hint = extractContact(m.text || "");
  const conv = await mutateConversation(dynamo, convId("mercadolibre", m.buyerId), (cur) => {
    const c = cur || blank("mercadolibre", m.buyerId, now, m.tenantId);
    c.messages = [
      ...(c.messages || []).slice(-199),
      { id: randomUUID(), direction: "in", text: m.text, ts: now },
    ];
    c.unread = (c.unread || 0) + 1;
    c.lastMessageAt = now;
    c.lastMessagePreview = (m.text || "").slice(0, 120) || "[pregunta]";
    if (m.customerName) c.customerName = m.customerName;
    if (m.tenantId) c.tenantId = m.tenantId;
    c.ml = { ...m.ml, buyerId: m.buyerId };
    // Pista de identidad si el comprador dejó teléfono/email en el texto.
    if (hint.phone && !c.phone) c.phone = hint.phone;
    if (hint.email && !c.email) c.email = hint.email;
    c.status = "open";
    c.updatedAt = now;
    return c;
  });
  return conv ?? blank("mercadolibre", m.buyerId, now, m.tenantId);
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
  const now = new Date().toISOString();
  return mutateConversation(dynamo, conversationId, (cur) => {
    if (!cur) return null;
    cur.messages = [
      ...(cur.messages || []).slice(-199),
      { id: randomUUID(), direction: "out", text, ts: now, agent, attachment },
    ];
    cur.unread = 0;
    cur.lastMessageAt = now;
    cur.lastMessagePreview = (text || "").slice(0, 120) || (attachment ? "[adjunto]" : "");
    cur.assignedAgent = agent || cur.assignedAgent;
    cur.updatedAt = now;
    return cur;
  });
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
  const now = new Date().toISOString();
  return mutateConversation(dynamo, conversationId, (cur) => {
    if (!cur) return null;
    Object.assign(cur, patch, { updatedAt: now });
    return cur;
  });
}

/**
 * Cierre UNIFICADO de una conversación. Lo usan los 3 disparadores: el botón del
 * agente humano (manage-conversations `close`), el fin del Agente IA/bot (webhook,
 * reason="resolved") y el reaper de inactividad (reason="inactivity"). Marca
 * status="closed" + motivo/instante y SUELTA el dueño (ownerAgentId/Name +
 * assignedAgent) dejando assignee="bot" → así el próximo inbound del cliente la
 * reabre LIMPIA (el bot vuelve a atender, sin quedar pegada al agente anterior).
 * null si la conversación no existe. Idempotente (cerrar una cerrada no rompe).
 *
 * BUG-A2 (cierre condicional): el reaper escanea las `open` y luego cierra; entre
 * el scan y el cierre un inbound del cliente puede REABRIR/tocar la conversación.
 * Para no cerrarla por error, el caller (reaper) pasa `expectedUpdatedAt` con el
 * `updatedAt` QUE VIO en el scan: si al momento de escribir el `updatedAt` ya
 * cambió (alguien la tocó), la condición falla y NO cerramos (devolvemos null,
 * silencioso). Los cierres MANUALES / del bot NO pasan `expectedUpdatedAt` → se
 * cierran incondicionalmente como siempre (retrocompatible). */
export async function closeConversation(
  dynamo: DynamoDBClient,
  conversationId: string,
  reason: "manual" | "inactivity" | "resolved" = "manual",
  expectedUpdatedAt?: string,
): Promise<Conversation | null> {
  // Cierre incondicional (manual / bot): ruta original vía Put — sin condición.
  if (!expectedUpdatedAt) {
    return patchConversation(dynamo, conversationId, {
      status: "closed",
      closedReason: reason,
      closedAt: new Date().toISOString(),
      assignee: "bot",
      ownerAgentId: undefined,
      ownerAgentName: undefined,
      assignedAgent: undefined,
    });
  }
  // Cierre CONDICIONAL (reaper de inactividad): solo si nadie la tocó desde el
  // scan (`updatedAt` intacto). UpdateItem quirúrgico (no reescribe el item
  // entero) que setea el cierre y REMUEVE el dueño, con ConditionExpression.
  const now = new Date().toISOString();
  try {
    const r = await dynamo.send(
      new UpdateItemCommand({
        TableName: CONV_TABLE,
        Key: { conversationId: { S: conversationId } },
        UpdateExpression:
          "SET #s = :closed, closedReason = :reason, closedAt = :now, assignee = :bot, updatedAt = :now " +
          "ADD rev :one " +
          "REMOVE ownerAgentId, ownerAgentName, assignedAgent",
        ConditionExpression: "updatedAt = :expected",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: marshall({
          ":closed": "closed",
          ":reason": reason,
          ":now": now,
          ":bot": "bot",
          ":expected": expectedUpdatedAt,
          // BUG-audit P1-#7: bump de `rev` para que un mutador concurrente con el
          // `rev` viejo detecte el cierre (su put condicional falla → reintenta y
          // re-lee el estado cerrado) en vez de pisarlo con una lectura obsoleta.
          ":one": 1,
        }),
        ReturnValues: "ALL_NEW",
      }),
    );
    return r.Attributes ? (unmarshall(r.Attributes) as Conversation) : null;
  } catch (err) {
    // La condición falló → la conversación se reactivó entre el scan y el cierre
    // (llegó un inbound): NO la cerramos. Salida silenciosa (esto es lo esperado).
    if ((err as { name?: string })?.name === "ConditionalCheckFailedException") return null;
    throw err;
  }
}

/** Scan de TODAS las conversaciones `open` (todos los tenants, tabla pooled). Para
 *  el reaper de inactividad (cron EventBridge), que corre sin un tenant en contexto.
 *  Pagina el scan; devuelve solo las `open`. */
export async function scanOpenConversations(dynamo: DynamoDBClient): Promise<Conversation[]> {
  const out: Conversation[] = [];
  let ESK: Record<string, unknown> | undefined;
  do {
    const r = await dynamo.send(
      new ScanCommand({
        TableName: CONV_TABLE,
        FilterExpression: "#s = :open",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: marshall({ ":open": "open" }),
        ExclusiveStartKey: ESK as never,
      }),
    );
    for (const it of r.Items || []) out.push(unmarshall(it) as Conversation);
    ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ESK);
  return out;
}

/**
 * BUG-audit P0-1/P0-4: dedup de eventos externos que se ENTREGAN MÁS DE UNA VEZ
 * (los webhooks de Meta reintentan si tardas en responder 200). Reserva una
 * clave una sola vez con un PutItem CONDICIONAL a un item namespaced de la
 * tabla de conversaciones (el rol de los webhooks ya tiene PutItem ahí, y
 * scanOpenConversations filtra por status="open" → estos marcadores nunca
 * aparecen como conversaciones). El TTL los limpia solos.
 *
 * Devuelve `true` si ESTA invocación ganó la reserva (debe procesar el evento),
 * `false` si ya se había procesado (retry → skip). FAIL-OPEN: si el propio
 * dedup falla (throttle/IAM), devuelve `true` — procesar posiblemente-doble es
 * preferible a PERDER el mensaje en silencio.
 */
export async function claimOnce(
  dynamo: DynamoDBClient,
  key: string,
  ttlSeconds = 86_400,
): Promise<boolean> {
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: CONV_TABLE,
        Item: {
          conversationId: { S: key },
          ttl: { N: String(Math.floor(Date.now() / 1000) + ttlSeconds) },
          _dedup: { BOOL: true },
        },
        ConditionExpression: "attribute_not_exists(conversationId)",
      }),
    );
    return true;
  } catch (err) {
    if ((err as { name?: string })?.name === "ConditionalCheckFailedException") return false;
    console.warn("claimOnce error (proceso igual, fail-open):", (err as Error)?.message);
    return true;
  }
}

/**
 * BUG-audit P1-#9: libera un claim de `claimOnce` (borra el marcador namespaced).
 * Lo usa el manejo de lote resiliente de los webhooks: si el procesamiento de un
 * ítem FALLA tras haberlo reclamado, liberamos su claim para que el REINTENTO de
 * Meta (disparado devolviendo no-200) lo vuelva a procesar en vez de saltarlo por
 * dedup. Best-effort: si el delete falla, el TTL lo limpia igual (a lo sumo el
 * ítem queda no-reintentable hasta expirar, que es el comportamiento previo). */
export async function releaseClaim(dynamo: DynamoDBClient, key: string): Promise<void> {
  try {
    await dynamo.send(
      new DeleteItemCommand({ TableName: CONV_TABLE, Key: { conversationId: { S: key } } }),
    );
  } catch (err) {
    console.warn("releaseClaim error (best-effort):", (err as Error)?.message);
  }
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
  const ts = readAt || new Date().toISOString();
  const now = new Date().toISOString();
  return mutateConversation(dynamo, conversationId, (cur) => {
    if (!cur) return null;
    cur.messages = (cur.messages || []).map((msg) =>
      msg.direction === "out" && !msg.readAt ? { ...msg, readAt: ts } : msg,
    );
    // Guardamos siempre `lastCustomerReadAt` (aunque no haya saliente aún): sirve
    // para pintar "visto" incluso si el recibo llegó antes de registrar el saliente.
    cur.lastCustomerReadAt = ts;
    cur.updatedAt = now;
    return cur;
  });
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
  const typingUntil = new Date(Date.now() + ttlMs).toISOString();
  const now = new Date().toISOString();
  return mutateConversation(dynamo, conversationId, (cur) => {
    if (!cur) return null;
    cur.typingUntil = typingUntil;
    cur.updatedAt = now;
    return cur;
  });
}

/** Setea quién atiende AHORA (bot ↔ agent) + updatedAt. Muta el record en sitio
 *  y persiste. Devuelve la conversación actualizada o null si no existe. */
export async function setAssignee(
  dynamo: DynamoDBClient,
  conversationId: string,
  assignee: "bot" | "agent",
): Promise<Conversation | null> {
  const now = new Date().toISOString();
  return mutateConversation(dynamo, conversationId, (cur) => {
    if (!cur) return null;
    cur.assignee = assignee;
    cur.updatedAt = now;
    return cur;
  });
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
  return mutateConversation(dynamo, conversationId, (cur) => {
    if (!cur) return null;
    cur.dispositions = [...(cur.dispositions || []), entry];
    cur.lastDisposition = entry;
    cur.updatedAt = entry.ts;
    return cur;
  });
}

/**
 * Lista de conversaciones (scan, ordenada por último mensaje desc). Para el inbox.
 *
 * SEC-C1 (fuga cross-tenant): la tabla `connectview-conversations` es POOLED
 * (compartida entre tenants en modo Meta) y los ids son determinísticos
 * (`whatsapp#<telefono>`, `messenger#<psid>`…). El scan DEBE filtrarse por el
 * `tenantId` del solicitante o un tenant vería las conversaciones de otro.
 *
 * · `opts.tenantId` (verificado del JWT en el caller) → FilterExpression
 *   `tenantId = :t`.
 * · `opts.legacy: true` (Novasys/"default", el tenant fundador) → las filas
 *   ANTIGUAS pueden NO tener `tenantId` guardado. Para no dejar de mostrárselas,
 *   en modo legacy incluimos también los items SIN `tenantId`
 *   (`attribute_not_exists(tenantId) OR tenantId = :t`). Para un tenant REAL
 *   exigimos match exacto (nunca ve las filas sin dueño).
 *
 * Sin `tenantId` (no debería pasar: el caller siempre lo resuelve) devuelve
 * vacío — fail-closed, jamás el scan completo.
 */
export async function listConversations(
  dynamo: DynamoDBClient,
  opts: { limit?: number; tenantId?: string; legacy?: boolean } = {},
): Promise<Conversation[]> {
  const out: Conversation[] = [];
  const tenantId = opts.tenantId || "";
  // Fail-closed: sin tenant no devolvemos nada (evita el scan sin filtro).
  if (!tenantId) return out;
  // Legacy (Novasys): match exacto O filas viejas sin tenantId. Tenant real:
  // solo match exacto.
  const filter = opts.legacy ? "attribute_not_exists(tenantId) OR tenantId = :t" : "tenantId = :t";
  let ESK: Record<string, unknown> | undefined;
  try {
    do {
      const r = await dynamo.send(
        new ScanCommand({
          TableName: CONV_TABLE,
          FilterExpression: filter,
          ExpressionAttributeValues: marshall({ ":t": tenantId }),
          ExclusiveStartKey: ESK as never,
        }),
      );
      for (const it of r.Items || []) out.push(unmarshall(it) as Conversation);
      ESK = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ESK && out.length < (opts.limit || 500));
  } catch {
    /* tabla nueva / vacía */
  }
  return out.sort((a, b) => (b.lastMessageAt || "").localeCompare(a.lastMessageAt || ""));
}
