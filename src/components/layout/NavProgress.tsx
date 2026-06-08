import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * NavProgress — barra fina arriba de todo que da feedback al navegar entre
 * secciones. Las páginas montan/cargan datos con cierta latencia (más en dev:
 * cold Lambdas + chunks), y sin esto la transición se ve como "blanco que parece
 * roto". Patrón NProgress: aparece al cambiar de ruta, sube rápido a ~90%,
 * completa a 100% y se desvanece.
 */
export function NavProgress() {
  const location = useLocation();
  const [active, setActive] = useState(false);
  const [width, setWidth] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const first = useRef(true);

  useEffect(() => {
    // No mostrar en el primer render (carga inicial de la app, ya tiene su gate).
    if (first.current) {
      first.current = false;
      return;
    }
    timers.current.forEach(clearTimeout);
    setActive(true);
    setWidth(10);
    timers.current = [
      setTimeout(() => setWidth(72), 90),
      setTimeout(() => setWidth(92), 450),
      setTimeout(() => setWidth(100), 1100),
      setTimeout(() => setActive(false), 1500),
    ];
    return () => timers.current.forEach(clearTimeout);
  }, [location.pathname]);

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${width}%`,
          background: "var(--accent-cyan, #0aa5b5)",
          opacity: active ? 1 : 0,
          transition: "width 0.4s ease, opacity 0.35s ease",
          boxShadow: "0 0 8px var(--accent-cyan, #0aa5b5)",
        }}
      />
    </div>
  );
}
