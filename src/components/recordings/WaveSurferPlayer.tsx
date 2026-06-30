import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause } from "lucide-react";

/**
 * WaveSurferPlayer — reproductor de audio con **onda REAL** (amplitud del audio)
 * dibujada por wavesurfer.js, con transporte y click-to-seek. Expone un handle
 * imperativo `seekTo(ms)` compatible con el de AudioPlayer, así puede manejarse
 * desde la transcripción.
 *
 * Nota: wavesurfer descarga el audio para calcular la onda; con el S3 de
 * grabaciones de Connect hay quirks de CORS (ver memoria) que hay que validar
 * antes de cambiar el reproductor de producción. Por eso este componente se
 * demuestra primero en Storybook con audio local.
 */
export interface WaveSurferPlayerHandle {
  seekTo: (ms: number) => void;
  play: () => void;
}

interface WaveSurferPlayerProps {
  src: string;
  height?: number;
  onTimeUpdate?: (currentTimeMs: number) => void;
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const WaveSurferPlayer = forwardRef<
  WaveSurferPlayerHandle,
  WaveSurferPlayerProps
>(function WaveSurferPlayer({ src, height = 72, onTimeUpdate }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  // Callback en ref para no recrear wavesurfer si el padre pasa una función nueva.
  const onTimeRef = useRef(onTimeUpdate);
  onTimeRef.current = onTimeUpdate;

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    setError(false);
    const ws = WaveSurfer.create({
      container: containerRef.current,
      url: src,
      height,
      waveColor: "#9b8cf0",
      progressColor: "#6253ce",
      cursorColor: "#c9c9d4",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
    });
    wsRef.current = ws;
    ws.on("ready", () => setDuration(ws.getDuration()));
    ws.on("timeupdate", (t: number) => {
      setCurrent(t);
      onTimeRef.current?.(t * 1000);
    });
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => setPlaying(false));
    ws.on("error", () => setError(true));
    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [src, height]);

  useImperativeHandle(
    ref,
    () => ({
      seekTo: (ms: number) => {
        const ws = wsRef.current;
        if (ws && ws.getDuration()) ws.setTime(Math.max(0, ms / 1000));
      },
      play: () => void wsRef.current?.play(),
    }),
    []
  );

  return (
    <div
      style={{
        border: "1px solid var(--border-1)",
        background: "var(--bg-2)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div ref={containerRef} style={{ minHeight: height }} />
      {error && (
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          No se pudo cargar el audio (posible CORS del origen).
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <button
          type="button"
          onClick={() => wsRef.current?.playPause()}
          aria-label={playing ? "Pausar" : "Reproducir"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 38,
            height: 38,
            borderRadius: 8,
            border: "1px solid var(--accent-violet)",
            background: "var(--accent-violet)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--text-2)" }}>
          {fmt(current)} / {fmt(duration)}
        </span>
      </div>
    </div>
  );
});
