import { useEffect, useMemo, useRef } from "react";
import type { AnimationItem } from "lottie-web";

/** #rrggbb → [r,g,b] normalizado 0-1 (formato de color de Lottie). */
function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const int = parseInt(n, 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

/** Recorre un Lottie y reescribe el color de todos los fill/stroke sólidos.
 *  Pensado para iconos MONOCROMOS (un solo color): en multicolor aplana todo. */
function tintLottie<T>(data: T, rgb: [number, number, number]): T {
  const clone = structuredClone(data);
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const c = o.c as { a?: number; k?: number[] } | undefined;
    if ((o.ty === "fl" || o.ty === "st") && c && c.a === 0 && Array.isArray(c.k)) {
      c.k = [rgb[0], rgb[1], rgb[2], c.k[3] ?? 1];
    }
    for (const key in o) walk(o[key]);
  };
  walk(clone);
  return clone;
}

/**
 * AnimatedIcon — reproduce un icono animado Lottie (formato de
 * animatedicons.co, useAnimations, LottieFiles, etc.). El player (lottie_light,
 * solo SVG) se importa dinámicamente: no pesa nada hasta que se monta el
 * primer icono.
 *
 * Los JSON van en `src/assets/anim-icons/` (ver README ahí, con atribución).
 * `tint` recolorea iconos monocromos al vuelo para que se adapten a la marca /
 * al tema (los de useAnimations vienen en negro).
 */
export function AnimatedIcon({
  data,
  src,
  size = 24,
  loop = false,
  autoplay = false,
  playOnHover = true,
  tint,
  label,
  className,
}: {
  /** JSON de la animación ya importado */
  data?: object;
  /** …o URL/ruta pública al JSON */
  src?: string;
  size?: number;
  loop?: boolean;
  autoplay?: boolean;
  /** re-reproduce desde el inicio al pasar el mouse */
  playOnHover?: boolean;
  /** #hex para recolorear un icono monocromo (solo con `data`) */
  tint?: string;
  /** aria-label; sin él, el icono es decorativo (aria-hidden) */
  label?: string;
  className?: string;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const animRef = useRef<AnimationItem | null>(null);

  // Recolorea una sola vez por (data, tint) — no en cada render.
  const animData = useMemo(
    () => (data && tint ? tintLottie(data, hexToRgb01(tint)) : data),
    [data, tint],
  );

  useEffect(() => {
    if (!boxRef.current || (!animData && !src)) return;
    let cancelled = false;
    void import("lottie-web/build/player/lottie_light").then(({ default: lottie }) => {
      if (cancelled || !boxRef.current) return;
      animRef.current?.destroy();
      animRef.current = lottie.loadAnimation({
        container: boxRef.current,
        renderer: "svg",
        loop,
        autoplay,
        ...(animData ? { animationData: animData } : { path: src }),
      });
    });
    return () => {
      cancelled = true;
      animRef.current?.destroy();
      animRef.current = null;
    };
  }, [animData, src, loop, autoplay]);

  return (
    <span
      ref={boxRef}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      style={{ display: "inline-block", width: size, height: size, lineHeight: 0 }}
      onMouseEnter={playOnHover ? () => animRef.current?.goToAndPlay(0, true) : undefined}
    />
  );
}
