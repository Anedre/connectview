import { useEffect, useMemo, useState } from "react";

/**
 * Utilidades del dashboard ejecutivo (recreación del diseño Claude Design v2).
 * Helpers de color para gradientes vívidos + hooks de animación (count-up,
 * mount-reveal) que respetan `prefers-reduced-motion`.
 */

export const prefersReduced = (): boolean =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  const n = parseInt(
    c.length === 3 ? c.split("").map((x) => x + x).join("") : c,
    16
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Aclara un hex hacia blanco por `amt` (0..1) — para el tope del gradiente. */
export function lighten(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.round(v + (255 - v) * amt);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Oscurece/satura un hex — para el pie del gradiente (efecto 3D). */
export function saturate(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.max(0, Math.round(v * (1 - amt * 0.18)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Gradiente vertical "infografía" (claro arriba → saturado abajo). */
export function vividGradient(hex: string, mid = 0.55): string {
  return `linear-gradient(180deg, ${lighten(hex, 0.34)}, ${hex} ${Math.round(
    mid * 100
  )}%, ${saturate(hex, 1)})`;
}

let _gid = 0;
export const nextId = (): string => "vx" + ++_gid;

/** Anima un número de 0 → target con ease-out cúbico. */
export function useCountUp(
  target: number,
  { duration = 1100, deps = [] as unknown[], decimals = 0 } = {}
): number {
  const [val, setVal] = useState(prefersReduced() ? target : 0);
  useEffect(() => {
    if (prefersReduced()) {
      setVal(target);
      return;
    }
    let raf = 0;
    let start: number | undefined;
    let done = false;
    const step = (ts: number) => {
      if (start === undefined) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(target * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else {
        done = true;
        setVal(target);
      }
    };
    raf = requestAnimationFrame(step);
    // Seguro: garantiza el valor final aunque rAF se estrangule en background.
    const fallback = setTimeout(() => {
      if (!done) setVal(target);
    }, duration + 250);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ...deps]);
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

/** Dispara `true` tras montar (para transiciones de dibujo). */
export function useMounted(deps: unknown[] = []): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    setM(false);
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setM(true))
    );
    const fallback = setTimeout(() => setM(true), 90);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return m;
}

/** Id estable por instancia para los `<linearGradient>` de SVG. */
export function useSvgId(prefix = "sp"): string {
  return useMemo(
    () => prefix + Math.random().toString(36).slice(2, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}
