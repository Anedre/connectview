import { useEffect, useState } from "react";

/**
 * useConnectAgentUsername — devuelve el username REAL de Connect del agente
 * logueado, leído del CCP/Streams (`connect.agent().getConfiguration().username`).
 *
 * Es la FUENTE DE VERDAD para cualquier lookup contra Amazon Connect (contacto
 * activo, contactos recientes, etc.). Puede DIFERIR del username de Cognito/Vox:
 * p.ej. Cognito "anedre12345" vs Connect "Andre-Alata". Usar el de Cognito hacía
 * que esos lookups no encontraran al agente (404 / listas vacías).
 *
 * Devuelve null hasta que el CCP inicializa el agente. Los consumidores deberían
 * hacer fallback al username de Cognito mientras tanto.
 */
export function useConnectAgentUsername(): string | null {
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const subscribe = () => {
      if (cancelled) return;
      // El global `connect` (amazon-connect-streams) carga ASYNC vía el CCP, y este
      // hook puede montar ANTES. Antes nos rendíamos en el primer render → quedaba
      // null → el front caía al username de Cognito → lookups de Connect vacíos
      // (recientes, contacto activo). Ahora REINTENTAMOS hasta que `connect` exista;
      // connect.agent() ya maneja el timing del agente (dispara cuando está listo).
      // El global se lee como (globalThis as any).connect — IGUAL que CCPContext.
      // El bare `connect` (global ambiente del .d.ts) NO resuelve en runtime dentro
      // del módulo ESM de Vite → quedaba null (recientes + contacto-activo caían al
      // username de Cognito). Reintentamos hasta que el CCP lo defina.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conn = (globalThis as any).connect;
      // Esperamos también el EVENT BUS (conn.core.getEventBus), IGUAL que CCPContext
      // (su línea 347). Sin el bus creado, conn.agent(cb) registra el callback pero
      // NUNCA dispara → era exactamente nuestro bug (suscribía pero no capturaba).
      if (
        !conn ||
        typeof conn.agent !== "function" ||
        !conn.core?.getEventBus?.()
      ) {
        if (attempts++ < 60) timer = setTimeout(subscribe, 500); // ~30s máx
        return;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        conn.agent((agent: any) => {
          try {
            const uname = agent?.getConfiguration?.()?.username;
            if (uname) setUsername((prev) => (prev === uname ? prev : uname));
          } catch {
            /* noop */
          }
        });
      } catch {
        /* noop */
      }
    };

    subscribe();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return username;
}
