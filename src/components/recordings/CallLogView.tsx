import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";
import { getApiEndpoints } from "@/lib/api";
import { AudioPlayer } from "@/components/recordings/AudioPlayer";
import { TranscriptViewer } from "@/components/recordings/TranscriptViewer";
import { useContactDetail } from "@/hooks/useContactDetail";
import { VALORACION_META } from "@/lib/dispositions";
import { formatDurationSec, sanitizeText } from "@/lib/utils";
import * as Icon from "@/components/vox/primitives";
import type { TranscriptSegment } from "@/types/recordings";

/**
 * "Bitácora telefónica" — vertical timeline of large cards, one per call.
 * Each card surfaces the most useful at-a-glance facts (agent, when,
 * duration, disposition) plus a 2-line transcript preview when available.
 * Clicking the card expands it inline: AudioPlayer + TranscriptViewer with
 * time-synced segment highlighting, exactly like the per-contact detail
 * view — but you don't have to navigate away to compare across calls.
 *
 * Used as the dedicated "Llamadas" lens in /recordings.
 */

interface Props {
  phone: string | null;
}

interface CallRow {
  contactId: string;
  channel: string;
  initiationTimestamp: string;
  duration: number;
  agentUsername: string;
  queueName: string;
  disconnectReason?: string;
  hasRecording: boolean;
}

interface HistoryResponse {
  totalContacts: number;
  contacts: CallRow[];
}

