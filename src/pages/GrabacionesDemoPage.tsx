import { useEffect, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Gauge, Phone, Clock, Disc3, Sparkles } from "lucide-react";
import { WaveformTimeline } from "@/components/recordings/WaveformTimeline";
import { TranscriptViewer } from "@/components/recordings/TranscriptViewer";
import type { TranscriptSegment } from "@/types/recordings";

/**
 * /grabaciones-demo — preview auth-free del REPRODUCTOR PROTAGONISTA de la vista
 * de Llamadas rediseñada (#grabaciones fase3): tira selectora de llamadas +
 * la llamada elegida a pantalla completa (onda por sentiment + transporte +
 * transcripción sincronizada). Transporte SIMULADO (sin archivo de audio) para
 * que renderice sin una grabación real de Connect; la onda y la transcripción
 * son los componentes de producción.
 */
const DURATION = 100;

const MOCK: TranscriptSegment[] = [
  { participant: "AGENT", content: "Buenas tardes, le saluda Andrea de Cobranzas Novasys. ¿Hablo con el señor Pérez?", beginOffsetMillis: 1000, endOffsetMillis: 7000, sentiment: "NEUTRAL" },
  { participant: "CUSTOMER", content: "Sí, soy yo. Pero ya les dije que este mes no puedo pagar, me están llamando todos los días.", beginOffsetMillis: 8000, endOffsetMillis: 16000, sentiment: "NEGATIVE" },
  { participant: "AGENT", content: "Entiendo su molestia y le pido disculpas por las llamadas. Justamente lo llamo para ayudarlo a encontrar una solución.", beginOffsetMillis: 17000, endOffsetMillis: 26000, sentiment: "NEUTRAL" },
  { participant: "CUSTOMER", content: "¿Qué tipo de solución? Porque la deuda ya creció demasiado con los intereses.", beginOffsetMillis: 27000, endOffsetMillis: 34000, sentiment: "NEGATIVE" },
  { participant: "AGENT", content: "Tenemos un plan de refinanciamiento que congela los intereses y baja su cuota a la mitad. Quedaría en 120 soles mensuales.", beginOffsetMillis: 35000, endOffsetMillis: 46000, sentiment: "NEUTRAL" },
  { participant: "CUSTOMER", content: "Mmm… 120 soles sí lo podría manejar. ¿Y eso incluye todo, sin sorpresas después?", beginOffsetMillis: 47000, endOffsetMillis: 55000, sentiment: "MIXED" },
  { participant: "AGENT", content: "Exacto, sin sorpresas. Le envío el detalle por WhatsApp ahora mismo para que lo revise con calma.", beginOffsetMillis: 56000, endOffsetMillis: 65000, sentiment: "POSITIVE" },
  { participant: "CUSTOMER", content: "Ah, buenísimo. La verdad me saca un peso de encima, gracias por la paciencia.", beginOffsetMillis: 66000, endOffsetMillis: 74000, sentiment: "POSITIVE" },
  { participant: "AGENT", content: "Para eso estamos. Dejo agendado el primer pago para el 15. ¿Le parece bien?", beginOffsetMillis: 75000, endOffsetMillis: 84000, sentiment: "POSITIVE" },
  { participant: "CUSTOMER", content: "Perfecto, el 15 está bien. Muchas gracias, Andrea.", beginOffsetMillis: 85000, endOffsetMillis: 92000, sentiment: "POSITIVE" },
];

const CALLS = [
  { id: "c1", when: "hoy · 15:20", dur: "1:40", agent: "andrea.cobranzas", rec: true },
  { id: "c2", when: "ayer · 11:05", dur: "3:12", agent: "andrea.cobranzas", rec: true },
  { id: "c3", when: "12 jun · 09:40", dur: "0:48", agent: "luis.ventas", rec: false },
];

