import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Play, Pause, SkipBack, SkipForward, Gauge } from "lucide-react";
import { WaveformTimeline } from "@/components/recordings/WaveformTimeline";
import type { TranscriptSegment } from "@/types/recordings";

/** Imperative handle so a parent (e.g. the transcript) can drive seeking. */
export interface AudioPlayerHandle {
  seekTo: (ms: number) => void;
  play: () => void;
}

interface AudioPlayerProps {
  src: string;
  onTimeUpdate?: (currentTimeMs: number) => void;
  /** Transcript segments → waveform sentiment coloring + markers. Optional —
   *  without them the waveform falls back to neutral bars. */
  segments?: TranscriptSegment[];
  /** Known contact duration (sec) so the waveform can lay out before the audio
   *  metadata loads (or if it never does). Superseded by the real audio
   *  duration once available. */
  durationSecHint?: number;
}

function formatTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

const SPEEDS = [1, 1.5, 2];

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer(
    { src, onTimeUpdate, segments = [], durationSecHint = 0 },
    ref
  ) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [speedIdx, setSpeedIdx] = useState(0);

    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;
      const handleTime = () => {
        setCurrentTime(audio.currentTime);
        onTimeUpdate?.(audio.currentTime * 1000);
      };
      const handleDuration = () => setDuration(audio.duration || 0);
      const handlePlay = () => setIsPlaying(true);
      const handlePause = () => setIsPlaying(false);
      audio.addEventListener("timeupdate", handleTime);
      audio.addEventListener("loadedmetadata", handleDuration);
      audio.addEventListener("durationchange", handleDuration);
      audio.addEventListener("play", handlePlay);
      audio.addEventListener("pause", handlePause);
      audio.addEventListener("ended", handlePause);
      return () => {
        audio.removeEventListener("timeupdate", handleTime);
        audio.removeEventListener("loadedmetadata", handleDuration);
        audio.removeEventListener("durationchange", handleDuration);
        audio.removeEventListener("play", handlePlay);
        audio.removeEventListener("pause", handlePause);
        audio.removeEventListener("ended", handlePause);
      };
    }, [onTimeUpdate]);

    // Keep the chosen playback rate applied across src reloads (changing src
    // resets the element's rate to 1).
    useEffect(() => {
      if (audioRef.current) audioRef.current.playbackRate = SPEEDS[speedIdx];
    }, [speedIdx, src]);

    const seekToMs = useCallback((ms: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const target = Math.max(0, ms / 1000);
      audio.currentTime = target;
      setCurrentTime(target);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        seekTo: seekToMs,
        play: () => void audioRef.current?.play().catch(() => {}),
      }),
      [seekToMs]
    );

    const togglePlay = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    };

    const skip = (seconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const max = duration || durationSecHint || audio.currentTime + seconds;
      audio.currentTime = Math.max(0, Math.min(audio.currentTime + seconds, max));
    };

    const cycleSpeed = () => setSpeedIdx((s) => (s + 1) % SPEEDS.length);

    const layoutDur = duration > 0 ? duration : durationSecHint;

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
      <div
        style={{
          border: "1px solid var(--border-1)",
          background: "var(--bg-2)",
          borderRadius: 10,
          padding: 12,
        }}
      >
        {src && <audio ref={audioRef} src={src} preload="metadata" />}

        {layoutDur > 0 ? (
          <WaveformTimeline
            durationSec={layoutDur}
            currentSec={currentTime}
            segments={segments}
            onSeekSec={(sec) => seekToMs(sec * 1000)}
          />
        ) : (
          <div
            className="muted"
            style={{ fontSize: 11, textAlign: "center", padding: "18px 0" }}
          >
            {src ? "Cargando forma de onda…" : "Sin audio."}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <button
            style={iconBtn}
            onClick={() => skip(-10)}
            aria-label="Retroceder 10 segundos"
            title="−10 s"
          >
            <SkipBack size={15} />
          </button>
          <button
            style={{
              ...iconBtn,
              width: 38,
              height: 38,
              background: "var(--accent-violet)",
              borderColor: "var(--accent-violet)",
              color: "#fff",
            }}
            onClick={togglePlay}
            aria-label={isPlaying ? "Pausar" : "Reproducir"}
          >
            {isPlaying ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button
            style={iconBtn}
            onClick={() => skip(10)}
            aria-label="Avanzar 10 segundos"
            title="+10 s"
          >
            <SkipForward size={15} />
          </button>

          <span
            className="mono"
            style={{ fontSize: 11.5, color: "var(--text-2)", minWidth: 92 }}
          >
            {formatTime(currentTime)} / {formatTime(layoutDur || 0)}
          </span>

          <button
            style={{
              ...iconBtn,
              width: "auto",
              padding: "0 10px",
              gap: 5,
              marginLeft: "auto",
              fontSize: 11.5,
              fontWeight: 600,
            }}
            onClick={cycleSpeed}
            aria-label={`Velocidad de reproducción ${SPEEDS[speedIdx]}×`}
            title="Velocidad de reproducción"
          >
            <Gauge size={13} /> {SPEEDS[speedIdx]}×
          </button>
        </div>
      </div>
    );
  }
);
