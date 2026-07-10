import { useMemo } from "react";
import { Image as ImageIcon, Paperclip } from "lucide-react";
import * as Icon from "@/components/vox/primitives";
import { sanitizeText } from "@/lib/utils";

/**
 * Chat transcript renderer designed to look like a WhatsApp / messaging
 * thread: per-participant bubble alignment, inline media for attachments,
 * compact system separators for events.
 *
 * Used by the RecordingsPage when the contact's `channel === "CHAT"` (or
 * the segmentAttributes flag the contact as WhatsApp).
 */

export interface ChatAttachmentRef {
  attachmentId: string;
  name?: string;
  contentType?: string;
}

export interface ChatSegment {
  type: "message" | "attachment" | "event";
  participant: string; // CUSTOMER | AGENT | SYSTEM | UNKNOWN
  content: string;
  contentType?: string;
  attachmentRef?: ChatAttachmentRef;
  eventKind?: string;
  id?: string;
  timestamp: string;
}

export interface ChatAttachment {
  fileId: string;
  fileName?: string;
  fileSizeBytes?: number;
  url?: string | null;
  fileStatus?: string;
}

interface ChatTranscriptViewProps {
  segments: ChatSegment[];
  attachments: ChatAttachment[];
  /** When true, render in tighter spacing — useful in modals. */
  dense?: boolean;
}

const PARTICIPANT_STYLES: Record<
  string,
  { align: "left" | "right" | "center"; bg: string; fg: string; label: string }
> = {
  // Convención unificada con WhatsAppThreadView / RecordingsShowcase / Email: el
  // negocio (AGENT) va a la DERECHA con burbuja de acento ("yo"); el CLIENTE a la
  // IZQUIERDA, neutra. Antes estaba espejado (cliente a la derecha en verde), así
  // que el mismo cliente aparecía en lados opuestos según la vista.
  CUSTOMER: {
    align: "left",
    bg: "var(--bg-1, #ffffff)",
    fg: "var(--text-1, #111b21)",
    label: "Cliente",
  },
  AGENT: {
    align: "right",
    bg: "var(--accent-green-soft, #d9fdd3)",
    fg: "var(--text-1, #111b21)",
    label: "Agente",
  },
  SYSTEM: {
    align: "left",
    bg: "var(--accent-violet-soft, #ebe0ff)",
    fg: "var(--text-1, #111b21)",
    label: "Sistema",
  },
  UNKNOWN: {
    align: "left",
    bg: "var(--bg-2)",
    fg: "var(--text-1)",
    label: "—",
  },
};

const EVENT_LABELS: Record<string, string> = {
  "participant.joined": "se unió al chat",
  "participant.left": "salió del chat",
  "chat.ended": "Chat terminado",
  transferred: "Transferencia",
  typing: "Escribiendo…",
  read: "Leído",
  delivered: "Entregado",
  unknown: "Evento",
};

function localizeEvent(kind: string, participant: string): string {
  const label = EVENT_LABELS[kind] || `Evento · ${kind}`;
  if (kind.startsWith("participant.") && participant !== "SYSTEM") {
    const who =
      participant === "AGENT" ? "Agente" : participant === "CUSTOMER" ? "Cliente" : participant;
    return `${who} ${label}`;
  }
  return label;
}

function fmtTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("es-PE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-PE", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function fmtFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(ct?: string, name?: string): boolean {
  if (ct?.startsWith("image/")) return true;
  if (!name) return false;
  return /\.(jpe?g|png|gif|webp|heic)$/i.test(name);
}

function isAudio(ct?: string, name?: string): boolean {
  if (ct?.startsWith("audio/")) return true;
  if (!name) return false;
  return /\.(mp3|ogg|opus|wav|m4a|webm)$/i.test(name);
}

function isVideo(ct?: string, name?: string): boolean {
  if (ct?.startsWith("video/")) return true;
  if (!name) return false;
  return /\.(mp4|mov|webm|3gp)$/i.test(name);
}

function isPdf(ct?: string, name?: string): boolean {
  if (ct === "application/pdf") return true;
  if (!name) return false;
  return /\.pdf$/i.test(name);
}

function AttachmentBubble({
  ref_,
  attachment,
}: {
  ref_: ChatAttachmentRef;
  attachment?: ChatAttachment;
}) {
  // Prefer the chat-provided AttachmentName ("SUNAT - Menú SOL.pdf") over
  // the S3-key-derived fileName ("20260223T20:50_UTC.pdf") — the original
  // chat name is always human-readable, the derived one is just a path tail.
  const name = ref_.name || attachment?.fileName || ref_.attachmentId.slice(0, 8) || "archivo";
  const ct =
    ref_.contentType ||
    (attachment?.fileStatus === "APPROVED" ? undefined : attachment?.fileStatus);
  const url = attachment?.url || null;
  const sizeLabel = fmtFileSize(attachment?.fileSizeBytes);

  if (isImage(ct, name)) {
    return (
      <div style={{ maxWidth: 280 }}>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            <img
              src={url}
              alt={name}
              style={{
                width: "100%",
                maxHeight: 280,
                borderRadius: 8,
                objectFit: "cover",
                display: "block",
              }}
            />
          </a>
        ) : (
          <div style={{ padding: 10, color: "var(--text-3)", fontSize: 12 }}>
            (imagen no disponible)
          </div>
        )}
        <div
          className="muted"
          style={{ fontSize: 10.5, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}
          title={name}
        >
          <ImageIcon size={12} style={{ flexShrink: 0 }} /> {name} {sizeLabel && `· ${sizeLabel}`}
        </div>
      </div>
    );
  }

  if (isAudio(ct, name)) {
    return (
      <div style={{ minWidth: 240 }}>
        <div
          className="row"
          style={{
            gap: 8,
            alignItems: "center",
            marginBottom: 4,
            fontSize: 11.5,
          }}
        >
          <Icon.Mic size={14} style={{ color: "var(--accent-cyan)" }} />
          <span>{name}</span>
        </div>
        {url ? (
          <audio controls src={url} style={{ width: "100%", height: 32 }} />
        ) : (
          <span className="muted" style={{ fontSize: 11 }}>
            (audio no disponible)
          </span>
        )}
        {sizeLabel && (
          <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
            {sizeLabel}
          </div>
        )}
      </div>
    );
  }

  if (isVideo(ct, name)) {
    return (
      <div style={{ maxWidth: 280 }}>
        {url ? (
          <video controls src={url} style={{ width: "100%", borderRadius: 8 }} />
        ) : (
          <span className="muted" style={{ fontSize: 11 }}>
            (video no disponible)
          </span>
        )}
        <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>
          🎬 {name} {sizeLabel && `· ${sizeLabel}`}
        </div>
      </div>
    );
  }

  if (isPdf(ct, name)) {
    return (
      <a
        href={url || "#"}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderRadius: 6,
          background: "var(--bg-2)",
          textDecoration: "none",
          color: "var(--text-1)",
          minWidth: 200,
        }}
      >
        <span style={{ fontSize: 22 }}>📄</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </div>
          <div className="muted" style={{ fontSize: 10.5 }}>
            PDF {sizeLabel && `· ${sizeLabel}`}
          </div>
        </div>
        <Icon.Download size={13} style={{ color: "var(--accent-cyan)" }} />
      </a>
    );
  }

  // Fallback: generic file
  return (
    <a
      href={url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 6,
        background: "var(--bg-2)",
        textDecoration: "none",
        color: "var(--text-1)",
        minWidth: 200,
      }}
    >
      <Paperclip size={18} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
        <div className="muted" style={{ fontSize: 10.5 }}>
          {ct || "archivo"} {sizeLabel && `· ${sizeLabel}`}
        </div>
      </div>
      {url && <Icon.Download size={13} />}
    </a>
  );
}

/**
 * Render an "interactive" message (Connect quick-reply / list-picker).
 * Connect ships these as `ContentType: application/vnd.amazonaws.connect.message.interactive`
 * (response) or `interactive.response` with a JSON body.
 */
function InteractiveMessage({ raw }: { raw: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return <span style={{ fontSize: 12.5 }}>{sanitizeText(raw)}</span>;
  }
  const obj = parsed as Record<string, unknown>;
  // Quick-reply response shape: { data: { content: { title: "..." } } }
  const data = (obj.data as Record<string, unknown>) || {};
  const content = (data.content as Record<string, unknown>) || {};
  const title = (content.title as string) || (obj.title as string) || "";
  const subtitle = (content.subtitle as string) || "";
  return (
    <div style={{ fontSize: 12.5 }}>
      <div style={{ fontWeight: 500 }}>{sanitizeText(title)}</div>
      {subtitle && (
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          {sanitizeText(subtitle)}
        </div>
      )}
    </div>
  );
}

