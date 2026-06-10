import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Paperclip } from "lucide-react";
import { useCustomerThread, type ThreadMessage, type ThreadSession } from "@/hooks/useCustomerThread";
import { ThreadDatePicker } from "@/components/recordings/ThreadDatePicker";
import * as Icon from "@/components/vox/primitives";
import { sanitizeText } from "@/lib/utils";

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

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DOW_ES = [
  "domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado",
];

function dayLabel(yyyyMmDd: string): string {
  // yyyy-mm-dd → "jueves 22 mayo 2026"
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const isToday =
    today.getFullYear() === y &&
    today.getMonth() === m - 1 &&
    today.getDate() === d;
  if (isToday) return "Hoy";
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const isYest =
    yest.getFullYear() === y &&
    yest.getMonth() === m - 1 &&
    yest.getDate() === d;
  if (isYest) return "Ayer";
  return `${DOW_ES[date.getDay()]} ${d} de ${MONTHS_ES[m - 1]} ${y}`;
}

function formatHm(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function ymdLocal(iso: string): string {
  // Map an absolute ISO timestamp into a local YYYY-MM-DD bucket. Using the
  // server-side .slice(0,10) trick would break for users east of GMT
  // because the same moment can be "ayer" or "hoy" depending on tz.
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

function buildTimeline(
  messages: ThreadMessage[],
  sessions: ThreadSession[]
): TimelineItem[] {
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
        label += gapDays === 1
          ? " · al día siguiente"
          : ` · ${gapDays} días después`;
      }
      out.push({
        kind: "session",
        session: s || ({
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
      out.push({ kind: "day", day, label: dayLabel(day) });
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
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: "var(--text-3)",
          fontSize: 12.5,
        }}
      >
        Este cliente no tiene mensajes de WhatsApp/chat.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
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
        <Icon.User size={14} style={{ color: "var(--text-3)" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{phone}</div>
          <div
            className="muted"
            style={{ fontSize: 10.5, marginTop: 1 }}
          >
            {data.totalSessions} conversaciones · {data.totalMessages} mensajes
          </div>
        </div>
        <ThreadDatePicker
          daysWithActivity={data.daysWithActivity}
          onPick={handlePickDate}
        />
      </div>

      {/* Scroller (WhatsApp-like background) */}
      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          background:
            "linear-gradient(180deg, var(--bg-2) 0%, var(--bg-1) 100%)",
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
            return (
              <SessionSeparator key={`sess:${item.session.contactId}:${i}`} item={item} />
            );
          }

          return (
            <MessageBubble
              key={`msg:${item.msg.id}:${i}`}
              msg={item.msg}
              dense={false}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── sub-components ───────────────────────────────────────────────────────

function SessionSeparator({
  item,
}: {
  item: Extract<TimelineItem, { kind: "session" }>;
}) {
  const startDate = item.session.startTime
    ? new Date(item.session.startTime)
    : null;
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
}: {
  msg: ThreadMessage;
  dense: boolean;
}) {
  // Connect "EVENT" segments are participant.joined / chat.ended / typing
  // / read — render as small centered system pills, not bubbles.
  if (msg.type === "event") {
    return (
      <div
        style={{
          textAlign: "center",
          margin: "6px 0",
          fontSize: 10.5,
          color: "var(--text-3)",
        }}
      >
        {eventLabel(msg.eventKind, msg.participant)}
      </div>
    );
  }

  const isAgent = msg.participant === "AGENT";
  const isSystem = msg.participant === "SYSTEM";
  const align: "left" | "right" | "center" = isSystem
    ? "center"
    : isAgent
    ? "right"
    : "left";

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
      style={{
        display: "flex",
        justifyContent:
          align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
        marginBottom: dense ? 3 : 6,
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
          <AttachmentInline attachment={msg.attachment} />
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
          {formatHm(msg.timestamp)}
        </div>
      </div>
    </div>
  );
}

function eventLabel(kind: string | undefined, participant: string): string {
  const map: Record<string, string> = {
    "participant.joined": "se unió al chat",
    "participant.left": "salió del chat",
    "chat.ended": "Chat terminado",
    transferred: "Transferencia",
    typing: "",  // skip noisy "typing" events visually
    read: "",
    delivered: "",
    unknown: "Evento",
  };
  if (!kind) return "Evento";
  const label = map[kind] ?? `Evento · ${kind}`;
  if (!label) return ""; // suppressed events render nothing
  if (kind.startsWith("participant.") && participant !== "SYSTEM") {
    const who =
      participant === "AGENT"
        ? "Agente"
        : participant === "CUSTOMER"
        ? "Cliente"
        : participant;
    return `${who} ${label}`;
  }
  return label;
}

function AttachmentInline({
  attachment,
}: {
  attachment: NonNullable<ThreadMessage["attachment"]>;
}) {
  const ct = (attachment.contentType || "").toLowerCase();
  const isImage = ct.startsWith("image/");
  const isAudio = ct.startsWith("audio/");
  const isVideo = ct.startsWith("video/");

  if (isImage && attachment.url) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        title={attachment.name}
      >
        <img
          src={attachment.url}
          alt={attachment.name || "imagen"}
          style={{
            maxWidth: "100%",
            maxHeight: 240,
            borderRadius: 6,
            display: "block",
          }}
        />
      </a>
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

  // Generic file chip
  return (
    <a
      href={attachment.url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 8px",
        background: "var(--bg-2)",
        borderRadius: 6,
        fontSize: 12,
        textDecoration: "none",
        color: "var(--text-1)",
      }}
    >
      <Paperclip size={14} style={{ flexShrink: 0 }} /> {attachment.name || attachment.id}
      {attachment.sizeBytes && (
        <span className="muted" style={{ fontSize: 10.5 }}>
          · {Math.round(attachment.sizeBytes / 1024)} KB
        </span>
      )}
    </a>
  );
}
