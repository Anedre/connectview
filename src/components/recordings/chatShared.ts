/**
 * chatShared — convención ÚNICA para los renderers de chat/WhatsApp (la pestaña
 * WhatsAppThreadView y el ChatTranscriptView del canvas/modal). Antes divergían:
 * hora 24h vs AM/PM, eventos typing/read mostrados vs suprimidos, cuatro formatos
 * de fecha. El mismo chat se veía distinto según desde dónde lo abrías. Estos
 * helpers son la fuente de verdad compartida.
 */

const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const DOW_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Hora HH:mm (24h). Convención unificada — nunca AM/PM. */
export function formatChatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Mapea un ISO a su bucket local YYYY-MM-DD (evita el corrimiento de día del
 *  `.slice(0,10)` en UTC para usuarios al este de GMT). */
export function ymdLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** "2026-05-22" → "jueves 22 de mayo 2026", con "Hoy"/"Ayer" para los recientes. */
export function chatDayLabel(yyyyMmDd: string): string {
  if (!yyyyMmDd) return "";
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Hoy";
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  if (sameDay(date, yest)) return "Ayer";
  return `${DOW_ES[date.getDay()]} ${d} de ${MONTHS_ES[m - 1]} ${y}`;
}

const EVENT_LABELS: Record<string, string> = {
  "participant.joined": "se unió al chat",
  "participant.left": "salió del chat",
  "chat.ended": "Chat terminado",
  transferred: "Transferencia",
  // Eventos ruidosos: se SUPRIMEN (label vacío → no se renderiza). Antes el canvas
  // los mostraba ("Escribiendo…", "Leído", "Entregado") y la pestaña no.
  typing: "",
  read: "",
  delivered: "",
  unknown: "Evento",
};

/** Etiqueta de un evento de chat. Devuelve "" para los eventos que NO deben
 *  renderizarse (typing/read/delivered) — el caller omite el elemento. */
export function chatEventLabel(kind: string | undefined, participant: string): string {
  if (!kind) return "Evento";
  const label = kind in EVENT_LABELS ? EVENT_LABELS[kind] : `Evento · ${kind}`;
  if (!label) return "";
  if (kind.startsWith("participant.") && participant !== "SYSTEM") {
    const who =
      participant === "AGENT" ? "Agente" : participant === "CUSTOMER" ? "Cliente" : participant;
    return `${who} ${label}`;
  }
  return label;
}

export interface BubbleStyle {
  align: "left" | "right" | "center";
  bg: string;
  label: string;
}

/**
 * Paleta de burbuja por participante. El NEGOCIO (AGENT) va a la DERECHA con
 * acento verde ("yo"); el CLIENTE a la IZQUIERDA neutro; el SISTEMA centrado.
 * Unificada — antes el canvas y la pestaña divergían y el mismo cliente aparecía
 * en lados opuestos según la vista.
 */
export function bubbleStyle(participant: string): BubbleStyle {
  switch (participant) {
    case "AGENT":
      return { align: "right", bg: "var(--accent-green-soft, #d9fdd3)", label: "Agente" };
    case "SYSTEM":
      return { align: "center", bg: "var(--accent-violet-soft, #ebe0ff)", label: "Sistema" };
    case "CUSTOMER":
      return { align: "left", bg: "var(--bg-1, #ffffff)", label: "Cliente" };
    default:
      return { align: "left", bg: "var(--bg-2)", label: "—" };
  }
}

/** Fondo del scroller de un hilo de chat — gradiente sutil unificado (antes la
 *  pestaña usaba un gradiente y el canvas un beige `#f0e6d8` distinto). */
export const CHAT_SCROLLER_BG = "linear-gradient(180deg, var(--bg-2) 0%, var(--bg-1) 100%)";
