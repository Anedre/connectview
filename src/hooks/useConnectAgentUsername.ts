import { useEffect, useState } from "react";
import { whenStreamsReady } from "@/lib/whenStreamsReady";

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
    // whenStreamsReady espera a que exista el global Y el event bus (suscribirse
    // antes del bus = el callback nunca dispara). connect.agent() ya maneja el
    // timing del agente: dispara cuando el agente está listo.
    return whenStreamsReady((conn) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conn.agent((agent: any) => {
        try {
          const uname = agent?.getConfiguration?.()?.username;
          if (uname) setUsername((prev) => (prev === uname ? prev : uname));
        } catch {
          /* noop */
        }
      });
    });
  }, []);

  return username;
}
