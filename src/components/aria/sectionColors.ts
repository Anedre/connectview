/* ============================================================
   ARIA · Color de acento por sección
   Da variedad de color (no todo navy) a los iconos del sidebar y a
   los chips de título de cada página. Un solo mapa alimenta el
   sidebar (por id) y las Cards (por ruta, vía SectionColorContext).
   ============================================================ */
import { createContext } from "react";

/** id de nav → token de color ARIA. */
export const SECTION_COLOR: Record<string, string> = {
  home: "var(--accent)",
  call: "var(--cyan)",
  inbox: "var(--green)",
  queue: "var(--coral)",
  programs: "var(--iris)",
  leads: "var(--cyan)",
  campaigns: "var(--gold)",
  bots: "var(--iris)",
  journeys: "var(--green)",
  automations: "var(--gold)",
  agente: "var(--iris)",
  appointments: "var(--cyan)",
  reports: "var(--accent)",
  tipificaciones: "var(--gold)",
  recordings: "var(--coral)",
  admin: "var(--accent)",
};

/** ruta → color (match del prefijo más específico). */
const PATH_COLOR: [string, string][] = [
  ["/agent", "var(--cyan)"],
  ["/inbox", "var(--green)"],
  ["/queue", "var(--coral)"],
  ["/programs", "var(--iris)"],
  ["/leads", "var(--cyan)"],
  ["/campaigns", "var(--gold)"],
  ["/bot", "var(--iris)"],
  ["/journeys", "var(--green)"],
  ["/automations", "var(--gold)"],
  ["/agente", "var(--iris)"],
  ["/appointments", "var(--cyan)"],
  ["/reports", "var(--accent)"],
  ["/tipificaciones", "var(--gold)"],
  ["/recordings", "var(--coral)"],
  ["/admin", "var(--accent)"],
];

/** Color de acento de la sección activa según la ruta. */
export function sectionColorFor(pathname: string): string {
  const hit = PATH_COLOR.find(([p]) => pathname === p || pathname.startsWith(p + "/"));
  return hit ? hit[1] : "var(--accent)";
}

/** Color de sección disponible a las Cards (chip del icono de título). */
export const SectionColorContext = createContext<string>("var(--accent)");
