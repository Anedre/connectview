import type { ChannelType } from "@/components/vox/primitives";
import type { ConvChannel } from "@/hooks/useConversations";

/**
 * Mapeos de canal del inbox (Pilar 6). En su propio módulo (no en un componente)
 * para no romper el fast-refresh de Vite (`react-refresh/only-export-components`).
 */

/** Canal del modelo → tipo de chip de las primitives. */
export function chipType(channel: ConvChannel): ChannelType {
  if (channel === "whatsapp") return "wa";
  if (channel === "fb_comment") return "comment";
  return channel; // instagram | messenger | mercadolibre
}

/** Color de acento por canal (avatares / bordes). */
export const CH_COLOR: Record<ConvChannel, string> = {
  instagram: "#dd2a7b",
  messenger: "#0084ff",
  whatsapp: "#1FAE6C",
  fb_comment: "#4f46e5",
  mercadolibre: "#ffe600",
};

/** Etiqueta legible del canal (subtítulo del hilo). */
export const CH_LABEL: Record<ConvChannel, string> = {
  instagram: "Instagram DM",
  messenger: "Messenger",
  whatsapp: "WhatsApp",
  fb_comment: "Comentario",
  mercadolibre: "Mercado Libre",
};

/** Etiqueta corta del canal para el fallback de nombre. */
const CH_SHORT: Record<ConvChannel, string> = {
  instagram: "Instagram",
  messenger: "Messenger",
  whatsapp: "WhatsApp",
  fb_comment: "Comentario",
  mercadolibre: "Mercado Libre",
};

/** Teléfono E.164 → legible. Perú (51 + 9 díg.) se agrupa; el resto queda `+dígitos`. */
export function prettyPhone(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("51")) {
    const n = d.slice(2);
    return `+51 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  if (d.length === 9 && d.startsWith("9")) {
    return `+51 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  }
  return raw?.startsWith("+") ? raw : d ? `+${d}` : raw || "";
}

/** ¿El string parece un teléfono y NO un ID de Meta? Los PSID/IGSID rondan
 *  15-17 dígitos; un teléfono E.164 llega hasta 15 pero en la práctica ≤13. */
function looksLikePhone(s: string): boolean {
  const d = (s || "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 13;
}

/**
 * Nombre a MOSTRAR de una conversación — NUNCA un ID crudo de Meta.
 * Prioridad: nombre del cliente → teléfono formateado (WhatsApp / phone
 * detectado) → etiqueta de canal + últimos 4 del id (para distinguir varias
 * conversaciones sin nombre sin volcar el ID de 17 dígitos).
 */
export function displayName(c: {
  customerName?: string;
  senderId: string;
  channel: ConvChannel;
  phone?: string;
}): string {
  if (c.customerName && c.customerName.trim() && c.customerName !== c.senderId) {
    return c.customerName;
  }
  if (c.channel === "whatsapp") return prettyPhone(c.phone || c.senderId);
  if (c.phone) return prettyPhone(c.phone);
  if (looksLikePhone(c.senderId)) return prettyPhone(c.senderId);
  // IG/Messenger sin nombre (acceso Standard de Meta no expone el perfil):
  // etiqueta del canal + 4 dígitos para diferenciarlas, sin el ID completo.
  const tail = (c.senderId || "").replace(/\D/g, "").slice(-4);
  return tail ? `${CH_SHORT[c.channel]} · ${tail}` : CH_SHORT[c.channel];
}
