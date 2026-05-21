import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { useContactDetail, type ContactTranscriptSegment } from "@/hooks/useContactDetail";
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

function channelMeta(channel: string) {
  const k = channel.toUpperCase();
  if (k === "VOICE") return { icon: "📞", label: "Llamada", color: "var(--accent-green)" };
  if (k === "CHAT") return { icon: "💬", label: "Chat", color: "var(--accent-cyan)" };
  if (k === "EMAIL") return { icon: "📧", label: "Email", color: "var(--accent-amber)" };
  if (k === "TASK") return { icon: "📋", label: "Tarea", color: "var(--accent-violet)" };
  return { icon: "📄", label: channel, color: "var(--text-2)" };
}

/**
 * Full-screen modal that opens when the agent clicks on a row in the
 * contact history timeline. Shows:
 *   - Header: channel, agent, queue, duration, timestamp
 *   - Audio player with seek (presigned S3 URL) — voice only
 *   - Transcript with participant tags, sentiment chips, time offsets
 *   - Attachments grid with download buttons
 *   - Raw attributes panel (collapsed by default)
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
    () => channelMeta(detail?.channel || "VOICE"),
    [detail?.channel]
  );

  if (!open) return null;

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
            display: "grid",
            gridTemplateColumns: detail?.transcript ? "1.4fr 1fr" : "1fr",
            gap: 18,
            minHeight: 200,
          }}
        >
          {loading && !detail && (
            <div
              style={{
                gridColumn: "1 / -1",
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
                gridColumn: "1 / -1",
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

          {/* LEFT — transcript + recording */}
          {detail && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {detail.recording && (
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
              )}
              {detail.transcript && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
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
                      maxHeight: 480,
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
                        onSeek={(sec) => setSeekTarget(sec)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {!detail.recording && !detail.transcript && (
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
                  Sin grabación ni transcripción disponibles para este contacto.
                </div>
              )}
            </div>
          )}

          {/* RIGHT — attachments + attributes */}
          {detail && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Attachments */}
              <div>
                <div className="section-title" style={{ marginBottom: 8 }}>
                  Documentos adjuntos
                  <span
                    className="chip"
                    style={{ marginLeft: 8, fontSize: 10, padding: "1px 6px" }}
                  >
                    {detail.attachments.length}
                  </span>
                </div>
                {detail.attachments.length === 0 ? (
                  <div
                    style={{
                      padding: 14,
                      border: "1px dashed var(--border-1)",
                      borderRadius: 8,
                      textAlign: "center",
                      color: "var(--text-3)",
                      fontSize: 12,
                    }}
                  >
                    Sin documentos adjuntos.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {detail.attachments.map((a) => (
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
                          <span
                            style={{ fontSize: 11, color: "var(--accent-cyan)" }}
                          >
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
                )}
              </div>

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
            </div>
          )}
        </div>
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
          {isCustomer ? "Cliente" : segment.participant === "AGENT" ? "Agente" : segment.participant}
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
        {segment.content}
      </div>
    </div>
  );
}
