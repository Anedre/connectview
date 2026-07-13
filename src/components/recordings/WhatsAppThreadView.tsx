import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Paperclip } from "lucide-react";
import {
  useCustomerThread,
  type ThreadMessage,
  type ThreadSession,
} from "@/hooks/useCustomerThread";
import { ThreadDatePicker } from "@/components/recordings/ThreadDatePicker";
import * as Icon from "@/components/vox/primitives";
import { sanitizeText } from "@/lib/utils";
import { AttachmentLightbox, type PreviewItem } from "@/components/recordings/AttachmentLightbox";
import {
  formatChatTime,
  chatDayLabel,
  chatEventLabel,
  ymdLocal,
} from "@/components/recordings/chatShared";

/**
 * Unified WhatsApp-style thread for a customer — merges every CHAT contact
 * into one continuous timeline, with:
 *  • Day separators ("── jueves 22 mayo ──")
 *  • Session separators ("── nueva conversación · 3 días después ──")
 *  • Floating calendar popover (days with activity marked)
 *  • Auto-scroll to bottom on load, smooth jump-to-date on pick
 *
 * Renders inside the third column of /recordings when the user picks a
 * customer that has any chat history.
 */

interface Props {
  /** Phone number of the customer. The thread is empty until this is set. */
  phone: string | null;
}

type TimelineItem =
  | { kind: "msg"; msg: ThreadMessage }
  | { kind: "day"; day: string; label: string }
  | {
      kind: "session";
      session: ThreadSession;
      gapDays: number | null;
      label: string;
    };

/**
 * Try to render an interactive WhatsApp ContentType=application/json payload
 * (template / quick-reply / list / sticker / etc.) as a readable preview.
 * Falls back to the raw JSON string when we can't make sense of it.
 */
function renderInteractive(raw: string): string | null {
  try {
    const j = JSON.parse(raw);
    const tpl = j.templateType || j.type;
    const data = j.data || j;
    // Common shapes from amazon-connect-chatjs interactive messages.
    if (tpl === "ViewResource") {
      // ViewResource is the server pushing a structured "card" (often a
      // form template fetched by viewId). The raw blob carries opaque
      // viewToken JWT bytes — never show those. Title/subtitle render OK
      // when present; otherwise show a generic chip.
      const title = data?.content?.title;
      const sub = data?.content?.subtitle || data?.content?.elements?.[0]?.title;
      if (title) return `📋 ${title}${sub ? ` · ${sub}` : ""}`;
      return "📋 Tarjeta de información";
    }
    if (tpl === "Image") {
      return data?.content?.title || data?.url || "🖼️ Imagen";
    }
    if (tpl === "QuickReply") {
      const replies = (data.content?.replies || [])
        .map((r: { title?: string }) => r.title)
        .filter(Boolean)
        .join(" / ");
      return `${data.content?.title || ""}${replies ? ` · ${replies}` : ""}`;
    }
    if (tpl === "ListPicker") {
      const elements = (data.content?.elements || [])
        .map((e: { title?: string }) => e.title)
        .filter(Boolean);
      return `${data.content?.title || "Lista"}: ${elements.join(", ")}`;
    }
    // Last-resort: don't surface raw JSON — show a generic interactive chip.
    if (tpl) return `📦 Mensaje interactivo · ${tpl}`;
    return "📦 Mensaje interactivo";
  } catch {
    return null;
  }
}

function buildTimeline(messages: ThreadMessage[], sessions: ThreadSession[]): TimelineItem[] {
  const sessionMap = new Map(sessions.map((s) => [s.contactId, s]));
  const out: TimelineItem[] = [];
  let prevDay: string | null = null;
  let prevContact: string | null = null;
  let prevEnd: number | null = null;

  for (const m of messages) {
    const day = ymdLocal(m.timestamp);

    // Session separator — whenever we cross from one contactId to another.
    if (prevContact !== m.contactId) {
      const s = sessionMap.get(m.contactId);
      const start = Date.parse(m.timestamp) || 0;
      const gapDays =
        prevEnd != null && start > prevEnd
          ? Math.round((start - prevEnd) / (1000 * 60 * 60 * 24))
          : null;
      let label = prevContact == null ? "Inicio del historial" : "Nueva conversación";
      if (gapDays != null && gapDays > 0) {
        label += gapDays === 1 ? " · al día siguiente" : ` · ${gapDays} días después`;
      }
      out.push({
        kind: "session",
        session:
          s ||
          ({
            contactId: m.contactId,
            startTime: m.timestamp,
            endTime: m.timestamp,
            agentUsername: m.agentUsername || "",
            messageCount: 0,
          } as ThreadSession),
        gapDays,
        label,
      });
      prevDay = null; // force day separator after a session boundary
    }

    if (day !== prevDay) {
      out.push({ kind: "day", day, label: chatDayLabel(day) });
    }
    out.push({ kind: "msg", msg: m });

    prevDay = day;
    prevContact = m.contactId;
    const endMs = Date.parse(m.timestamp) || 0;
    if (prevEnd == null || endMs > prevEnd) prevEnd = endMs;
  }
  return out;
}

