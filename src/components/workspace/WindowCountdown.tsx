import { useEffect, useState } from "react";
import * as Icon from "@/components/vox/primitives";
import type { ChatMessage } from "@/hooks/useChatSession";

/**
 * WindowCountdown — shows the time left in WhatsApp's 24h customer-service
 * window, measured from the last inbound (customer) message. Outside the
 * window Meta only allows approved templates, not free text — so we warn the
 * agent. Only renders for WhatsApp channels. Roadmap #12.
 */
interface Props {
  messages: ChatMessage[];
  channel: string | null;
  channelLabel?: string;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

function isWhatsApp(channel: string | null, label?: string): boolean {
  const c = `${channel || ""} ${label || ""}`.toLowerCase();
  return c.includes("whatsapp") || c.includes("wa");
}

export function WindowCountdown({ messages, channel, channelLabel }: Props) {
  // Re-render every 30s so the countdown stays live.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!isWhatsApp(channel, channelLabel)) return null;

  // Last inbound customer message timestamp.
  const lastInbound = [...messages]
    .reverse()
    .find((m) => m.participantRole === "CUSTOMER");
  if (!lastInbound) return null;

  const lastTs = Date.parse(lastInbound.timestamp) || 0;
  if (!lastTs) return null;

  const elapsed = Date.now() - lastTs;
  const remaining = WINDOW_MS - elapsed;
  const expired = remaining <= 0;

  // Format remaining as "Xh Ym" or "Ym".
  const hours = Math.floor(remaining / 3_600_000);
  const mins = Math.floor((remaining % 3_600_000) / 60_000);
  const remLabel = hours > 0 ? `${hours}h ${mins}m` : `${Math.max(0, mins)}m`;

  // Color: red if expired or <1h, amber <3h, green otherwise.
  const tone = expired || remaining < 3_600_000
    ? { fg: "var(--accent-red)", bg: "rgba(239,68,68,0.10)", bd: "rgba(239,68,68,0.35)" }
    : remaining < 3 * 3_600_000
    ? { fg: "var(--accent-amber)", bg: "rgba(245,158,11,0.12)", bd: "rgba(245,158,11,0.35)" }
    : { fg: "var(--accent-green)", bg: "rgba(16,185,129,0.12)", bd: "rgba(16,185,129,0.35)" };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        color: tone.fg,
        background: tone.bg,
        border: `1px solid ${tone.bd}`,
        marginBottom: 8,
      }}
      title={
        expired
          ? "La ventana de 24h de WhatsApp se cerró. Solo podés enviar plantillas aprobadas hasta que el cliente vuelva a escribir."
          : `Quedan ${remLabel} de la ventana de 24h de WhatsApp para enviar texto libre.`
      }
    >
      <Icon.Clock size={12} />
      {expired ? "Ventana cerrada · solo plantillas" : `Ventana WhatsApp: ${remLabel}`}
    </div>
  );
}