const SPEEDS = [1, 1.5, 2];
function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function GrabacionesDemoPage() {
  const [posSec, setPosSec] = useState(54);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [sel, setSel] = useState("c1");
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * SPEEDS[speedIdx];
      last = now;
      setPosSec((p) => { const next = p + dt; if (next >= DURATION) { setPlaying(false); return DURATION; } return next; });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, speedIdx]);

  const skip = (s: number) => setPosSec((p) => Math.max(0, Math.min(DURATION, p + s)));
  const iconBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border-1)", background: "var(--bg-1)", color: "var(--text-1)", cursor: "pointer" };

  return (
    <div style={{ height: "100vh", overflow: "auto", background: "var(--bg-0)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: 22 }}>
        <div style={{ marginBottom: 6, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>
          Grabaciones · preview del rediseño (datos mock)
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 16px", color: "var(--text-1)" }}>Llamadas · reproductor protagonista + insights</h1>

        <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
        <div className="cpv" style={{ flex: 1, minWidth: 0, height: 640, border: "1px solid var(--border-1)", borderRadius: 12, background: "var(--bg-1)", overflow: "hidden" }}>
          <div className="cpv__strip">
            {CALLS.map((c) => (
              <button key={c.id} className={`cpv__pill ${sel === c.id ? "cpv__pill--on" : ""}`} onClick={() => setSel(c.id)}>
                <span className="cpv__pill-top">{c.rec && <Disc3 size={11} />}{c.when}</span>
                <span className="cpv__pill-sub">{c.dur} · {c.agent}</span>
              </button>
            ))}
          </div>

          <div className="cpv__main">
            <div className="cpv__meta">
              <span className="cpv__meta-av"><Phone size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cpv__meta-name">andrea.cobranzas <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>· Cobranzas</span></div>
                <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>martes 16 de junio 2026 · 15:20 · hace 2 horas</div>
              </div>
              <span className="chip" style={{ fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 4 }}><Clock size={11} /> {fmt(DURATION)}</span>
              <span className="chip" style={{ fontSize: 10.5, color: "var(--accent-green)", background: "var(--accent-green-soft)", borderColor: "transparent" }}>Acuerdo de pago</span>
            </div>

            <div style={{ border: "1px solid var(--border-1)", background: "var(--bg-2)", borderRadius: 10, padding: 12 }}>
              <WaveformTimeline durationSec={DURATION} currentSec={posSec} segments={MOCK} onSeekSec={(s) => setPosSec(s)} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <button style={iconBtn} onClick={() => skip(-10)} aria-label="Retroceder 10 segundos" title="−10 s"><SkipBack size={15} /></button>
                <button style={{ ...iconBtn, width: 38, height: 38, background: "var(--accent-violet)", borderColor: "var(--accent-violet)", color: "#fff" }} onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pausar" : "Reproducir"}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
                <button style={iconBtn} onClick={() => skip(10)} aria-label="Avanzar 10 segundos" title="+10 s"><SkipForward size={15} /></button>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text-2)", minWidth: 92 }}>{fmt(posSec)} / {fmt(DURATION)}</span>
                <button style={{ ...iconBtn, width: "auto", padding: "0 10px", gap: 5, marginLeft: "auto", fontSize: 11.5, fontWeight: 600 }} onClick={() => setSpeedIdx((s) => (s + 1) % SPEEDS.length)} aria-label={`Velocidad ${SPEEDS[speedIdx]}×`} title="Velocidad de reproducción"><Gauge size={13} /> {SPEEDS[speedIdx]}×</button>
              </div>
            </div>

            <div className="cpv__transcript">
              <TranscriptViewer segments={MOCK} currentTimeMs={posSec * 1000} onSeek={(ms) => setPosSec(ms / 1000)} />
            </div>
          </div>
        </div>

        <aside className="rec-ctx" style={{ height: 640, border: "1px solid var(--border-1)", borderRadius: 12 }}>
          <div className="rec-ctx__title">Insights de la llamada</div>
          <div className="rec-ctx__ai">
            <div className="rec-ctx__ai-h"><Sparkles size={13} /> Resumen IA</div>
            <div className="rec-ctx__ai-b">El cliente estaba molesto por la deuda y las llamadas constantes. La agente ofreció refinanciar a S/120 al mes congelando los intereses y cerró el primer pago para el 15. Terminó conforme.</div>
            <div className="rec-sent">
              <div className="rec-sent__lbl">Sentimiento de la conversación</div>
              <div className="rec-sent__bar">
                <span style={{ flex: 4, background: "var(--accent-green)" }} />
                <span style={{ flex: 3, background: "var(--bg-3)" }} />
                <span style={{ flex: 1, background: "var(--accent-amber)" }} />
                <span style={{ flex: 2, background: "var(--accent-red)" }} />
              </div>
              <div className="rec-sent__legend">
                <span><span className="rec-sent__dot" style={{ background: "var(--accent-green)" }} /> 4 positivos</span>
                <span><span className="rec-sent__dot" style={{ background: "var(--accent-red)" }} /> 2 negativos</span>
              </div>
            </div>
          </div>
        </aside>
        </div>
      </div>
    </div>
  );
}
