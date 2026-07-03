import { useEffect, useRef, useState } from "react";
import { Clock, AlertTriangle, Paperclip, Loader2 } from "lucide-react";
import { useChatSession, type ChatMessage } from "@/hooks/useChatSession";
import * as Icon from "@/components/vox/primitives";
import { useDebugRender } from "@/lib/debugTrace";
import { TemplatesPopover } from "@/components/workspace/TemplatesPopover";
import { FlowsPopover } from "@/components/workspace/FlowsPopover";
import { EmojiPicker } from "@/components/workspace/EmojiPicker";
import { RewriterButton } from "@/components/workspace/RewriterButton";
import { SuggestedReplies } from "@/components/workspace/SuggestedReplies";
import { WindowCountdown } from "@/components/workspace/WindowCountdown";
import { PreviousChatsDrawer } from "@/components/workspace/PreviousChatsDrawer";

interface ChatThreadPanelProps {
  contactId: string | null;
  channel: string | null;
  customerName: string;
  /** Visible label for the channel ("WhatsApp", "Chat web", …). */
  channelLabel?: string;
  /** Customer's phone — used to look up prior chat sessions in the drawer. */
  customerPhone?: string | null;
  /** Logged-in agent username — fills the {{agente}} variable in templates. */
  agentName?: string;
  /** Queue / business unit — fills the {{cola}} variable. */
  queueName?: string;
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
        className="dim"
        style={{
          alignSelf: "center",
          fontSize: 11,
          padding: "4px 12px",
          background: "var(--bg-2)",
          borderRadius: "var(--r-pill)",
          margin: "4px 0",
        }}
      >
        {m.content}
      </div>
    );
  }

  // Burbujas al estilo demo: `.msg .msg--out` (agente) / `.msg--in` (cliente),
  // con la hora en `.msg__time`.
  return (
    <div className={"msg msg--" + (isAgent ? "out" : "in")} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {m.content}
      <div className="msg__time">{fmtTime(m.timestamp)}</div>
    </div>
  );
}

export function ChatThreadPanel({
  contactId,
  channel,
  customerName,
  channelLabel = "Chat",
  customerPhone = null,
  agentName,
  queueName,
}: ChatThreadPanelProps) {
  const {
    messages,
    status,
    customerTyping,
    sendMessage,
    sendTyping,
    sendAttachment,
  } = useChatSession(contactId, channel);
  const [draft, setDraft] = useState("");
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── DEBUG INSTRUMENTATION ────────────────────────────────────
  useDebugRender("ChatThreadPanel", {
    contactId,
    channel,
    status,
    messageCount: messages.length,
    customerTyping,
  });

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

  // Insert text (templates / emojis) at the current cursor position so the
  // agent can compose around an existing message instead of always appending.
  const insertAtCursor = (text: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setDraft((d) => d + text);
      return;
    }
    const start = ta.selectionStart ?? draft.length;
    const end = ta.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    setDraft(next);
    // Restore focus + put the cursor right after the inserted text on the
    // next paint so the agent can keep typing.
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setAttachError(null);
    setAttaching(true);
    try {
      await sendAttachment(file);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Error al enviar archivo");
    } finally {
      setAttaching(false);
    }
  };

  return (
    <div
      data-debug-component="ChatThreadPanel"
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
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
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
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* History drawer trigger — only meaningful when we know the phone. */}
          {customerPhone && (
            <button
              onClick={() => setHistoryOpen(true)}
              className="btn btn--ghost btn--sm"
              title="Ver chats anteriores con este cliente"
              style={{ fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Clock size={13} /> Historial
            </button>
          )}
          <span
            className={
              "pill " + (status === "connected" ? "pill--green" : "pill--outline")
            }
            style={{ height: 22, fontSize: 10.5 }}
          >
            <span className={"dot" + (status === "connected" ? " dot--live" : "")} />
            {status === "connected" ? "En vivo" : status}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
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

      {/* Attachment error (transient) */}
      {attachError && (
        <div
          style={{
            margin: "0 10px 6px",
            padding: "6px 10px",
            background: "var(--accent-red-soft)",
            color: "var(--accent-red)",
            borderRadius: 6,
            fontSize: 11.5,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} /> {attachError}
          <button
            onClick={() => setAttachError(null)}
            className="btn btn--ghost btn--sm btn--icon"
            aria-label="Cerrar"
            style={{ marginLeft: "auto" }}
          >
            <Icon.Close size={11} />
          </button>
        </div>
      )}

      {/* Composer — envoltura al estilo demo (.composer). */}
      <div className="composer">
        {/* WhatsApp 24h window countdown — only renders for WA channels. */}
        <WindowCountdown
          messages={messages}
          channel={channel}
          channelLabel={channelLabel}
        />

        {/* Proactive reply suggestions (when the customer just wrote and
            the agent hasn't started typing). */}
        <SuggestedReplies
          messages={messages}
          customerName={customerName}
          disabled={status !== "connected"}
          draftEmpty={!draft.trim()}
          onPick={(text) => {
            setDraft(text);
            textareaRef.current?.focus();
          }}
        />

        {/* Toolbar row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            marginBottom: 6,
            paddingLeft: 2,
          }}
        >
          <TemplatesPopover
            ctx={{
              customerName,
              agentName,
              queueName,
            }}
            onPick={insertAtCursor}
            disabled={status !== "connected"}
          />
          {/* WhatsApp Flows (#10): enviar un formulario nativo al cliente. */}
          <FlowsPopover
            messages={messages}
            channel={channel}
            channelLabel={channelLabel}
            customerPhone={customerPhone}
            disabled={status !== "connected"}
          />
          <EmojiPicker
            onPick={insertAtCursor}
            disabled={status !== "connected"}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={status !== "connected" || attaching}
            className="btn btn--ghost btn--sm btn--icon"
            title="Adjuntar archivo (máx. 20 MB)"
            aria-label="Adjuntar archivo"
            style={{ fontSize: 14 }}
          >
            {attaching ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFilePicked}
            style={{ display: "none" }}
            // Connect rejects executable types and oversized files — we
            // still let the user try anything else so they can attach
            // PDFs/images/audios from WhatsApp without us mis-guessing.
            accept="image/*,application/pdf,audio/*,video/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
          />
          <RewriterButton
            draft={draft}
            disabled={status !== "connected"}
            onRewritten={(text) => setDraft(text)}
          />
        </div>
        <div
          className="composer__box"
          style={{ alignItems: "flex-end" }}
        >
          <textarea
            ref={textareaRef}
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
                ? "Escribe tu respuesta… (Enter para enviar, Shift+Enter salto)"
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

      {/* Side drawer with prior chats — only renders when open. */}
      <PreviousChatsDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        phone={customerPhone}
        customerName={customerName}
      />
    </div>
  );
}
