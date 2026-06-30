import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChannelChip } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import {
  useConversation,
  useConversationActions,
  type ConvMessage,
} from "@/hooks/useConversations";
import { chipType, CH_LABEL } from "./channelMeta";
import { CustomerContextBar } from "./CustomerContextBar";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Bubble({ m }: { m: ConvMessage }) {
  const out = m.direction === "out";
  return (
    <div style={{ display: "flex", justifyContent: out ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "72%",
          padding: "9px 12px",
          borderRadius: 14,
          borderBottomRightRadius: out ? 4 : 14,
          borderBottomLeftRadius: out ? 14 : 4,
          background: out ? "var(--accent-cyan)" : "var(--bg-2)",
          color: out ? "#fff" : "var(--text-1)",
          border: out ? "none" : "1px solid var(--border-1)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
        }}
      >
        {m.attachment?.url && (
          <a
            href={m.attachment.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: out ? "#fff" : "var(--accent-cyan)",
              marginBottom: m.text ? 6 : 0,
              textDecoration: "underline",
            }}
          >
            <Icon.Download size={13} /> {m.attachment.type || "adjunto"}
          </a>
        )}
        {m.text && (
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.4,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {m.text}
          </div>
        )}
        <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7, textAlign: "right" }}>
          {m.agent ? `${m.agent} · ` : ""}
          {fmtTime(m.ts)}
        </div>
      </div>
    </div>
  );
}

export function ConversationThread({ conversationId }: { conversationId: string }) {
  const { conversation, loading } = useConversation(conversationId);
  const { reply, replyComment, commentToDm, markRead, close } = useConversationActions();
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const msgs = conversation?.messages ?? [];
  const isComment = conversation?.channel === "fb_comment";

  // Marcar leída al abrir (si tiene no-leídas). markRead invalida la lista.
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (conversation && conversation.unread > 0 && markedRef.current !== conversationId) {
      markedRef.current = conversationId;
      markRead.mutate(conversationId);
    }
  }, [conversation, conversationId, markRead]);

  // Auto-scroll al fondo cuando cambian los mensajes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, conversationId]);

  // DM directo (IG/Messenger) — Enter o botón Enviar.
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    try {
      await reply.mutateAsync({ conversationId, text: t });
    } catch (e) {
      setText(t); // restaurar para reintentar
      toast.error(e instanceof Error ? e.message : "No se pudo enviar");
    }
  };

  // Comentarios (Fase B): responder en público o pasar a privado.
  const runComment = async (kind: "public" | "dm") => {
    const t = text.trim();
    if (!t) return;
    const m = kind === "public" ? replyComment : commentToDm;
    setText("");
    try {
      await m.mutateAsync({ conversationId, text: t });
      toast.success(kind === "public" ? "Respondido en público" : "Pasado a privado (DM)");
    } catch (e) {
      setText(t);
      toast.error(e instanceof Error ? e.message : "No se pudo enviar");
    }
  };

  if (!conversation && loading) {
    return (
      <div className="muted" style={{ padding: 24, fontSize: 13 }}>
        Cargando conversación…
      </div>
    );
  }
  if (!conversation) {
    return (
      <div className="muted" style={{ padding: 24, fontSize: 13 }}>
        Conversación no encontrada.
      </div>
    );
  }

  const name = conversation.customerName || conversation.senderId;
  const closed = conversation.status === "closed";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "12px 16px",
          borderBottom: "1px solid var(--border-1)",
          flex: "0 0 auto",
        }}
      >
        <span style={{ position: "relative", flex: "0 0 auto" }}>
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              fontSize: 13,
              fontWeight: 700,
              background: "var(--accent-cyan-soft)",
              color: "var(--accent-cyan)",
            }}
          >
            {initials(name)}
          </span>
          <span
            style={{
              position: "absolute",
              right: -3,
              bottom: -3,
              transform: "scale(0.72)",
              transformOrigin: "bottom right",
            }}
          >
            <ChannelChip type={chipType(conversation.channel)} />
          </span>
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 14,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {CH_LABEL[conversation.channel] || conversation.channel}
            {closed ? " · cerrada" : ""}
          </div>
        </div>
        {!closed && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => close.mutate(conversationId)}
            disabled={close.isPending}
            title="Cerrar conversación"
          >
            <Icon.Check size={14} /> Cerrar
          </button>
        )}
      </div>

      {/* Cliente 360 (Fase C) — vínculo a lead + contexto unificado */}
      <CustomerContextBar conversation={conversation} />

      {/* Mensajes */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: "var(--bg-1)",
        }}
      >
        {msgs.length === 0 ? (
          <div className="muted" style={{ margin: "auto", fontSize: 12.5 }}>
            Sin mensajes todavía.
          </div>
        ) : (
          msgs.map((m) => <Bubble key={m.id} m={m} />)
        )}
      </div>

      {/* Composer */}
      <div
        style={{
          flex: "0 0 auto",
          borderTop: "1px solid var(--border-1)",
          padding: 12,
          background: "var(--bg-2)",
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // En comentarios NO auto-enviamos con Enter (evita publicar en
              // público sin querer); el agente elige público vs privado.
              if (e.key === "Enter" && !e.shiftKey && !isComment) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              closed
                ? "Reabrir respondiendo…"
                : isComment
                  ? "Escribe tu respuesta al comentario…"
                  : "Escribe una respuesta…  (Enter para enviar)"
            }
            rows={1}
            style={{
              flex: 1,
              resize: "none",
              maxHeight: 120,
              padding: "9px 12px",
              fontSize: 13.5,
              border: "1px solid var(--border-1)",
              borderRadius: 10,
              background: "var(--bg-1)",
              color: "var(--text-1)",
              fontFamily: "inherit",
              lineHeight: 1.4,
            }}
          />
          {isComment ? (
            <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => runComment("public")}
                disabled={replyComment.isPending || !text.trim()}
                title="Responder EN PÚBLICO al comentario (visible para todos)"
              >
                {replyComment.isPending ? (
                  "…"
                ) : (
                  <>
                    <Icon.Chat size={13} /> Público
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => runComment("dm")}
                disabled={commentToDm.isPending || !text.trim() || conversation.dmSent}
                title={
                  conversation.dmSent
                    ? "Ya se pasó a privado (Meta permite un solo DM por comentario)"
                    : "Pasar a privado: enviar un DM al autor del comentario"
                }
              >
                {commentToDm.isPending ? (
                  "…"
                ) : (
                  <>
                    <Icon.Send size={13} /> {conversation.dmSent ? "DM enviado" : "Privado"}
                  </>
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={send}
              disabled={reply.isPending || !text.trim()}
              title="Enviar"
              style={{ flex: "0 0 auto" }}
            >
              {reply.isPending ? (
                "Enviando…"
              ) : (
                <>
                  <Icon.Send size={14} /> Enviar
                </>
              )}
            </button>
          )}
        </div>
        <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>
          {isComment
            ? "“Público” responde en el hilo del comentario; “Privado” abre un DM al autor (1 vez por comentario, ventana de Meta)."
            : "La respuesta se envía por la Graph API de Meta al remitente."}
        </div>
      </div>
    </div>
  );
}
