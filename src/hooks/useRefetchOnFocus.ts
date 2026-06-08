import { useEffect, useRef } from "react";

/**
 * useRefetchOnFocus — llama a `onFocus` cuando la pestaña vuelve a tener foco
 * o se hace visible de nuevo. Sirve para re-sincronizar datos que pudieron
 * cambiar mientras la pestaña estaba en segundo plano: p.ej. la config de
 * integraciones editada por fuera (CLI, otra pestaña, el wizard en otra
 * ventana). Así el frontend nunca queda "mintiendo" hasta un reload manual.
 *
 * Escucha tanto `window.focus` como `document.visibilitychange` porque según
 * el caso (alt-tab vs. cambio de pestaña) dispara uno u otro. Throttle simple
 * para no spamear el endpoint cuando ambos eventos llegan juntos o el usuario
 * hace foco repetidas veces.
 */
export function useRefetchOnFocus(onFocus: () => void, minIntervalMs = 3000): void {
  const cb = useRef(onFocus);
  useEffect(() => {
    cb.current = onFocus;
  });
  const lastRun = useRef(0);

  useEffect(() => {
    const run = () => {
      // Ignorar el visibilitychange a "hidden" — solo nos interesa cuando
      // VUELVE a ser visible / con foco.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastRun.current < minIntervalMs) return;
      lastRun.current = now;
      cb.current();
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, [minIntervalMs]);
}
