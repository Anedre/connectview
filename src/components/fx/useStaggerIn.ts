import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";

/**
 * useStaggerIn — entrada en cascada con anime.js para hijos que aparecen
 * DESPUÉS del mount (datos async). Complementa a motion.css, que solo anima
 * la entrada de página: acá el disparo es cuando cambia `key` (p. ej. la
 * longitud de la lista al resolver el fetch).
 *
 *   const ref = useStaggerIn<HTMLDivElement>(items.length);
 *   return <div ref={ref} className="grid">{items.map(…)}</div>;
 */
export function useStaggerIn<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || el.children.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    animate(el.children, {
      opacity: [0, 1],
      translateY: [10, 0],
      delay: stagger(55),
      duration: 430,
      ease: "out(3)",
    });
  }, [key]);

  return ref;
}
