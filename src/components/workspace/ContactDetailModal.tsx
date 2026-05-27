import { useEffect, useMemo, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  useContactDetail,
  type ContactTranscriptSegment,
  type ContactWrapUp,
} from "@/hooks/useContactDetail";
import { useContactSummary } from "@/hooks/useContactSummary";
import {
  ChatTranscriptView,
  type ChatSegment,
} from "@/components/recordings/ChatTranscriptView";
import { VALORACION_META } from "@/lib/dispositions";
import { sanitizeText } from "@/lib/utils";
import * as Icon from "@/components/vox/primitives";

interface ContactDetailModalProps {
  open: boolean;
  onClose: () => void;
  contactId: string | null;
}

function fmtDuration(seconds: number): string {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function fmtFileSize(bytes: number | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function channelMeta(channel: string, subChannel?: string) {
  const k = (channel || "").toUpperCase();
  const isWA = (subChannel || "").toLowerCase().includes("messaging");
  if (k === "VOICE")
    return { icon: "📞", label: "Llamada", color: "var(--accent-green)" };
  if (k === "CHAT")
    return isWA
      ? { icon: "💚", label: "WhatsApp", color: "var(--accent-green)" }
      : { icon: "💬", label: "Chat", color: "var(--accent-cyan)" };
  if (k === "EMAIL")
    return { icon: "📧", label: "Email", color: "var(--accent-amber)" };
  if (k === "TASK")
    return { icon: "📋", label: "Tarea", color: "var(--accent-violet)" };
  return { icon: "📄", label: channel, color: "var(--text-2)" };
}

/**
 * Full-screen modal that opens when the agent clicks on a row in the
 * contact history timeline. Channel-aware:
 *
 *  - VOICE  →  audio player + clickable transcript (seeks audio) + sentiment chips
 *  - CHAT   →  WhatsApp-style bubble transcript with inline media (PDF, image,
 *              audio, video). Same renderer as the /recordings page.
 *  - EMAIL  →  header (subject, from/to/cc), body, attachments list
 *
 * Always renders an AI-generated summary card at the top so the agent
 * sees the gist of the previous interaction at a glance.
 */
export function ContactDetailModal({
  open,
  onClose,
  contactId,
}: ContactDetailModalProps) {
  const { detail, loading, error } = useContactDetail(open ? contactId : null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [showAttributes, setShowAttributes] = useState(false);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setShowAttributes(false);
      setSeekTarget(null);
    }
  }, [open, contactId]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // When a transcript segment is clicked, seek the audio to that offset
  useEffect(() => {
    if (seekTarget === null || !audioRef.current) return;
    audioRef.current.currentTime = seekTarget;
    audioRef.current.play().catch(() => {
      /* autoplay can fail without user gesture — ignore */
    });
  }, [seekTarget]);

  const meta = useMemo(
    () => channelMeta(detail?.channel || "VOICE", detail?.subChannel),
    [detail?.channel, detail?.subChannel]
  );

  // AI summary uses the transcript segments we already fetched, so it
  // works for historical contacts where the live ContactLens API is empty.
  const summarySegments = useMemo(
    () => detail?.transcript?.segments || null,
    [detail?.transcript?.segments]
  );
  const { summary, loading: summaryLoading } = useContactSummary(
    open ? contactId : null,
    summarySegments
  );

  if (!open) return null;

  const ch = (detail?.channel || "").toUpperCase();
  const isVoice = ch === "VOICE" || ch === "TELEPHONY";
  const isChat = ch === "CHAT";
  const isEmail = ch === "EMAIL";

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8, 10, 16, 0.65)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        zIndex: 260,
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 96vw)",
          maxHeight: "92vh",
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          display: "flex",
          flexDirection: "column",
          fontFamily: "var(--font-ui)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border-1)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 22 }}>{meta.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
              {meta.label} · {detail?.customerEndpoint || "—"}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {detail
                ? `${format(new Date(detail.initiationTimestamp), "dd MMM yyyy HH:mm")} · ${fmtDuration(detail.duration)} · ${detail.agentUsername || "Sin agente"} · ${detail.queueName || "Sin cola"}`
                : loading
                ? "Cargando…"
                : error || "—"}
            </div>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar (Esc)"
          >
            <Icon.Close size={14} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: 18,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            minHeight: 200,
          }}
        >
          {loading && !detail && (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 13,
              }}
            >
              Cargando detalle del contacto…
            </div>
          )}
          {error && !detail && (
            <div
              style={{
                padding: 16,
                background: "var(--accent-red-soft)",
                color: "var(--accent-red)",
                borderRadius: 8,
                fontSize: 12.5,
              }}
            >
              {error}
            </div>
          )}

          {detail && (
            <>
              {/* Wrap-up card — what the agent captured when the contact
                  ended. Shows disposition, notes, tags, follow-ups. Only
                  renders when there's actual content. */}
              {detail.wrapUp && <WrapUpCard wrapUp={detail.wrapUp} />}

              {/* AI summary card — top of body, all channels */}
              <SummaryCard
                summary={summary}
                loading={summaryLoading}
                hasTranscript={
                  (detail.transcript?.segments?.length || 0) > 0
                }
                channel={ch}
              />

              {/* Channel-specific body */}
              {isVoice && (
                <VoiceBody
                  detail={detail}
                  audioRef={audioRef}
                  onSeek={setSeekTarget}
                />
              )}
              {isChat && <ChatBody detail={detail} />}
              {isEmail && <EmailBody detail={detail} />}
              {!isVoice && !isChat && !isEmail && (
                <div
                  style={{
                    padding: 24,
                    border: "1px dashed var(--border-1)",
                    borderRadius: 8,
                    textAlign: "center",
                    color: "var(--text-3)",
                    fontSize: 12.5,
                  }}
                >
                  Canal “{detail.channel}” sin vista detallada.
                </div>
              )}

              {/* Attachments — for voice/email. Chat embeds them inline. */}
              {!isChat && detail.attachments.length > 0 && (
                <AttachmentsList attachments={detail.attachments} />
              )}

              {/* Contact attributes (collapsed) */}
              {Object.keys(detail.attributes).length > 0 && (
                <div>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setShowAttributes((v) => !v)}
                    style={{ fontSize: 11.5 }}
                  >
                    {showAttributes ? "▾" : "▸"} Atributos del contacto (
                    {Object.keys(detail.attributes).length})
                  </button>
                  {showAttributes && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 10,
                        background: "var(--bg-2)",
                        border: "1px solid var(--border-1)",
                        borderRadius: 6,
                        fontSize: 11,
                        maxHeight: 240,
                        overflowY: "auto",
                      }}
                    >
                      {Object.entries(detail.attributes).map(([k, v]) => (
                        <div
                          key={k}
                          style={{
                            display: "flex",
                            gap: 8,
                            padding: "3px 0",
                            borderBottom: "1px solid var(--border-1)",
                          }}
                        >
                          <span
                            className="mono"
                            style={{
                              color: "var(--text-2)",
                              minWidth: 130,
                              wordBreak: "break-word",
                            }}
                          >
                            {k}
                          </span>
                          <span
                            className="mono"
                            style={{
                              flex: 1,
                              color: "var(--text-1)",
                              wordBreak: "break-word",
                            }}
                          >
                            {v}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Footer info */}
              <div
                className="muted"
                style={{
                  fontSize: 10.5,
                  padding: "8px 0",
                  borderTop: "1px solid var(--border-1)",
                  marginTop: "auto",
                }}
              >
                ContactId · <span className="mono">{detail.contactId}</span>
                {detail.disconnectReason && (
                  <> · {detail.disconnectReason}</>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-views ─────────────────────────────────────────────────────────────

function WrapUpCard({ wrapUp }: { wrapUp: ContactWrapUp }) {
  // Pick a coloured chip for the valoración if it's one of the known
  // funnel values. Unknown values fall back to a neutral chip so we
  // don't crash when a custom disposition tree adds new tags.
  const valMeta =
    wrapUp.valoracion && (wrapUp.valoracion as keyof typeof VALORACION_META) in VALORACION_META
      ? VALORACION_META[wrapUp.valoracion as keyof typeof VALORACION_META]
      : null;
  const updatedRel = (() => {
    if (!wrapUp.updatedAt) return "";
    try {
      return formatDistanceToNow(new Date(wrapUp.updatedAt), {
        addSuffix: true,
        locale: es,
      });
    } catch {
      return "";
    }
  })();
  const followUpEntries = Object.entries(wrapUp.followUps || {}).filter(
    ([, v]) => v === true
  );
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--accent-amber-soft)",
        border: "1px solid var(--accent-amber)",
        borderRadius: 10,
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 14 }}>📝</span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: "var(--text-2)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Cierre por el agente
        </span>
        {wrapUp.agentUsername && (
          <span className="muted" style={{ fontSize: 10.5 }}>
            · {wrapUp.agentUsername}
          </span>
        )}
        {updatedRel && (
          <span className="muted" style={{ fontSize: 10.5, marginLeft: "auto" }}>
            {updatedRel}
          </span>
        )}
      </div>

      {/* Disposition row */}
      {(wrapUp.stageLabel || wrapUp.subStageLabel) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          {wrapUp.stageLabel && (
            <span className="chip" style={{ fontSize: 11 }}>
              {wrapUp.stageLabel}
            </span>
          )}
          {wrapUp.subStageLabel && (
            <>
              <span className="muted" style={{ fontSize: 11 }}>
                →
              </span>
              <span
                className="chip"
                style={{ fontSize: 11, background: "var(--bg-1)" }}
              >
                {wrapUp.subStageLabel}
              </span>
            </>
          )}
          {valMeta && (
            <span className={`chip ${valMeta.chip}`} style={{ fontSize: 10.5 }}>
              <span className="dot" /> {valMeta.label}
            </span>
          )}
        </div>
      )}

      {/* Notes */}
      {wrapUp.notes && (
        <div
          style={{
            background: "var(--bg-1)",
            padding: 10,
            borderRadius: 6,
            marginBottom: 8,
            fontSize: 12.5,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}
        >
          {sanitizeText(wrapUp.notes)}
        </div>
      )}

      {/* Tags */}
      {wrapUp.tags.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexWrap: "wrap",
            marginBottom: followUpEntries.length > 0 ? 8 : 0,
          }}
        >
          <span className="muted" style={{ fontSize: 10.5, marginRight: 4 }}>
            Tags:
          </span>
          {wrapUp.tags.map((t) => (
            <span key={t} className="chip chip--cyan" style={{ fontSize: 10.5 }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Follow-ups */}
      {followUpEntries.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          <span className="muted" style={{ fontSize: 10.5, marginRight: 4 }}>
            Follow-ups:
          </span>
          {followUpEntries.map(([k]) => (
            <span
              key={k}
              className="chip chip--violet"
              style={{ fontSize: 10.5 }}
              title={
                k === "task24h"
                  ? wrapUp.followUpTaskIds.length > 0
                    ? `Tarea creada (${wrapUp.followUpTaskIds[0].slice(0, 8)})`
                    : "Tarea pendiente"
                  : k
              }
            >
              {k === "task24h"
                ? "✓ Tarea 24h"
                : k === "emailConfirm"
                ? "✉ Email confirmación"
                : k === "nps"
                ? "📊 NPS"
                : k}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  summary,
  loading,
  hasTranscript,
  channel,
}: {
  summary: string | null;
  loading: boolean;
  hasTranscript: boolean;
  channel: string;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background:
          "linear-gradient(135deg, var(--accent-violet-soft) 0%, var(--accent-cyan-soft) 100%)",
        border: "1px solid var(--border-1)",
        borderRadius: 10,
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 14 }}>✨</span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: "var(--text-2)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Resumen IA · {channel === "CHAT" ? "Chat" : channel === "EMAIL" ? "Email" : "Llamada"}
        </span>
      </div>
      {loading ? (
        <span className="muted">Generando resumen…</span>
      ) : summary ? (
        <span>{summary}</span>
      ) : !hasTranscript ? (
        <span className="muted">
          Sin transcripción disponible para generar el resumen automático.
        </span>
      ) : (
        <span className="muted">
          Resumen automático no disponible en este momento.
        </span>
      )}
    </div>
  );
}

function VoiceBody({
  detail,
  audioRef,
  onSeek,
}: {
  detail: NonNullable<ReturnType<typeof useContactDetail>["detail"]>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  onSeek: (seconds: number) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: detail.transcript ? "1.2fr 1fr" : "1fr",
        gap: 14,
        minHeight: 200,
      }}
    >
      {/* Recording */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {detail.recording ? (
          <div
            style={{
              padding: 12,
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              borderRadius: 8,
            }}
          >
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--text-2)",
                marginBottom: 8,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon.Disc size={12} /> Grabación
            </div>
            <audio
              ref={audioRef}
              src={detail.recording.url}
              controls
              preload="metadata"
              style={{ width: "100%", colorScheme: "dark" }}
            />
          </div>
        ) : (
          <div
            style={{
              padding: 16,
              border: "1px dashed var(--border-1)",
              borderRadius: 8,
              textAlign: "center",
              color: "var(--text-3)",
              fontSize: 12.5,
            }}
          >
            Sin grabación disponible para este contacto.
          </div>
        )}

        {detail.transcript && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="section-title" style={{ margin: 0 }}>
                Transcripción
              </div>
              <span
                className="chip"
                style={{ fontSize: 10, padding: "1px 6px" }}
              >
                {detail.transcript.segments.length} segmentos
              </span>
              {detail.transcript.overallSentiment && (
                <span
                  className="chip"
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    background:
                      detail.transcript.overallSentiment === "POSITIVE"
                        ? "var(--accent-green-soft)"
                        : detail.transcript.overallSentiment === "NEGATIVE"
                        ? "var(--accent-red-soft)"
                        : "var(--bg-3)",
                    color:
                      detail.transcript.overallSentiment === "POSITIVE"
                        ? "var(--accent-green)"
                        : detail.transcript.overallSentiment === "NEGATIVE"
                        ? "var(--accent-red)"
                        : "var(--text-2)",
                  }}
                >
                  {detail.transcript.overallSentiment.toLowerCase()}
                </span>
              )}
              {detail.recording && (
                <span
                  className="muted"
                  style={{ marginLeft: "auto", fontSize: 10.5 }}
                >
                  Click un segmento para saltar el audio
                </span>
              )}
            </div>
            <div
              style={{
                maxHeight: 380,
                overflowY: "auto",
                padding: 4,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {detail.transcript.segments.length === 0 && (
                <div
                  style={{
                    padding: 16,
                    textAlign: "center",
                    fontSize: 12.5,
                    color: "var(--text-3)",
                  }}
                >
                  Sin segmentos en la transcripción.
                </div>
              )}
              {detail.transcript.segments.map((s, i) => (
                <TranscriptRow
                  key={i}
                  segment={s}
                  clickable={!!detail.recording}
                  onSeek={onSeek}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatBody({
  detail,
}: {
  detail: NonNullable<ReturnType<typeof useContactDetail>["detail"]>;
}) {
  // Cast — useContactDetail's ContactTranscriptSegment is a superset of the
  // ChatSegment type so we map the discriminated union safely.
  const segments = (detail.transcript?.segments || []) as unknown as ChatSegment[];
  const attachments = detail.attachments;
  if (segments.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          border: "1px dashed var(--border-1)",
          borderRadius: 8,
          textAlign: "center",
          color: "var(--text-3)",
          fontSize: 12.5,
        }}
      >
        Sin transcripción disponible para este chat.
      </div>
    );
  }
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div className="section-title" style={{ margin: 0 }}>
          Conversación
        </div>
        <span className="chip" style={{ fontSize: 10, padding: "1px 6px" }}>
          {segments.length} mensajes · {attachments.length} adjuntos
        </span>
      </div>
      <ChatTranscriptView segments={segments} attachments={attachments} />
    </div>
  );
}

function EmailBody({
  detail,
}: {
  detail: NonNullable<ReturnType<typeof useContactDetail>["detail"]>;
}) {
  const attrs = detail.attributes || {};
  const subject =
    sanitizeText(attrs.email_subject || attrs.subject || attrs.Subject || "") ||
    "(sin asunto)";
  const from = attrs.email_from || attrs.from || attrs.From || "";
  const to = attrs.email_to || attrs.to || attrs.To || "";
  const cc = attrs.email_cc || attrs.cc || attrs.Cc || "";
  const segments = detail.transcript?.segments || [];
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "70px 1fr",
          gap: "4px 12px",
          fontSize: 12.5,
          marginBottom: 12,
        }}
      >
        <span className="muted">Asunto</span>
        <span style={{ fontWeight: 600 }}>{subject}</span>
        {from && (
          <>
            <span className="muted">De</span>
            <span className="mono" style={{ fontSize: 11.5 }}>
              {sanitizeText(from)}
            </span>
          </>
        )}
        {to && (
          <>
            <span className="muted">Para</span>
            <span className="mono" style={{ fontSize: 11.5 }}>
              {sanitizeText(to)}
            </span>
          </>
        )}
        {cc && (
          <>
            <span className="muted">CC</span>
            <span className="mono" style={{ fontSize: 11.5 }}>
              {sanitizeText(cc)}
            </span>
          </>
        )}
      </div>

      {segments.length > 0 ? (
        <div
          style={{
            background: "var(--bg-2)",
            padding: 14,
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            maxHeight: 420,
            overflowY: "auto",
          }}
        >
          {segments.map((s, i) => (
            <div
              key={i}
              style={{
                marginBottom: 10,
                paddingBottom: 10,
                borderBottom:
                  i < segments.length - 1
                    ? "1px solid var(--border-1)"
                    : "none",
              }}
            >
              <div
                className="muted"
                style={{ fontSize: 10.5, marginBottom: 4 }}
              >
                {s.participant === "AGENT"
                  ? "Agente"
                  : s.participant === "CUSTOMER"
                  ? "Cliente"
                  : "Sistema"}
                {s.timestamp &&
                  ` · ${new Date(s.timestamp).toLocaleString("es-PE")}`}
              </div>
              <div>{sanitizeText(s.content || "")}</div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="muted"
          style={{
            padding: 16,
            textAlign: "center",
            fontSize: 12,
            background: "var(--bg-2)",
            borderRadius: 8,
          }}
        >
          El cuerpo del email no está disponible en el transcript. Los adjuntos
          sí — los puedes descargar abajo.
        </div>
      )}
    </div>
  );
}

function AttachmentsList({
  attachments,
}: {
  attachments: NonNullable<ReturnType<typeof useContactDetail>["detail"]>["attachments"];
}) {
  return (
    <div>
      <div className="section-title" style={{ marginBottom: 8 }}>
        Documentos adjuntos
        <span
          className="chip"
          style={{ marginLeft: 8, fontSize: 10, padding: "1px 6px" }}
        >
          {attachments.length}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {attachments.map((a) => (
          <a
            key={a.fileId}
            href={a.url || "#"}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              borderRadius: 8,
              textDecoration: "none",
              color: "var(--text-1)",
              fontSize: 12.5,
              cursor: a.url ? "pointer" : "not-allowed",
              opacity: a.url ? 1 : 0.5,
            }}
          >
            <span style={{ fontSize: 18 }}>📎</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {a.fileName || a.fileId}
              </div>
              <div className="muted" style={{ fontSize: 10.5 }}>
                {fmtFileSize(a.fileSizeBytes) || a.fileStatus || ""}
              </div>
            </div>
            {a.url ? (
              <span style={{ fontSize: 11, color: "var(--accent-cyan)" }}>
                Descargar ↓
              </span>
            ) : (
              <span className="muted" style={{ fontSize: 10.5 }}>
                {a.fileStatus || "no disponible"}
              </span>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

function TranscriptRow({
  segment,
  clickable,
  onSeek,
}: {
  segment: ContactTranscriptSegment;
  clickable: boolean;
  onSeek: (seconds: number) => void;
}) {
  const isCustomer = segment.participant === "CUSTOMER";
  const sentimentColor =
    segment.sentiment === "POSITIVE"
      ? "var(--accent-green)"
      : segment.sentiment === "NEGATIVE"
      ? "var(--accent-red)"
      : null;
  const offsetSec = segment.beginOffsetMs / 1000;
  const offsetLabel = useMemo(() => {
    const m = Math.floor(offsetSec / 60);
    const s = Math.floor(offsetSec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [offsetSec]);

  return (
    <div
      onClick={clickable ? () => onSeek(offsetSec) : undefined}
      style={{
        padding: "8px 10px",
        background: isCustomer ? "var(--bg-2)" : "var(--accent-cyan-soft)",
        borderRadius: 6,
        cursor: clickable ? "pointer" : "default",
        display: "flex",
        gap: 10,
        fontSize: 12,
      }}
    >
      <div
        style={{
          minWidth: 60,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            color: isCustomer ? "var(--text-2)" : "var(--accent-cyan)",
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {isCustomer
            ? "Cliente"
            : segment.participant === "AGENT"
            ? "Agente"
            : segment.participant}
        </span>
        <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
          {offsetLabel}
        </span>
        {sentimentColor && (
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: sentimentColor,
            }}
            title={segment.sentiment}
          />
        )}
      </div>
      <div style={{ flex: 1, color: "var(--text-1)", lineHeight: 1.5 }}>
        {sanitizeText(segment.content || "")}
      </div>
    </div>
  );
}
