import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * useConversations — datos del inbox omnicanal (Pilar 6 · R13). Lee la lista y
 * el thread de `manage-conversations`, y expone las acciones (responder / marcar
 * leída / cerrar). La lista se refresca sola (poll) para sentirse en vivo sin
 * websockets; el thread abierto refresca más rápido.
 */
export type ConvChannel = "instagram" | "messenger" | "whatsapp" | "fb_comment";

export interface ConvMessage {
  id: string;
  direction: "in" | "out";
  text: string;
  ts: string;
  agent?: string;
  attachment?: { type: string; url: string };
}

export interface Conversation {
  conversationId: string;
  tenantId?: string;
  channel: ConvChannel;
  senderId: string;
  customerName?: string;
  status: "open" | "closed";
  unread: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  assignedAgent?: string;
  leadId?: string;
  messages?: ConvMessage[];
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
      const r = await authedFetch(`${url}?conversationId=${encodeURIComponent(conversationId!)}`, { signal });
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
  const markRead = useMutation({
    mutationFn: (conversationId: string) => post({ action: "markRead", conversationId }),
    onSuccess: (_d, conversationId) => invalidate(conversationId),
  });
  const close = useMutation({
    mutationFn: (conversationId: string) => post({ action: "close", conversationId }),
    onSuccess: (_d, conversationId) => invalidate(conversationId),
  });

  return { reply, markRead, close };
}