export function WhatsAppThreadView({ phone }: Props) {
  const { data, loading, error } = useCustomerThread(phone);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // Used to flash-highlight the first message of a jumped-to day so the user
  // sees where they landed even if the day already had visible content.
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewItem | null>(null);

  const timeline = useMemo(() => {
    if (!data) return [];
    return buildTimeline(data.messages, data.sessions);
  }, [data]);

  // First-load auto-scroll to the bottom (most recent message), like WhatsApp.
  useEffect(() => {
    if (!data || timeline.length === 0) return;
    const el = scrollerRef.current;
    if (!el) return;
    // Defer so layout is complete before scrolling.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [data, timeline.length]);

  const handlePickDate = (day: string) => {
    // Scroll to the first item of that day.
    const target = itemsRef.current.get(`day:${day}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlashKey(`day:${day}`);
    setTimeout(() => setFlashKey(null), 1600);
  };

  if (!phone) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: "var(--text-3)",
          fontSize: 12.5,
        }}
      >
        Selecciona un cliente para ver su chat unificado.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center", fontSize: 12.5 }}>
        Cargando historial de chat…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div
        style={{
          margin: 16,
          padding: 12,
          background: "var(--accent-red-soft)",
          color: "var(--accent-red)",
          borderRadius: 8,
          fontSize: 12.5,
        }}
      >
        {error || "Sin datos."}
      </div>
    );
  }
  if (data.totalMessages === 0) {
    // Sin ninguna conversación de chat → realmente vacío.
    if (data.totalSessions === 0) {
      const dg = data.diagnostics;
      // Si el backend halló CTRs para este teléfono pero ninguno quedó como
      // chat, algo no cuadra (el badge cuenta canales con toUpperCase). Mostramos
      // un diagnóstico discreto con los canales realmente vistos para depurar
      // sin tener que mirar CloudWatch del tenant. (#grabaciones)
      const showDiag = dg && dg.ctrTotal > 0 && dg.chatMatched === 0;
      return (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
          Este cliente no tiene mensajes de WhatsApp/chat.
          {showDiag && (
            <div
              style={{
                marginTop: 16,
                fontSize: 10.5,
                color: "var(--text-3)",
                fontFamily: "var(--font-mono, monospace)",
                lineHeight: 1.7,
                opacity: 0.75,
              }}
            >
              diagnóstico · perfil: {dg!.profileFound ? "sí" : "no"} · CTRs: {dg!.ctrTotal} · chat:{" "}
              {dg!.chatMatched} · canales: [{dg!.channelsSeen.join(", ")}] · vía: {dg!.strategy}
            </div>
          )}
        </div>
      );
    }
    // Hay conversación(es) de WhatsApp pero su transcripción no está disponible
    // (se archiva poco después de cerrar el chat). Mostramos que existen — antes
    // decía "no tiene mensajes" y contradecía el conteo del canal.
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border-1)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <Icon.User size={14} style={{ color: "var(--text-3)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{phone}</div>
            <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>
              {data.totalSessions} conversación{data.totalSessions === 1 ? "" : "es"} de WhatsApp
            </div>
          </div>
        </div>
        <div
          style={{
            maxHeight: "62vh",
            overflowY: "auto",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              background: "var(--accent-amber-soft)",
              color: "var(--accent-amber)",
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            Hay {data.totalSessions} conversación{data.totalSessions === 1 ? "" : "es"} de WhatsApp
            con este cliente, pero su transcripción todavía no se pudo cargar. Las transcripciones
            se archivan poco después de que el chat se cierra; si la conversación es reciente,
            prueba de nuevo en unos minutos.
          </div>
          {data.sessions.map((s) => (
            <div
              key={s.contactId}
              style={{
                border: "1px solid var(--border-1)",
                borderRadius: 10,
                background: "var(--bg-1)",
                padding: "10px 12px",
              }}
            >
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icon.WhatsApp size={13} style={{ color: "var(--accent-green)" }} /> WhatsApp
                {s.subChannel ? ` · ${s.subChannel}` : ""}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {s.startTime
                  ? new Date(s.startTime).toLocaleString("es-PE", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
                {s.agentUsername ? ` · ${s.agentUsername}` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border-1)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 34,
            height: 34,
            flex: "0 0 34px",
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            background: "var(--accent-green-soft)",
            color: "var(--accent-green)",
          }}
        >
          <Icon.WhatsApp size={17} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800 }}>Hilo unificado de WhatsApp</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>
            {data.totalMessages} mensajes · {data.totalSessions} conversaci
            {data.totalSessions === 1 ? "ón" : "ones"}
          </div>
        </div>
        <ThreadDatePicker daysWithActivity={data.daysWithActivity} onPick={handlePickDate} />
      </div>

      {/* Scroller (WhatsApp-like background) */}
      <div
        ref={scrollerRef}
        style={{
          maxHeight: "62vh",
          overflowY: "auto",
          background: "linear-gradient(180deg, var(--bg-2) 0%, var(--bg-1) 100%)",
          padding: "12px 14px",
        }}
      >
        {timeline.map((item, i) => {
          if (item.kind === "day") {
            return (
              <div
                key={`day:${item.day}:${i}`}
                ref={(el) => {
                  if (el) itemsRef.current.set(`day:${item.day}`, el);
                }}
                style={{
                  textAlign: "center",
                  margin: "12px 0",
                  position: "relative",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    padding: "3px 10px",
                    background: "var(--bg-1)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 12,
                    fontSize: 10.5,
                    color: "var(--text-3)",
                    fontWeight: 500,
                    boxShadow:
                      flashKey === `day:${item.day}`
                        ? "0 0 0 3px var(--accent-amber-soft)"
                        : undefined,
                    transition: "box-shadow 0.4s",
                  }}
                >
                  {item.label}
                </span>
              </div>
            );
          }

          if (item.kind === "session") {
            return <SessionSeparator key={`sess:${item.session.contactId}:${i}`} item={item} />;
          }

          return (
            <MessageBubble
              key={`msg:${item.msg.id}:${i}`}
              msg={item.msg}
              dense={false}
              onPreview={setPreview}
              index={i}
            />
          );
        })}
      </div>
      <AttachmentLightbox item={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

// ─── sub-components ───────────────────────────────────────────────────────

function SessionSeparator({ item }: { item: Extract<TimelineItem, { kind: "session" }> }) {
  const startDate = item.session.startTime ? new Date(item.session.startTime) : null;
  const relativeAgo = startDate
    ? formatDistanceToNow(startDate, { addSuffix: true, locale: es })
    : "";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        margin: "16px 0 8px",
      }}
    >
      <div
        style={{
          flex: 1,
          height: 1,
          background: "var(--border-1)",
        }}
      />
      <div
        style={{
          textAlign: "center",
          fontSize: 10.5,
          color: "var(--text-3)",
          padding: "2px 8px",
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 10,
          whiteSpace: "nowrap",
        }}
        title={`Contact ${item.session.contactId} · agente ${item.session.agentUsername || "—"}`}
      >
        {item.label}
        {relativeAgo && (
          <span className="muted" style={{ marginLeft: 6 }}>
            · {relativeAgo}
          </span>
        )}
      </div>
      <div
        style={{
          flex: 1,
          height: 1,
          background: "var(--border-1)",
        }}
      />
    </div>
  );
}

function MessageBubble({
  msg,
  dense,
  onPreview,
  index = 0,
}: {
  msg: ThreadMessage;
  dense: boolean;
  onPreview: (p: PreviewItem) => void;
  index?: number;
}) {
  // Connect "EVENT" segments are participant.joined / chat.ended / typing
  // / read — render as small centered system pills, not bubbles. Los eventos
  // ruidosos (typing/read/delivered) devuelven "" → no se renderizan.
  if (msg.type === "event") {
    const evLabel = chatEventLabel(msg.eventKind, msg.participant);
    if (!evLabel) return null;
    return (
      <div
        style={{
          textAlign: "center",
          margin: "6px 0",
          fontSize: 10.5,
          color: "var(--text-3)",
        }}
      >
        {evLabel}
      </div>
    );
  }

  const isAgent = msg.participant === "AGENT";
  const isSystem = msg.participant === "SYSTEM";
  const align: "left" | "right" | "center" = isSystem ? "center" : isAgent ? "right" : "left";

  // WhatsApp palette: customer (incoming) → white-ish, agent (outgoing) → green
  const bg = isSystem
    ? "var(--accent-violet-soft, #ebe0ff)"
    : isAgent
      ? "var(--accent-green-soft, #d9fdd3)"
      : "var(--bg-1)";

  // Connect serves interactive WhatsApp/web-chat payloads as
  // `application/vnd.amazonaws.connect.message.interactive` (or sometimes
  // plain `application/json`). Both carry a templateType + data blob whose
  // raw JSON would be unreadable in a bubble — project to a short label.
  const ctLower = (msg.contentType || "").toLowerCase();
  const looksInteractive =
    ctLower === "application/json" ||
    ctLower.includes("interactive") ||
    (msg.content || "").trimStart().startsWith("{");
  const interactive = looksInteractive ? renderInteractive(msg.content) : null;
  const displayContent = interactive || sanitizeText(msg.content || "");

  return (
    <div
      className="hg-bubble-in"
      style={{
        display: "flex",
        justifyContent:
          align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
        marginBottom: dense ? 3 : 6,
        animationDelay: `${((index % 16) * 0.03).toFixed(2)}s`,
      }}
    >
      <div
        style={{
          maxWidth: "72%",
          background: bg,
          border: "1px solid var(--border-1)",
          borderRadius: 10,
          padding: dense ? "5px 9px" : "7px 11px",
          fontSize: 12.5,
          lineHeight: 1.4,
          boxShadow: "0 1px 1px rgba(0,0,0,0.05)",
        }}
      >
        {/* Sender label (very small, only on first message in a streak — V1 always show) */}
        {!isSystem && (
          <div
            style={{
              fontSize: 10,
              color: isAgent ? "var(--accent-green)" : "var(--text-3)",
              fontWeight: 600,
              marginBottom: 2,
            }}
          >
            {isAgent ? msg.agentUsername || "Agente" : "Cliente"}
          </div>
        )}

        {msg.type === "attachment" && msg.attachment ? (
          <AttachmentInline
            attachment={msg.attachment}
            participant={msg.participant}
            onPreview={onPreview}
          />
        ) : (
          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {displayContent || (
              <span className="muted" style={{ fontSize: 11 }}>
                (mensaje vacío)
              </span>
            )}
          </div>
        )}

        <div
          style={{
            fontSize: 9.5,
            color: "var(--text-3)",
            textAlign: "right",
            marginTop: 2,
          }}
          title={msg.timestamp}
        >
          {formatChatTime(msg.timestamp)}
        </div>
      </div>
    </div>
  );
}

function AttachmentInline({
  attachment,
  participant,
  onPreview,
}: {
  attachment: NonNullable<ThreadMessage["attachment"]>;
  participant: ThreadMessage["participant"];
  onPreview: (p: PreviewItem) => void;
}) {
  const ct = (attachment.contentType || "").toLowerCase();
  const isImage = ct.startsWith("image/");
  const isAudio = ct.startsWith("audio/");
  const isVideo = ct.startsWith("video/");

  const open = () => {
    if (!attachment.url) return;
    onPreview({
      url: attachment.url,
      name: attachment.name || attachment.id,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      meta: participant === "AGENT" ? "Agente" : participant === "CUSTOMER" ? "Cliente" : undefined,
    });
  };

  if (isImage && attachment.url) {
    return (
      <img
        src={attachment.url}
        alt={attachment.name || "imagen"}
        onClick={open}
        title={attachment.name}
        style={{
          maxWidth: "100%",
          maxHeight: 240,
          borderRadius: 8,
          display: "block",
          cursor: "zoom-in",
        }}
      />
    );
  }
  if (isAudio && attachment.url) {
    return <audio controls src={attachment.url} style={{ width: 220 }} />;
  }
  if (isVideo && attachment.url) {
    return (
      <video
        controls
        src={attachment.url}
        style={{ maxWidth: "100%", maxHeight: 240, borderRadius: 6 }}
      />
    );
  }

  // Adjuntos de MENSAJE de chat/WhatsApp: Connect NO expone su descarga
  // histórica (no es un attached-file de la API de archivos ni queda en el
  // bucket S3 del cliente, sólo se baja en vivo vía ConnectParticipant). En vez
  // de un link roto, mostramos QUÉ se compartió, marcado como no descargable.
  if (!attachment.url) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px",
          background: "var(--bg-2)",
          borderRadius: 6,
          fontSize: 12,
          color: "var(--text-2)",
        }}
        title="Adjunto de chat — Connect no permite descargarlo después de cerrada la conversación"
      >
        <Paperclip size={14} style={{ flexShrink: 0 }} /> {attachment.name || attachment.id}
        <span className="muted" style={{ fontSize: 10.5 }}>
          · no descargable
        </span>
      </span>
    );
  }

  // Generic file chip (con URL presignada) — abre el visor. Cubre PDFs de chat,
  // adjuntos de email y archivos subidos por el agente.
  return (
    <button
      type="button"
      onClick={open}
      title="Previsualizar"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 10px",
        background: "var(--bg-2)",
        border: "1px solid var(--border-1)",
        borderRadius: 8,
        fontSize: 12,
        color: "var(--text-1)",
        cursor: "pointer",
      }}
    >
      <Paperclip size={14} style={{ flexShrink: 0 }} /> {attachment.name || attachment.id}
      {attachment.sizeBytes && (
        <span className="muted" style={{ fontSize: 10.5 }}>
          · {Math.round(attachment.sizeBytes / 1024)} KB
        </span>
      )}
    </button>
  );
}
