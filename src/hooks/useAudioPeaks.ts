import { useEffect, useState } from "react";

/** Tope de tamaño: no decodificamos llamadas enormes en el navegador (colgaría
 *  la pestaña). Connect graba a 8kHz mono (~1 MB/min), así que 40 MB cubre ~40
 *  min; más que eso → sin onda (estado honesto, no una onda inventada). */
const MAX_BYTES = 40 * 1024 * 1024; // 40 MB

export type AudioPeaksStatus = "loading" | "ready" | "error";

export interface AudioPeaksState {
  /** Amplitud real por barra en [0,1] (solo cuando status === "ready"). */
  peaks: number[] | null;
  status: AudioPeaksStatus;
}

/**
 * useAudioPeaks — descarga y decodifica la grabación para extraer su AMPLITUD
 * REAL, downsampleada a `barCount` valores en [0,1] (pico por bucket, normalizado
 * al máximo global). Devuelve además un `status` explícito para que el reproductor
 * muestre un estado HONESTO en lugar de una onda falsa:
 *   • "loading" → descargando/decodificando (skeleton).
 *   • "ready"   → onda real disponible.
 *   • "error"   → el origen no dio CORS, el formato no decodifica o excede el
 *                 tope de tamaño → sin onda (el reproductor lo dice, no la finge).
 *
 * El elemento <audio> reproduce igual en todos los casos (no necesita CORS, solo
 * el decode de Web Audio lo requiere).
 */
export function useAudioPeaks(src: string | null | undefined, barCount = 120): AudioPeaksState {
  const [state, setState] = useState<AudioPeaksState>({ peaks: null, status: "loading" });

  useEffect(() => {
    if (!src) {
      setState({ peaks: null, status: "error" });
      return;
    }
    setState({ peaks: null, status: "loading" });
    let alive = true;
    const ctrl = new AbortController();
    let audioCtx: AudioContext | null = null;
    const fail = () => {
      if (alive) setState({ peaks: null, status: "error" });
    };

    (async () => {
      try {
        const res = await fetch(src, { signal: ctrl.signal });
        if (!res.ok) return fail();
        const len = Number(res.headers.get("content-length") || 0);
        if (len && len > MAX_BYTES) return fail();
        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_BYTES || buf.byteLength === 0) return fail();

        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return fail();
        audioCtx = new Ctx();
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
        // Normaliza al pico global → la barra más alta llega a 1.
        if (max > 0) for (let i = 0; i < barCount; i++) out[i] /= max;
        if (alive) setState({ peaks: out, status: "ready" });
      } catch (e) {
        // AbortError = desmontaje/cambio de src → no es un error real que mostrar.
        if ((e as Error)?.name === "AbortError") return;
        fail();
      } finally {
        if (audioCtx) audioCtx.close().catch(() => {});
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [src, barCount]);

  return state;
}
