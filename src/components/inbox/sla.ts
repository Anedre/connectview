/**
 * SLA de PRIMERA RESPUESTA del inbox — cuánto lleva esperando una conversación
 * SIN atender (el cliente escribió y nadie respondió todavía). Es una señal de
 * urgencia para que ningún lead se enfríe en la bandeja.
 *
 * Aproximación honesta: usamos `unread > 0` (hay mensajes del cliente sin leer)
 * + el tiempo desde `lastMessageAt`. No tenemos un `waitingSince` por-conversación
 * en la lista, así que el reloj mide desde el último mensaje del cliente.
 */
import type { CSSProperties } from "react";

export const SLA_WARN_MIN = 5; // ámbar: esperando > 5 min
export const SLA_BREACH_MIN = 15; // rojo: esperando > 15 min

export type SlaLevel = "warn" | "breach";
export interface SlaInfo {
  level: SlaLevel;
  mins: number;
}

/** Nivel de SLA de una conversación, o null si está atendida / dentro de tiempo. */
export function slaInfo(c: {
  status: string;
  unread: number;
  lastMessageAt?: string;
}): SlaInfo | null {
  if (c.status !== "open" || (c.unread || 0) <= 0) return null;
  const t = Date.parse(c.lastMessageAt || "");
  if (Number.isNaN(t)) return null;
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins >= SLA_BREACH_MIN) return { level: "breach", mins };
  if (mins >= SLA_WARN_MIN) return { level: "warn", mins };
  return null;
}

/** "6m" / "1h 5m" corto para el chip de espera. */
export function fmtWait(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Estilo inline del chip de espera según el nivel (ámbar / rojo). */
export function slaChipStyle(level: SlaLevel): CSSProperties {
  const c = level === "breach" ? "var(--red)" : "var(--gold)";
  return {
    height: 16,
    fontSize: 9.5,
    padding: "0 5px",
    borderRadius: 999,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    background: `color-mix(in srgb, ${c} 15%, transparent)`,
    color: c,
    border: `1px solid color-mix(in srgb, ${c} 32%, transparent)`,
  };
}