export function CallLogView({ phone }: Props) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    setExpandedId(null);
    if (!phone) return;
    const ep = getApiEndpoints();
    const url = ep?.getContactHistory;
    if (!url) {
      setError("Endpoint no configurado");
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`${url}?phone=${encodeURIComponent(phone)}&limit=200`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, status: r.status, j })))
      .then(({ ok, status, j }) => {
        if (!ok) throw new Error(j.message || `HTTP ${status}`);
        setData(j as HistoryResponse);
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Error");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [phone]);

  const callRows = useMemo(() => {
    if (!data) return [];
    return (data.contacts || []).filter((c) => {
      const ch = (c.channel || "").toUpperCase();
      return ch === "VOICE" || ch === "TELEPHONY";
    });
  }, [data]);

  if (!phone) {
    return (
      <div
        style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}
      >
        Selecciona un cliente para ver su bitácora de llamadas.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center", fontSize: 12.5 }}>
        Cargando llamadas…
      </div>
    );
  }
  if (error) {
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
        {error}
      </div>
    );
  }
  if (callRows.length === 0) {
    return (
      <div
        style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}
      >
        Este cliente no tiene llamadas registradas.
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
          <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>
            {callRows.length} llamada{callRows.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* Scroller — vertical timeline of cards */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {callRows.map((row) => (
          <CallCard
            key={row.contactId}
            row={row}
            expanded={expandedId === row.contactId}
            onToggle={() =>
              setExpandedId((cur) => (cur === row.contactId ? null : row.contactId))
            }
          />
        ))}
      </div>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────

function CallCard({
  row,
  expanded,
  onToggle,
}: {
  row: CallRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const dt = row.initiationTimestamp ? new Date(row.initiationTimestamp) : null;
  const relativeAgo = dt
    ? formatDistanceToNow(dt, { addSuffix: true, locale: es })
    : "";
  const fullDate = dt
    ? format(dt, "EEEE d 'de' MMMM yyyy · HH:mm", { locale: es })
    : "";

  // Only fetch the full detail when expanded — avoids hammering Connect for
  // every visible card.
  const { detail, loading: detailLoading } = useContactDetail(
    expanded ? row.contactId : null
  );

  // Surface the agent disposition chip ("Interesado", "Valoración positiva",
  // …) at the top of the collapsed card so the user can scan calls without
  // expanding each one.
  const wrap = detail?.wrapUp;
  const valMeta =
    wrap?.valoracion && (wrap.valoracion as keyof typeof VALORACION_META) in VALORACION_META
      ? VALORACION_META[wrap.valoracion as keyof typeof VALORACION_META]
      : null;

  // Brief preview of the first 1-2 transcript lines.
  const previewLines = useMemo(() => {
    const segs = (detail?.transcript?.segments || []) as Array<{
      participant?: string;
      content?: string;
    }>;
    return segs
      .map((s) => s.content || "")
      .filter((c) => c && c.length > 5)
      .slice(0, 2);
  }, [detail]);

  // Sync current playback position into the TranscriptViewer for highlight.
  const [currentTimeMs, setCurrentTimeMs] = useState(0);

  // Normalise the transcript segments into TranscriptSegment shape.
  const transcript: TranscriptSegment[] = useMemo(() => {
    const segs = (detail?.transcript?.segments || []) as Array<{
      participant?: string;
      ParticipantRole?: string;
      content?: string;
      Content?: string;
      beginOffsetMs?: number;
      beginOffsetMillis?: number;
      BeginOffsetMillis?: number;
      endOffsetMs?: number;
      endOffsetMillis?: number;
      EndOffsetMillis?: number;
      sentiment?: string;
      Sentiment?: string;
    }>;
    return segs.map((s) => ({
      participant: (s.participant || s.ParticipantRole || "UNKNOWN") as
        | "AGENT"
        | "CUSTOMER"
        | "SYSTEM"
        | "UNKNOWN",
      content: s.content || s.Content || "",
      beginOffsetMillis:
        s.beginOffsetMs ?? s.beginOffsetMillis ?? s.BeginOffsetMillis ?? 0,
      endOffsetMillis: s.endOffsetMs ?? s.endOffsetMillis ?? s.EndOffsetMillis ?? 0,
      sentiment: s.sentiment || s.Sentiment,
    }));
  }, [detail]);

  return (
    <div
      style={{
        border: "1px solid var(--border-1)",
        borderRadius: 10,
        background: "var(--bg-1)",
        boxShadow: expanded ? "0 4px 12px rgba(0,0,0,.08)" : undefined,
        transition: "box-shadow 0.2s",
      }}
    >
      {/* Header (clickable) */}
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          textAlign: "left",
          padding: 14,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: row.hasRecording
              ? "var(--accent-green-soft, #d9fdd3)"
              : "var(--bg-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: 16,
          }}
        >
          📞
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {row.agentUsername || "Agente desconocido"}
            </span>
            <span className="muted" style={{ fontSize: 11 }}>
              · {row.queueName || "—"}
            </span>
            <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>
              {relativeAgo}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }} title={fullDate}>
            {fullDate}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 6,
              fontSize: 11,
              flexWrap: "wrap",
            }}
          >
            <span className="chip" style={{ fontSize: 10.5 }}>
              ⏱ {formatDurationSec(row.duration)}
            </span>
            {row.disconnectReason && (
              <span className="muted" style={{ fontSize: 10.5 }}>
                {row.disconnectReason}
              </span>
            )}
            {valMeta && (
              <span className={`chip ${valMeta.chip}`} style={{ fontSize: 10.5 }}>
                <span className="dot" /> {valMeta.label}
              </span>
            )}
            {wrap?.stageLabel && (
              <span className="chip" style={{ fontSize: 10.5 }}>
                {wrap.stageLabel}
              </span>
            )}
          </div>
          {previewLines.length > 0 && !expanded && (
            <div
              style={{
                marginTop: 8,
                fontSize: 11.5,
                color: "var(--text-2)",
                lineHeight: 1.4,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {previewLines.map((l, i) => (
                <div key={i} style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                  {sanitizeText(l)}
                </div>
              ))}
            </div>
          )}
        </div>
        <div
          style={{
            fontSize: 14,
            color: "var(--text-3)",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          ›
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div
          style={{
            borderTop: "1px solid var(--border-1)",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {detailLoading && (
            <div className="muted" style={{ fontSize: 12, textAlign: "center" }}>
              Cargando audio + transcripción…
            </div>
          )}
          {detail && (
            <>
              {detail.recording?.url ? (
                <AudioPlayer
                  src={detail.recording.url}
                  onTimeUpdate={setCurrentTimeMs}
                />
              ) : (
                <div
                  className="muted"
                  style={{
                    fontSize: 11.5,
                    padding: 12,
                    background: "var(--bg-2)",
                    borderRadius: 6,
                    textAlign: "center",
                  }}
                >
                  No hay grabación de audio para esta llamada.
                </div>
              )}
              {transcript.length > 0 ? (
                <div
                  style={{
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    padding: 8,
                    background: "var(--bg-2)",
                  }}
                >
                  <TranscriptViewer
                    segments={transcript}
                    currentTimeMs={currentTimeMs}
                  />
                </div>
              ) : (
                <div className="muted" style={{ fontSize: 11.5, textAlign: "center" }}>
                  Sin transcripción Contact Lens para esta llamada.
                </div>
              )}
              {wrap?.notes && (
                <div
                  style={{
                    background: "var(--bg-2)",
                    padding: 10,
                    borderRadius: 6,
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  <div
                    className="muted"
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: ".05em",
                      marginBottom: 4,
                    }}
                  >
                    Notas del agente
                  </div>
                  {sanitizeText(wrap.notes)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
