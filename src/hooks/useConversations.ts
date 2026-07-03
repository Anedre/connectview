import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * useConversations — datos del inbox omnicanal (Pilar 6 · R13). Lee la lista y
 * el thread de `manage-conversations`, y expone las acciones (responder / marcar
 * leída / cerrar). La lista se refresca sola (poll) para sentirse en vivo sin
 * websockets; el thread abierto refresca más rápido.
 */
export type ConvChannel = "instagram" | "messenger" | "whatsapp" | "fb_comment" | "mercadolibre";

export interface ConvMessage {
  id: string;
  direction: "in" | "out";
  text: string;
  ts: string;
  agent?: string;
  attachment?: { type: string; url: string };
  /** ISO en que el CLIENTE leyó este mensaje saliente (read receipt de Meta) →
   *  el thread muestra "visto". Solo canales que lo soportan (WhatsApp/Messenger). */
  readAt?: string;
}

/** Tipificación aplicada a la conversación (misma taxonomía que el wrap-up de
 *  voz — Stage → Sub Stage). Se guarda en la conversación Y como golpe en el
 *  lead vinculado (Pilar 2 · ledger canónico). */
export interface ConvDisposition {
  id: string;
  stageId: string;
  stageLabel: string;
  subStageId?: string;
  subStageLabel?: string;
  valoracion?: string;
  tags?: string[];
  notes?: string;
  agent?: string;
  ts: string;
}

