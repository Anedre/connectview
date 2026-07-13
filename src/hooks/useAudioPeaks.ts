import { useEffect, useState } from "react";

/** Tope de tamaño: no decodificamos llamadas enormes en el navegador (colgaría
 *  la pestaña). Una llamada de ~40 min en WAV ronda este límite; más que eso →
 *  fallback a la onda determinística. */
const MAX_BYTES = 40 * 1024 * 1024; // 40 MB

/**
 * useAudioPeaks — descarga y decodifica la grabación para extraer su AMPLITUD
 * REAL, downsampleada a `barCount` valores en [0,1] (pico por bucket, normalizado
 * al máximo global). Conecta lo que WaveSurferPlayer demostraba en Storybook, pero
 * sin reemplazar el reproductor: alimenta las alturas al WaveformTimeline actual,
 * que conserva el color por sentiment, los momentos clave, la velocidad y el teclado.
 *
 * Best-effort por diseño — devuelve `null` si:
 *   • el bucket S3 de Connect no expone CORS (el fetch tira) — el `<audio>` igual
 *     reproduce porque el elemento no necesita CORS, solo el decode de Web Audio;
 *   • el formato no decodifica o el archivo excede el tope de tamaño.
 * En cualquiera de esos casos el caller cae a su onda determinística sin romperse.
 */
export function useAudioPeaks(src: string | null | undefined, barCount = 120): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    setPeaks(null);
    if (!src) return;
    let alive = true;
    const ctrl = new AbortController();
    let audioCtx: AudioContext | null = null;

    (async () => {
      try {
        const res = await fetch(src, { signal: ctrl.signal });
        if (!res.ok) return;
        const len = Number(res.headers.get("content-length") || 0);
        if (len && len > MAX_BYTES) return; // demasiado grande → fallback
        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_BYTES || buf.byteLength === 0) return;

        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        audioCtx = new Ctx();
        // decodeAudioData NO requiere gesto del usuario (solo el playback lo hace),
        // así que es seguro decodificar la onda completa al montar.
        const decoded = await audioCtx.decodeAudioData(buf);
        if (!alive) return;

        const ch = decoded.getChannelData(0);
        const step = Math.max(1, Math.floor(ch.length / barCount));
        const out = new Array<number>(barCount).fill(0);
        let max = 0;
        for (let i = 0; i < barCount; i++) {
          const start = i * step;
          const end = Math.min(ch.length, start + step);
          let peak = 0;
          for (let j = start; j < end; j++) {
            const v = Math.abs(ch[j]);
            if (v > peak) peak = v;
          }
          out[i] = peak;
          if (peak > max) max = peak;
        }
        // Normaliza al pico global → la barra más alta llega a 1 (amplifica audios
        // grabados con bajo nivel, útil para la lectura visual).
        if (max > 0) for (let i = 0; i < barCount; i++) out[i] /= max;
        if (alive) setPeaks(out);
      } catch {
        // CORS / decode / abort → fallback silencioso (peaks queda null).
      } finally {
        // Cerrar el AudioContext libera la memoria del buffer decodificado.
        if (audioCtx) audioCtx.close().catch(() => {});
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [src, barCount]);

  return peaks;
}
