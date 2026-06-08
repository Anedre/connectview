/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * whenStreamsReady — corre `cb(connect)` cuando amazon-connect-streams está
 * REALMENTE listo: el global existe Y el event bus ya fue creado
 * (`connect.core.getEventBus()`).
 *
 * Por qué existe: suscribirse a `connect.agent()` / `connect.contact()` ANTES de
 * que el event bus exista registra el callback pero NUNCA dispara — fue el bug
 * que rompía la captura del username de Connect (recientes/contacto-activo
 * vacíos). El global `connect` carga async vía el CCP (ConnectAuthContext +
 * CCPContext), así que un effect que monta temprano se pierde el bus si no
 * espera. Reintenta cada 500ms hasta ~30s.
 *
 * Devuelve una función de cancelación — llamala en el cleanup del useEffect.
 *
 * El global se lee como `(globalThis as any).connect` a propósito (igual que
 * CCPContext): es la forma robusta de tocar el global del browser.
 */
export function whenStreamsReady(
  cb: (conn: any) => void,
  maxAttempts = 60
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;

  const tick = () => {
    if (cancelled) return;
    const conn = (globalThis as any).connect;
    if (
      !conn ||
      typeof conn.core?.getEventBus !== "function" ||
      !conn.core.getEventBus()
    ) {
      if (attempts++ < maxAttempts) timer = setTimeout(tick, 500); // ~30s máx
      return;
    }
    try {
      cb(conn);
    } catch {
      /* noop — el caller maneja sus propios errores */
    }
  };

  tick();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
