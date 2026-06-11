import { useEffect, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Gauge, Phone } from "lucide-react";
import { WaveformTimeline } from "@/components/recordings/WaveformTimeline";
import { TranscriptViewer } from "@/components/recordings/TranscriptViewer";
import { Card, CardBody, CardHead } from "@/components/vox/primitives";
import type { TranscriptSegment } from "@/types/recordings";

/**
 * /grabaciones-demo — auth-free preview of the premium recording experience
 * (waveform colored by sentiment + markers + click-to-seek transcript). DEV
 * only (gated in App.tsx). The transport here is SIMULATED (no audio file) so
 * the screen renders without a real Connect recording / S3 CORS; the waveform
 * and transcript are the real production components.
 */

const DURATION = 100; // sec

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

const SPEEDS = [1, 1.5, 2];

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function GrabacionesDemoPage() {
  // Seed mid-playback so the screenshot shows the played (bright) vs unplayed
  // (dim) contrast and an active transcript line.
  const [posSec, setPosSec] = useState(60);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * SPEEDS[speedIdx];
      last = now;
      setPosSec((p) => {
        const next = p + dt;
        if (next >= DURATION) {
          setPlaying(false);
          return DURATION;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, speedIdx]);

  const skip = (s: number) =>
    setPosSec((p) => Math.max(0, Math.min(DURATION, p + s)));

  const iconBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    borderRadius: 8,
    border: "1px solid var(--border-1)",
    background: "var(--bg-1)",
    color: "var(--text-1)",
    cursor: "pointer",
  };

  return (
    <div style={{ height: "100vh", overflow: "auto", background: "var(--bg-0)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <div style={{ marginBottom: 6, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>
          Grabaciones · preview de diseño (datos mock)
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 18px", color: "var(--text-1)" }}>
          Detalle de llamada
        </h1>

        <Card style={{ marginBottom: 14 }}>
          <CardBody>
            <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "6px 14px", fontSize: 12.5 }}>
              <span className="muted">Canal</span>
              <span><span className="chip"><Phone size={13} /> Llamada</span></span>
              <span className="muted">Agente</span>
              <span>andrea.cobranzas</span>
              <span className="muted">Cliente</span>
              <span className="mono" style={{ fontSize: 11.5 }}>+51 987 654 321</span>
              <span className="muted">Duración</span>
              <span className="mono">{fmt(DURATION)}</span>
            </div>
          </CardBody>
        </Card>

        <div className="grid-2" style={{ gap: 14 }}>
          <Card>
            <CardHead title="Reproducción de audio" />
            <CardBody>
              <div style={{ border: "1px solid var(--border-1)", background: "var(--bg-2)", borderRadius: 10, padding: 12 }}>
                <WaveformTimeline
                  durationSec={DURATION}
                  currentSec={posSec}
                  segments={MOCK}
                  onSeekSec={(s) => setPosSec(s)}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                  <button style={iconBtn} onClick={() => skip(-10)} aria-label="Retroceder 10 segundos" title="−10 s">
                    <SkipBack size={15} />
                  </button>
                  <button
                    style={{ ...iconBtn, width: 38, height: 38, background: "var(--accent-violet)", borderColor: "var(--accent-violet)", color: "#fff" }}
                    onClick={() => setPlaying((p) => !p)}
                    aria-label={playing ? "Pausar" : "Reproducir"}
                  >
                    {playing ? <Pause size={17} /> : <Play size={17} />}
                  </button>
                  <button style={iconBtn} onClick={() => skip(10)} aria-label="Avanzar 10 segundos" title="+10 s">
                    <SkipForward size={15} />
                  </button>
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--text-2)", minWidth: 92 }}>
                    {fmt(posSec)} / {fmt(DURATION)}
                  </span>
                  <button
                    style={{ ...iconBtn, width: "auto", padding: "0 10px", gap: 5, marginLeft: "auto", fontSize: 11.5, fontWeight: 600 }}
                    onClick={() => setSpeedIdx((s) => (s + 1) % SPEEDS.length)}
                    aria-label={`Velocidad ${SPEEDS[speedIdx]}×`}
                    title="Velocidad de reproducción"
                  >
                    <Gauge size={13} /> {SPEEDS[speedIdx]}×
                  </button>
                </div>
              </div>
              <p className="muted" style={{ marginTop: 8, fontSize: 11.5 }}>
                El color de la onda es el sentiment de cada tramo (rojo = negativo, verde = positivo).
                Hacé clic en una frase para saltar ahí.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHead title="Transcripción · Contact Lens" />
            <CardBody>
              <TranscriptViewer
                segments={MOCK}
                currentTimeMs={posSec * 1000}
                onSeek={(ms) => setPosSec(ms / 1000)}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
