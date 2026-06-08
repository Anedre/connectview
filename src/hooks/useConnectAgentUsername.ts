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
    // El global `connect` (amazon-connect-streams) puede no estar cargado todavía
    // (o nunca, en onboarding sin Connect). Guardamos.
    if (typeof connect === "undefined") return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (connect as any).agent((agent: any) => {
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
  }, []);

  return username;
}
