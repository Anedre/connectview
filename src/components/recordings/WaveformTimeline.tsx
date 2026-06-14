import { useMemo, useRef, useState } from "react";
import { Flag } from "lucide-react";
import type { TranscriptSegment } from "@/types/recordings";

/**
 * Sentiment → vox accent color. Exported so the transcript rows can match the
 * exact same palette the waveform uses (one family).
 */
export function sentimentColor(sentiment?: string): string {
  switch ((sentiment || "").toUpperCase()) {
    case "POSITIVE":
      return "var(--accent-green)";
    case "NEGATIVE":
      return "var(--accent-red)";
    case "MIXED":
      return "var(--accent-amber)";
    default:
      return "var(--accent-cyan)"; // NEUTRAL / unknown but with speech
  }
}

export interface KeyMoment { sec: number; tone: "pos" | "neg"; label: string }

/**
 * "Momentos clave" de una llamada: los puntos donde el sentimiento VIRA hacia
 * positivo o negativo (no uno por segmento). Compartido por la onda (pines) y
 * por el slide-over de Resumen IA, para una sola fuente de verdad.
 */
export function keyMoments(segments: TranscriptSegment[]): KeyMoment[] {
  const out: KeyMoment[] = [];
  let prev = "";
  for (const s of segments) {
    const k = (s.sentiment || "").toUpperCase();
    if ((k === "NEGATIVE" || k === "POSITIVE") && k !== prev) {
      out.push({ sec: (s.beginOffsetMillis || 0) / 1000, tone: k === "POSITIVE" ? "pos" : "neg", label: k === "POSITIVE" ? "Momento positivo" : "Tensión" });
    }
    if (k === "NEGATIVE" || k === "POSITIVE") prev = k;
  }
  return out.slice(0, 6);
}

const BAR_COUNT = 120;

/** Stable pseudo-random in [0,1) from an integer index. Used for bar heights so
 *  the waveform reads as "organic" without jittering across renders (no
 *  Math.random, which would re-roll every paint). */
function hash01(i: number): number {
  const x = Math.sin((i + 1) * 99.137) * 43758.5453;
  return x - Math.floor(x);
}

function fmt(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface Props {
  /** Total length used to lay out the track (sec). */
  durationSec: number;
  /** Playhead position (sec). */
  currentSec: number;
  /** Transcript segments → per-bar sentiment color + markers. */
  segments: TranscriptSegment[];
  onSeekSec: (sec: number) => void;
  height?: number;
}

/**
 * A premium, data-driven "waveform" for a call recording. We do NOT decode the
 * audio (Connect recordings frequently lack CORS, which would break a Web-Audio
 * decode); instead each bar is colored by the SENTIMENT of the transcript
 * segment playing at that moment, with deterministic heights. The supervisor
 * reads the emotional arc of the call at a glance, and can click / drag / use
 * the keyboard to seek.
 */
export function WaveformTimeline({
  durationSec,
  currentSec,
  segments,
  onSeekSec,
  height = 54,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const dur = durationSec > 0 ? durationSec : 1;

  const bars = useMemo(() => {
    const slice = dur / BAR_COUNT;
    return Array.from({ length: BAR_COUNT }, (_, i) => {
      const midMs = (i + 0.5) * slice * 1000;
      const seg = segments.find(
        (s) => midMs >= s.beginOffsetMillis && midMs <= s.endOffsetMillis
      );
      const speech = !!seg;
      const h = speech
        ? 0.42 + 0.58 * hash01(i)
        : 0.12 + 0.12 * hash01(i * 7);
      return {
        color: speech ? sentimentColor(seg?.sentiment) : "var(--text-3)",
        h,
      };
    });
  }, [segments, dur]);

  // Flag pins above the track at the sentiment shifts (see keyMoments) — a
  // handful of meaningful moments, clickable to seek.
  const markers = useMemo(
    () =>
      keyMoments(segments).map((m) => ({
        ...m,
        left: Math.min(100, Math.max(0, (m.sec / dur) * 100)),
        color: m.tone === "pos" ? sentimentColor("POSITIVE") : sentimentColor("NEGATIVE"),
        label: `${m.label} · ${fmt(m.sec * 1000)}`,
      })),
    [segments, dur]
  );

  const progressPct = Math.min(100, Math.max(0, (currentSec / dur) * 100));

  const seekFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeekSec(pct * dur);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const big = e.shiftKey ? 10 : 5;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
        next = Math.min(dur, currentSec + big);
        break;
      case "ArrowLeft":
        next = Math.max(0, currentSec - big);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = dur;
        break;
      case "PageUp":
        next = Math.min(dur, currentSec + 30);
        break;
      case "PageDown":
        next = Math.max(0, currentSec - 30);
        break;
      default:
        return;
    }
    e.preventDefault();
    onSeekSec(next);
  };

  return (
    <div style={{ position: "relative", paddingTop: 8 }}>
      {/* Momentos clave — flag pins at sentiment shifts, clickable to seek */}
      <div style={{ position: "relative", height: markers.length ? 24 : 6, marginBottom: 2 }}>
        {markers.map((m, i) => (
          <button
            key={i}
            title={m.label}
            onClick={(e) => { e.stopPropagation(); onSeekSec(m.sec); }}
            style={{
              position: "absolute",
              left: `${m.left}%`,
              top: 0,
              transform: "translateX(-50%)",
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              lineHeight: 0,
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 6,
                background: m.color,
                display: "grid",
                placeItems: "center",
                color: "#fff",
                boxShadow: "var(--sh-2, 0 2px 6px rgba(16,21,37,.18))",
              }}
            >
              <Flag size={10} strokeWidth={2.4} />
            </span>
          </button>
        ))}
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Línea de tiempo de la grabación"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(currentSec)}
        aria-valuetext={`${fmt(currentSec * 1000)} de ${fmt(dur * 1000)}`}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={(e) => seekFromClientX(e.clientX)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seekFromClientX(e.clientX);
        }}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-end",
          gap: 1,
          height,
          cursor: "pointer",
          userSelect: "none",
          outline: focused ? "2px solid var(--accent-violet)" : "none",
          outlineOffset: 3,
          borderRadius: 4,
        }}
      >
        {bars.map((b, i) => {
          const barPct = ((i + 0.5) / BAR_COUNT) * 100;
          const played = barPct <= progressPct;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${Math.round(b.h * 100)}%`,
                background: b.color,
                opacity: played ? 1 : 0.4,
                borderRadius: 1.5,
                transition: "opacity 80ms linear",
              }}
            />
          );
        })}

        {/* Playhead */}
        <div
          style={{
            position: "absolute",
            left: `${progressPct}%`,
            top: -3,
            bottom: -3,
            width: 2,
            transform: "translateX(-1px)",
            background: "var(--text-1)",
            borderRadius: 2,
            pointerEvents: "none",
            boxShadow: "0 0 0 2px var(--bg-2)",
          }}
        />
      </div>
    </div>
  );
}
