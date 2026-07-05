import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties } from "react";

const Spline = lazy(() => import("@splinetool/react-spline"));

/**
 * SplineScene — escena 3D de Spline embebida. El runtime (~1.5 MB) va en un
 * chunk aparte y solo se descarga cuando el contenedor entra al viewport;
 * con prefers-reduced-motion o sin `scene` no se monta nada.
 *
 * `scene` es la URL .splinecode que da el editor de Spline al exportar
 * (Export → Code → React). Ej. de slot ya cableado: el hero del login lee
 * VITE_SPLINE_LOGIN_SCENE del entorno.
 */
export function SplineScene({
  scene,
  className,
  style,
}: {
  scene?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Sin IntersectionObserver (entornos de test) montamos directo.
  const [ready, setReady] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const el = ref.current;
    if (!el || !scene || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setReady(true);
          io.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scene]);

  if (!scene) return null;
  return (
    <div ref={ref} className={className} style={style} aria-hidden>
      {ready && (
        <Suspense fallback={null}>
          <Spline scene={scene} />
        </Suspense>
      )}
    </div>
  );
}
