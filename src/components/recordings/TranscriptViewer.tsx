import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { sentimentColor } from "@/components/recordings/WaveformTimeline";
import type { TranscriptSegment } from "@/types/recordings";

interface TranscriptViewerProps {
  segments: TranscriptSegment[];
  currentTimeMs?: number;
  /** Click-to-seek: jump the audio to a segment's start. When provided, each
   *  row becomes an accessible button. */
  onSeek?: (ms: number) => void;
  /** Muestra la barra de búsqueda dentro del transcript. Default true. */
  searchable?: boolean;
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

/** Resalta todas las apariciones de `q` en `text` con `<mark>`. Sin `q`, devuelve
 *  el texto tal cual. Case-insensitive, conserva el texto original en el match. */
function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) {
      out.push(text.slice(i));
      break;
    }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(
      <mark
        key={k++}
        style={{
          background: "var(--accent-amber-soft)",
          color: "inherit",
          borderRadius: 2,
          padding: "0 1px",
        }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  return out;
}

export function TranscriptViewer({
  segments,
  currentTimeMs,
  onSeek,
  searchable = true,
}: TranscriptViewerProps) {
  const activeRef = useRef<HTMLDivElement>(null);
  const matchRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const q = query.trim();

  // The segment currently under the playhead. -1 when none / no audio.
  const activeIdx = segments.findIndex(
    (seg) =>
      currentTimeMs !== undefined &&
      currentTimeMs >= seg.beginOffsetMillis &&
      currentTimeMs <= seg.endOffsetMillis,
  );

  // Índices de segmentos que contienen el término buscado (case-insensitive).
  const matches = useMemo(() => {
    if (!q) return [];
    const ql = q.toLowerCase();
    const out: number[] = [];
    segments.forEach((s, i) => {
      if ((s.content || "").toLowerCase().includes(ql)) out.push(i);
    });
    return out;
  }, [segments, q]);

  const [activePos, setActivePos] = useState(0);
  useEffect(() => {
    setActivePos(0);
  }, [q]);
  const clampedPos = matches.length > 0 ? Math.min(activePos, matches.length - 1) : 0;
  const matchSegIdx = matches.length > 0 ? matches[clampedPos] : -1;

  // Centra la coincidencia activa en vista. Solo SCROLL — NO seek: al tipear, el
  // match activo cambia con cada tecla y saltar el audio en cada una sería molesto.
  // El seek se hace explícitamente en goMatch (Enter / flechas).
  useEffect(() => {
    if (matchSegIdx < 0) return;
    matchRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [matchSegIdx]);

  // Follow the audio: keep the active line in view as playback advances (solo
  // cuando no hay una búsqueda dirigiendo el scroll).
  useEffect(() => {
    if (q) return;
    if (activeIdx >= 0) {
      activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeIdx, q]);

  const goMatch = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (clampedPos + dir + matches.length) % matches.length;
    setActivePos(next);
    // Seek explícito a la coincidencia navegada (el tipeo NO hace seek).
    const seg = segments[matches[next]];
    if (seg && onSeek) onSeek(seg.beginOffsetMillis);
  };

  if (segments.length === 0) {
    return (
      <p className="muted" style={{ padding: "28px 0", textAlign: "center", fontSize: 12.5 }}>
        Sin transcripción disponible para este contacto.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      {searchable && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 8px",
            marginBottom: 6,
            borderRadius: 8,
            border: "1px solid var(--border-1)",
            background: "var(--bg-1)",
            position: "sticky",
            top: 0,
            zIndex: 1,
          }}
        >
          <Search size={14} style={{ color: "var(--text-3)", flex: "0 0 auto" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                goMatch(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                setQuery("");
              }
            }}
            placeholder="Buscar en la transcripción…"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              background: "transparent",
              outline: "none",
              fontSize: 12.5,
              color: "var(--text-1)",
            }}
          />
          {q && (
            <>
              <span
                className="tnum"
                style={{ fontSize: 11, color: "var(--text-3)", flex: "0 0 auto" }}
              >
                {matches.length > 0 ? `${clampedPos + 1}/${matches.length}` : "0"}
              </span>
              <button
                type="button"
                onClick={() => goMatch(-1)}
                disabled={matches.length === 0}
                aria-label="Coincidencia anterior"
                className="rec-search__nav"
                style={navBtn(matches.length === 0)}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => goMatch(1)}
                disabled={matches.length === 0}
                aria-label="Coincidencia siguiente"
                className="rec-search__nav"
                style={navBtn(matches.length === 0)}
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Limpiar búsqueda"
                style={navBtn(false)}
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      )}

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
          const isMatch = i === matchSegIdx;
          const isAgent = seg.participant === "AGENT";
          const label = PARTICIPANT_LABELS[seg.participant] || seg.participant;
          const accent = sentimentColor(seg.sentiment);
          const clickable = !!onSeek;
          const showSentiment = seg.sentiment && seg.sentiment.toUpperCase() !== "NEUTRAL";

          return (
            <div
              key={i}
              ref={isMatch ? matchRef : isActive ? activeRef : undefined}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={
                clickable ? `Saltar a ${formatTime(seg.beginOffsetMillis)} — ${label}` : undefined
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
                boxShadow: isMatch
                  ? "inset 0 0 0 2px var(--accent-amber)"
                  : isActive
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
                    background: isAgent ? "var(--accent-violet-soft)" : "var(--bg-2)",
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
                  {q ? highlight(seg.content, q) : seg.content}
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
    </div>
  );
}

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    flex: "0 0 auto",
    borderRadius: 6,
    border: "1px solid var(--border-1)",
    background: "var(--bg-1)",
    color: disabled ? "var(--text-3)" : "var(--text-1)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
