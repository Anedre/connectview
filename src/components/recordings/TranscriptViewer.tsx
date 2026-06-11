import { useEffect, useRef } from "react";
import { sentimentColor } from "@/components/recordings/WaveformTimeline";
import type { TranscriptSegment } from "@/types/recordings";

interface TranscriptViewerProps {
  segments: TranscriptSegment[];
  currentTimeMs?: number;
  /** Click-to-seek: jump the audio to a segment's start. When provided, each
   *  row becomes an accessible button. */
  onSeek?: (ms: number) => void;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

const PARTICIPANT_LABELS: Record<string, string> = {
  AGENT: "Agente",
  CUSTOMER: "Cliente",
  SYSTEM: "Sistema",
  UNKNOWN: "—",
};

export function TranscriptViewer({
  segments,
  currentTimeMs,
  onSeek,
}: TranscriptViewerProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  // The segment currently under the playhead. -1 when none / no audio.
  const activeIdx = segments.findIndex(
    (seg) =>
      currentTimeMs !== undefined &&
      currentTimeMs >= seg.beginOffsetMillis &&
      currentTimeMs <= seg.endOffsetMillis
  );

  // Follow the audio: keep the active line in view as playback advances.
  useEffect(() => {
    if (activeIdx >= 0) {
      activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeIdx]);

  if (segments.length === 0) {
    return (
      <p
        className="muted"
        style={{ padding: "28px 0", textAlign: "center", fontSize: 12.5 }}
      >
        Sin transcripción disponible para este contacto.
      </p>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        maxHeight: 500,
        overflowY: "auto",
      }}
    >
      {segments.map((seg, i) => {
        const isActive = i === activeIdx;
        const isAgent = seg.participant === "AGENT";
        const label = PARTICIPANT_LABELS[seg.participant] || seg.participant;
        const accent = sentimentColor(seg.sentiment);
        const clickable = !!onSeek;
        const showSentiment =
          seg.sentiment && seg.sentiment.toUpperCase() !== "NEUTRAL";

        return (
          <div
            key={i}
            ref={isActive ? activeRef : undefined}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            aria-label={
              clickable
                ? `Saltar a ${formatTime(seg.beginOffsetMillis)} — ${label}`
                : undefined
            }
            onClick={clickable ? () => onSeek!(seg.beginOffsetMillis) : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSeek!(seg.beginOffsetMillis);
                    }
                  }
                : undefined
            }
            style={{
              display: "flex",
              gap: 10,
              padding: "9px 11px",
              borderRadius: 8,
              border: "1px solid var(--border-1)",
              borderLeftWidth: 3,
              borderLeftStyle: "solid",
              borderLeftColor: accent,
              background: isActive ? "var(--bg-active)" : "var(--bg-1)",
              cursor: clickable ? "pointer" : "default",
              outline: "none",
              transition: "background 100ms",
              boxShadow: isActive
                ? `inset 0 0 0 1px color-mix(in srgb, ${accent} 35%, transparent)`
                : "none",
            }}
          >
            <div style={{ flexShrink: 0, width: 60 }}>
              <span
                className="chip"
                style={{
                  fontSize: 9.5,
                  height: 17,
                  background: isAgent
                    ? "var(--accent-violet-soft)"
                    : "var(--bg-2)",
                  color: isAgent ? "var(--accent-violet)" : "var(--text-2)",
                }}
              >
                {label}
              </span>
              <div
                className="mono"
                style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}
              >
                {formatTime(seg.beginOffsetMillis)}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  color: "var(--text-1)",
                }}
              >
                {seg.content}
              </p>
              {showSentiment && (
                <span
                  style={{
                    display: "inline-block",
                    marginTop: 3,
                    fontSize: 10,
                    fontWeight: 700,
                    color: accent,
                    textTransform: "capitalize",
                  }}
                >
                  {seg.sentiment!.toLowerCase()}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
