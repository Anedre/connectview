import type { ChannelType } from "@/components/vox/primitives";
import type { ConvChannel } from "@/hooks/useConversations";

/**
 * Mapeos de canal del inbox (Pilar 6). En su propio módulo (no en un componente)
 * para no romper el fast-refresh de Vite (`react-refresh/only-export-components`).
 */

/** Canal del modelo → tipo de chip de las primitives. */
export function chipType(channel: ConvChannel): ChannelType {
  if (channel === "whatsapp") return "wa";
  if (channel === "fb_comment") return "messenger";
  return channel; // instagram | messenger
}

/** Color de acento por canal (avatares / bordes). */
export const CH_COLOR: Record<ConvChannel, string> = {
  instagram: "#dd2a7b",
  messenger: "#0084ff",
  whatsapp: "#1FAE6C",
  fb_comment: "#0084ff",
};

/** Etiqueta legible del canal (subtítulo del hilo). */
export const CH_LABEL: Record<ConvChannel, string> = {
  instagram: "Instagram DM",
  messenger: "Messenger",
  whatsapp: "WhatsApp",
  fb_comment: "Comentario",
};
