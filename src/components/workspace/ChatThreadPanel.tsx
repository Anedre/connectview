import { useEffect, useRef, useState } from "react";
import { useChatSession, type ChatMessage } from "@/hooks/useChatSession";
import * as Icon from "@/components/vox/primitives";

interface ChatThreadPanelProps {
  contactId: string | null;
  channel: string | null;
  customerName: string;
  /** Visible label for the channel ("WhatsApp", "Chat web", …). */
  channelLabel?: string;
}

function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const isAgent = m.participantRole === "AGENT";
  const isSystem = m.participantRole === "SYSTEM";

  if (isSystem) {
    return (
      <div
        style={{
          alignSelf: "center",
          color: "var(--text-3)",
          fontSize: 11,
          padding: "4px 10px",
          background: "var(--bg-2)",
          borderRadius: 999,
          margin: "4px 0",
        }}
      >
        {m.content}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isAgent ? "flex-end" : "flex-start",
        margin: "2px 0",
      }}
    >
      <div
        style={{
          maxWidth: "78%",
          padding: "8px 10px",
          background: isAgent ? "var(--accent-violet-soft)" : "var(--bg-2)",
          color: "var(--text-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 10,
          borderBottomRightRadius: isAgent ? 2 : 10,
          borderBottomLeftRadius: isAgent ? 10 : 2,
          fontSize: 13,
          lineHeight: 1.4,
          overflowWrap: "anywhere",
          whiteSpace: "pre-wrap",
        }}
      >
        {m.content}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--text-3)",
          marginTop: 2,
          padding: "0 4px",
        }}
      >
        {fmtTime(m.timestamp)}
      </div>
    </div>
  );
}

export function ChatThreadPanel({
  contactId,
  channel,
  customerName,
  channelLabel = "Chat",
}: ChatThreadPanelProps) {
  const { messages, status, customerTyping, sendMessage, sendTyping } =
    useChatSession(contactId, channel);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages — but ONLY if the agent is
  // already at (or very near) the bottom. If they've scrolled up to read
  // history we don't want to yank them down every time a system event
  // triggers a re-render.
  const wasAtBottomRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      wasAtBottomRef.current = distanceFromBottom < 48;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!scrollRef.current) return;
    if (!wasAtBottomRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, customerTyping]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await sendMessage(text);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-1)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border-1)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Icon.Chat size={15} style={{ color: "var(--accent-cyan)" }} />
            <span>{channelLabel}</span>
            <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
              · con {customerName}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {status === "connecting" && "Conectando al hilo…"}
            {status === "connected" && `${messages.length} mensaje${messages.length === 1 ? "" : "s"}`}
            {status === "ended" && "Conversación finalizada"}
            {status === "idle" && "Sin conversación activa"}
          </div>
        </div>
        <span
          className="chip"
          style={{
            background:
              status === "connected"
                ? "var(--accent-green-soft)"
                : "var(--bg-2)",
            color:
              status === "connected"
                ? "var(--accent-green)"
                : "var(--text-3)",
          }}
        >
          <span className="dot" /> {status === "connected" ? "En vivo" : status}
        </span>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {messages.length === 0 && status === "connecting" && (
          <div
            className="muted"
            style={{ textAlign: "center", marginTop: 40, fontSize: 12 }}
          >
            Cargando historial de mensajes…
          </div>
        )}
        {messages.length === 0 && status === "connected" && (
          <div
            className="muted"
            style={{ textAlign: "center", marginTop: 40, fontSize: 12 }}
          >
            Sin mensajes aún. Escribe el primer saludo.
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
        {customerTyping && (
          <div
            style={{
              alignSelf: "flex-start",
              padding: "6px 10px",
              fontSize: 11,
              color: "var(--text-3)",
              fontStyle: "italic",
            }}
          >
            {customerName} está escribiendo…
          </div>
        )}
      </div>

      {/* Composer */}
      <div
        style={{
          borderTop: "1px solid var(--border-1)",
          padding: 10,
          background: "var(--bg-1)",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-end",
            background: "var(--bg-2)",
            border: "1px solid var(--border-1)",
            borderRadius: 8,
            padding: "8px 10px",
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              sendTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              status === "connected"
                ? "Escribe tu respuesta… (Enter para enviar)"
                : "Conectando…"
            }
            disabled={status !== "connected"}
            style={{
              flex: 1,
              minHeight: 36,
              maxHeight: 120,
              resize: "vertical",
              background: "transparent",
              border: 0,
              outline: "none",
              color: "var(--text-1)",
              fontSize: 13,
              fontFamily: "inherit",
              lineHeight: 1.4,
            }}
          />
          <button
            className="btn btn--primary"
            onClick={handleSend}
            disabled={status !== "connected" || !draft.trim()}
            title="Enviar (Enter)"
          >
            <Icon.Send size={13} /> Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