export interface Conversation {
  conversationId: string;
  tenantId?: string;
  channel: ConvChannel;
  senderId: string;
  customerName?: string;
  status: "open" | "closed";
  /** Quién atiende AHORA: el Agente IA (bot) o un humano (agent). El estado
   *  visible es Bot → Agente → Cerrado. Al reabrir por inbound vuelve a "bot". */
  assignee?: "bot" | "agent";
  /** Ownership por agente (email + nombre del dueño). Sin dueño = cola compartida
   *  (todos los agentes la ven); con dueño, solo ese agente (y admin/supervisor).
   *  El backend YA filtra la lista por rol; estos campos son para los badges. */
  ownerAgentId?: string;
  ownerAgentName?: string;
  /** Historial de tipificaciones + la más reciente (para la lista). */
  dispositions?: ConvDisposition[];
  lastDisposition?: ConvDisposition;
  /** Por qué/ cuándo se cerró (manual, por 30min de inactividad, resuelta) y
   *  cuándo se reabrió (inbound del cliente). */
  closedReason?: "manual" | "inactivity" | "resolved";
  closedAt?: string;
  reopenedAt?: string;
  unread: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  assignedAgent?: string;
  /** Identidad unificada (Fase C): lead vinculado + teléfono/email cacheados. */
  leadId?: string;
  phone?: string;
  email?: string;
  /** Solo `fb_comment` (Fase B): id del comentario + post + plataforma + si ya
   *  se pasó a privado (dmSent). */
  commentId?: string;
  postId?: string;
  platform?: "facebook" | "instagram";
  dmSent?: boolean;
  /** Solo `mercadolibre` (F4.1): tipo (pregunta/mensaje) + ids para responder. */
  ml?: {
    kind: "question" | "message";
    questionId?: string;
    itemId?: string;
    packId?: string;
    sellerId?: string;
    buyerId?: string;
  };
  messages?: ConvMessage[];
  /** ISO hasta el cual mostrar "escribiendo…" (typing entrante — solo IG/
   *  Messenger; WhatsApp Cloud API no emite typing). */
  typingUntil?: string;
  /** ISO del último read receipt del cliente (respaldo cuando no viene por msg). */
  lastCustomerReadAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Lista de conversaciones + total no-leídas. Refresca cada 12s. */
export function useConversations() {
  const url = getApiEndpoints()?.manageConversations;
  const query = useQuery({
    queryKey: ["conversations"],
    enabled: !!url,
    refetchInterval: 12_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const r = await authedFetch(url!, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { conversations: Conversation[]; unread: number };
    },
  });
  return {
    conversations: query.data?.conversations ?? [],
    unread: query.data?.unread ?? 0,
    configured: !!url,
    loading: !!url && query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}

/** Una conversación con su thread. Refresca cada 8s mientras está abierta. */
export function useConversation(conversationId: string | null) {
  const url = getApiEndpoints()?.manageConversations;
  const query = useQuery({
    queryKey: ["conversation", conversationId],
    enabled: !!url && !!conversationId,
    refetchInterval: 8_000,
    queryFn: async ({ signal }) => {
      const r = await authedFetch(`${url}?conversationId=${encodeURIComponent(conversationId!)}`, {
        signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return ((await r.json()).conversation ?? null) as Conversation | null;
    },
  });
  return {
    conversation: query.data ?? null,
    loading: !!conversationId && query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

/** Acciones del inbox: responder, marcar leída, cerrar. Invalidan list+thread. */
export function useConversationActions() {
  const url = getApiEndpoints()?.manageConversations;
  const qc = useQueryClient();

  const post = async (body: Record<string, unknown>) => {
    if (!url) throw new Error("Inbox no configurado");
    const r = await authedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
    return d as { conversation?: Conversation; sent?: boolean };
  };

  const invalidate = (conversationId: string) => {
    qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
    qc.invalidateQueries({ queryKey: ["conversations"] });
  };

  const reply = useMutation({
    mutationFn: (v: { conversationId: string; text: string }) =>
      post({ action: "reply", conversationId: v.conversationId, text: v.text }),
    onSuccess: (_d, v) => invalidate(v.conversationId),
  });
  // Comentarios (Fase B): responder EN PÚBLICO al comentario…
  const replyComment = useMutation({
    mutationFn: (v: { conversationId: string; text: string }) =>
      post({ action: "replyComment", conversationId: v.conversationId, text: v.text }),
    onSuccess: (_d, v) => invalidate(v.conversationId),
  });
  // …o pasarlo a PRIVADO (DM por private-reply de Meta).
  const commentToDm = useMutation({
    mutationFn: (v: { conversationId: string; text: string }) =>
      post({ action: "commentToDm", conversationId: v.conversationId, text: v.text }),
    onSuccess: (_d, v) => invalidate(v.conversationId),
  });
  const markRead = useMutation({
    mutationFn: (conversationId: string) => post({ action: "markRead", conversationId }),
    onSuccess: (_d, conversationId) => invalidate(conversationId),
  });
  const close = useMutation({
    mutationFn: (v: {
      conversationId: string;
      /** Encuesta opcional a enviar ANTES de cerrar (CSAT, etc.). */
      survey?: { body: string; options: string[] };
    }) => post({ action: "close", conversationId: v.conversationId, survey: v.survey }),
    onSuccess: (_d, v) => invalidate(v.conversationId),
  });
  // Enviar MEDIA (imagen / audio / video / documento) al cliente. El frontend
  // sube el archivo (uploadConversationMedia) y pasa la URL pública aquí.
  const sendMedia = useMutation({
    mutationFn: (v: {
      conversationId: string;
      mediaUrl: string;
      mediaType: "image" | "audio" | "video" | "document";
      caption?: string;
      filename?: string;
    }) => post({ action: "sendMedia", ...v }),
    onSuccess: (_d, v) => invalidate(v.conversationId),
  });
  // Enviar una PLANTILLA HSM de WhatsApp (reusa las de la sección Plantillas).
  const sendTemplate = useMutation({
    mutationFn: (v: {
      conversationId: string;
      templateName: string;
      language: string;
      bodyParams?: string[];
    }) => post({ action: "sendTemplate", ...v }),
    onSuccess: (_d, v) => invalidate(v.conversationId),
  });
  // Fase 4 · F4.2a — enviar un LIST interactivo (menú tappable) por WhatsApp.
  const sendList = useMutation({
    mutationFn: (v: {
      conversationId: string;
      header?: string;
      body: string;
      footer?: string;
      button?: string;
      rows: { id: string; title: string; description?: string }[];
    }) => post({ action: "sendListInteractive", ...v }),
    onSuccess: (_d, v) => invalidate(v.conversationId),
  });
  // Identidad (Fase C): vincular la conversación a un lead / desvincular.
  const link = useMutation({
    mutationFn: (v: {
      conversationId: string;
      leadId: string;
      phone?: string;
      email?: string;
      customerName?: string;
    }) => post({ action: "link", ...v }),
    onSuccess: (_d, v) => invalidate(v.conversationId),
  });
  const unlink = useMutation({
    mutationFn: (conversationId: string) => post({ action: "unlink", conversationId }),
    onSuccess: (_d, conversationId) => invalidate(conversationId),
  });
  // Tipificar la conversación (misma taxonomía que voz). Guarda la disposición
  // + golpe en el lead; con closeAfter también cierra. Reusable tras interactuar.
  const typify = useMutation({
    mutationFn: (v: {
      conversationId: string;
      disposition: {
        stageId: string;
        stageLabel: string;
        subStageId?: string;
        subStageLabel?: string;
        valoracion?: string;
        tags?: string[];
        notes?: string;
      };
      closeAfter?: boolean;
      agent?: string;
    }) => post({ action: "typify", ...v }),
    onSuccess: (_d, v) => invalidate(v.conversationId),
  });
  // Handoff Bot ↔ Agente: "tomar" el chat (bot→agent) o devolverlo al Agente IA.
  const assign = useMutation({
    mutationFn: (v: { conversationId: string; assignee: "bot" | "agent" }) =>
      post({ action: "assign", ...v }),
    onSuccess: (_d, v) => invalidate(v.conversationId),
  });
  // Traspasar/derivar el chat a OTRO agente (ownership). agentId = email del destino.
  const assignTo = useMutation({
    mutationFn: (v: { conversationId: string; agentId: string; agentName?: string }) =>
      post({ action: "assignTo", ...v }),
    onSuccess: (_d, v) => invalidate(v.conversationId),
  });
  // Soltar el chat a la cola compartida (queda sin dueño, en manos de un agente).
  const release = useMutation({
    mutationFn: (conversationId: string) => post({ action: "release", conversationId }),
    onSuccess: (_d, conversationId) => invalidate(conversationId),
  });

  return {
    reply,
    replyComment,
    commentToDm,
    markRead,
    close,
    sendList,
    sendMedia,
    sendTemplate,
    link,
    unlink,
    typify,
    assign,
    assignTo,
    release,
  };
}
