import { useEffect, useRef, useState } from "react";

/**
 * Niveles de audio del MICRÓFONO del agente en tiempo real (Web Audio API).
 * Devuelve `bars` valores 0..1 (uno por barra de la waveform) que reflejan el
 * espectro de la voz del agente: suben al hablar / gritar, bajan al callar.
 *
 * 🔑 El audio del CLIENTE (remoto) vive en el iframe cross-origin del CCP de
 * Amazon Connect y NO es accesible desde la página por seguridad del navegador,
 * así que las ondas reflejan al agente. Abrir getUserMedia aquí NO interfiere
 * con el softphone: es un consumidor independiente del mismo device y su track
 * sólo se analiza (nunca se reproduce), por lo que no genera eco.
 */
export function useMicLevels(active: boolean, bars = 16): number[] {
  const [levels, setLevels] = useState<number[]>(() => new Array(bars).fill(0));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.mediaDevices) {
      setLevels(new Array(bars).fill(0));
      return;
    }
    let cancelled = false;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let last = 0;

    const run = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.72;
        src.connect(analyser);
        const freq = new Uint8Array(analyser.frequencyBinCount);
        const step = Math.max(1, Math.floor(freq.length / bars));

        const tick = (t: number) => {
          rafRef.current = requestAnimationFrame(tick);
          if (t - last < 45) return; // ~22 fps: fluido sin saturar de re-renders
          last = t;
          analyser.getByteFrequencyData(freq);
          const out = new Array<number>(bars);
          for (let i = 0; i < bars; i++) {
            let sum = 0;
            for (let j = 0; j < step; j++) sum += freq[i * step + j] || 0;
            // Ganancia 1.7 para que la voz normal ya mueva bien las barras.
            out[i] = Math.min(1, (sum / step / 255) * 1.7);
          }
          setLevels(out);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        // Permiso denegado / sin micrófono → ondas planas (fallback honesto).
      }
    };
    run();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (ctx) ctx.close().catch(() => {});
      if (stream) stream.getTracks().forEach((t) => t.stop());
      setLevels(new Array(bars).fill(0));
    };
  }, [active, bars]);

  return levels;
}
