import type { TranscriptSegment } from "@/types/recordings";

/**
 * callChapters — "capítulos" automáticos de una llamada, estilo tabla de
 * contenido de YouTube. Se derivan SOLO del transcript (sin IA ni backend): la
 * apertura, cada viraje de sentimiento y las pausas largas marcan un capítulo, y
 * el título es un extracto real de lo que se dijo ahí. El supervisor lee el arco
 * de la llamada y salta directo al tramo que le interesa.
 */
export interface Chapter {
  sec: number;
  title: string;
  tone: "pos" | "neg" | "neutral";
}

/** Gap (ms) entre el fin de un segmento y el inicio del siguiente que cuenta como
 *  "pausa larga" → probable cambio de tema. */
const GAP_MS = 8000;
/** Cortes más cercanos que esto (s) se funden — evita capítulos de 2 segundos. */
const MIN_SPACING_SEC = 12;

function extractTitle(content: string, max = 46): string {
  const clean = (content || "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s\S*$/, "") + "…";
}

export function deriveChapters(segments: TranscriptSegment[]): Chapter[] {
  if (segments.length === 0) return [];
  const raw: Chapter[] = [];

  // 1. Apertura — extracto del primer segmento con texto.
  const first = segments.find((s) => (s.content || "").trim());
  raw.push({
    sec: (first?.beginOffsetMillis ?? segments[0].beginOffsetMillis ?? 0) / 1000,
    title: extractTitle(first?.content || "") || "Apertura",
    tone: "neutral",
  });

  // 2. Virajes de sentimiento + pausas largas.
  let prevSent = "";
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const startSec = (s.beginOffsetMillis || 0) / 1000;
    const k = (s.sentiment || "").toUpperCase();

    if ((k === "POSITIVE" || k === "NEGATIVE") && k !== prevSent) {
      raw.push({
        sec: startSec,
        title:
          (k === "POSITIVE" ? "Giro positivo" : "Tensión") +
          (extractTitle(s.content, 34) ? ` · ${extractTitle(s.content, 34)}` : ""),
        tone: k === "POSITIVE" ? "pos" : "neg",
      });
      prevSent = k;
    } else if (k === "POSITIVE" || k === "NEGATIVE") {
      prevSent = k;
    }

    if (i > 0) {
      const prev = segments[i - 1];
      const gap = (s.beginOffsetMillis || 0) - (prev.endOffsetMillis || 0);
      if (gap > GAP_MS && (s.content || "").trim()) {
        raw.push({ sec: startSec, title: extractTitle(s.content), tone: "neutral" });
      }
    }
  }

  // 3. Ordena, funde cortes muy cercanos (prioriza el que tenga tono no-neutral),
  //    y limita a 8 capítulos legibles.
  raw.sort((a, b) => a.sec - b.sec);
  const out: Chapter[] = [];
  for (const c of raw) {
    const last = out[out.length - 1];
    if (last && c.sec - last.sec < MIN_SPACING_SEC) {
      // Si el nuevo aporta tono (viraje) y el anterior era neutral, lo reemplaza.
      if (c.tone !== "neutral" && last.tone === "neutral") out[out.length - 1] = c;
      continue;
    }
    out.push(c);
  }
  return out.slice(0, 8);
}

const mmss = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

const TONE_COLOR: Record<Chapter["tone"], string> = {
  pos: "var(--accent-green)",
  neg: "var(--accent-red)",
  neutral: "var(--text-3)",
};

/**
 * CallChapters — tira de capítulos navegables bajo la onda. Cada chip salta el
 * audio a ese punto. Se oculta si hay menos de 2 capítulos (nada que navegar).
 */
export function CallChapters({
  chapters,
  currentMs,
  onSeek,
}: {
  chapters: Chapter[];
  currentMs: number;
  onSeek: (ms: number) => void;
}) {
  if (chapters.length < 2) return null;
  const curSec = currentMs / 1000;
  // El capítulo activo es el último cuyo inicio ya pasó el cabezal.
  let activeIdx = 0;
  for (let i = 0; i < chapters.length; i++) if (chapters[i].sec <= curSec + 0.25) activeIdx = i;

  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: ".05em",
          color: "var(--text-3)",
          marginBottom: 6,
        }}
      >
        Capítulos de la llamada
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {chapters.map((c, i) => {
          const on = i === activeIdx;
          const color = TONE_COLOR[c.tone];
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSeek(c.sec * 1000)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                width: "100%",
                textAlign: "left",
                padding: "6px 9px",
                borderRadius: 8,
                border: "1px solid var(--border-1)",
                borderLeft: `3px solid ${color}`,
                background: on ? "var(--bg-active)" : "var(--bg-1)",
                cursor: "pointer",
                color: "var(--text-1)",
              }}
            >
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--text-3)", flex: "0 0 auto", width: 34 }}
              >
                {mmss(c.sec)}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: on ? 700 : 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {c.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