export function ChatTranscriptView({ segments, attachments, dense }: ChatTranscriptViewProps) {
  // Resolve attachments by id so each bubble can grab its presigned URL.
  const attachmentById = useMemo(() => {
    const map = new Map<string, ChatAttachment>();
    for (const a of attachments) map.set(a.fileId, a);
    return map;
  }, [attachments]);

  if (segments.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "var(--text-3)",
          fontSize: 12.5,
        }}
      >
        Sin mensajes en este chat.
      </div>
    );
  }

  // Group segments by date so we can drop a "23 de febrero de 2026"
  // separator above each new day (WhatsApp does this).
  const groups: Array<{ date: string; segments: ChatSegment[] }> = [];
  for (const s of segments) {
    const d = s.timestamp ? s.timestamp.slice(0, 10) : "";
    const last = groups[groups.length - 1];
    if (last && last.date === d) last.segments.push(s);
    else groups.push({ date: d, segments: [s] });
  }

  const gap = dense ? 4 : 8;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        maxHeight: 540,
        overflowY: "auto",
        padding: dense ? 8 : 12,
        background: "var(--bg-0, #f0e6d8)",
        borderRadius: 10,
      }}
    >
      {groups.map((g, gi) => (
        <div key={gi} style={{ display: "flex", flexDirection: "column", gap }}>
          {g.date && (
            <div
              style={{
                alignSelf: "center",
                fontSize: 10.5,
                color: "var(--text-3)",
                background: "var(--bg-1)",
                padding: "3px 10px",
                borderRadius: 999,
                border: "1px solid var(--border-1)",
              }}
            >
              {fmtDate(g.date)}
            </div>
          )}
          {g.segments.map((s, i) => {
            const style = PARTICIPANT_STYLES[s.participant] || PARTICIPANT_STYLES.UNKNOWN;

            if (s.type === "event") {
              return (
                <div
                  key={i}
                  style={{
                    alignSelf: "center",
                    fontSize: 10.5,
                    color: "var(--text-3)",
                    fontStyle: "italic",
                    padding: "2px 8px",
                  }}
                  title={fmtTime(s.timestamp)}
                >
                  · {localizeEvent(s.eventKind || "unknown", s.participant)}
                </div>
              );
            }

            const alignSelf =
              style.align === "right"
                ? "flex-end"
                : style.align === "center"
                  ? "center"
                  : "flex-start";

            // Render attachment bubble
            if (s.type === "attachment" && s.attachmentRef) {
              const att = attachmentById.get(s.attachmentRef.attachmentId);
              return (
                <div
                  key={i}
                  style={{
                    alignSelf,
                    background: style.bg,
                    color: style.fg,
                    borderRadius: 10,
                    padding: 8,
                    maxWidth: "75%",
                    boxShadow: "0 1px 0.5px rgba(0,0,0,0.13)",
                  }}
                >
                  <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>
                    {style.label}
                  </div>
                  <AttachmentBubble ref_={s.attachmentRef} attachment={att} />
                  <div className="muted" style={{ fontSize: 10, marginTop: 4, textAlign: "right" }}>
                    {fmtTime(s.timestamp)}
                  </div>
                </div>
              );
            }

            // Regular text/interactive message
            const isInteractive =
              s.contentType?.includes("interactive") || s.contentType === "application/json";
            return (
              <div
                key={i}
                style={{
                  alignSelf,
                  background: style.bg,
                  color: style.fg,
                  borderRadius: 10,
                  padding: "6px 10px",
                  maxWidth: "75%",
                  boxShadow: "0 1px 0.5px rgba(0,0,0,0.13)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>
                  {style.label}
                </div>
                {isInteractive ? (
                  <InteractiveMessage raw={s.content} />
                ) : (
                  <span style={{ fontSize: 13 }}>{sanitizeText(s.content)}</span>
                )}
                <div
                  className="muted"
                  style={{
                    fontSize: 10,
                    marginTop: 2,
                    textAlign: "right",
                  }}
                >
                  {fmtTime(s.timestamp)}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
