import { ChannelChip } from "@/components/vox/primitives";
import type { Conversation } from "@/hooks/useConversations";
import { chipType, CH_COLOR } from "./channelMeta";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Hora relativa corta: HH:MM hoy, "ayer", o DD/MM. */
function fmtWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "ayer";
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {conversations.map((c) => {
        const name = c.customerName || c.senderId;
        const active = c.conversationId === selectedId;
        const color = CH_COLOR[c.channel] || "var(--accent-cyan)";
        return (
          <button
            key={c.conversationId}
            type="button"
            onClick={() => onSelect(c.conversationId)}
            style={{
              display: "flex",
              gap: 11,
              alignItems: "center",
              padding: "11px 13px",
              textAlign: "left",
              borderBottom: "1px solid var(--border-1)",
              background: active ? "var(--accent-cyan-soft)" : "transparent",
              borderLeft: `3px solid ${active ? "var(--accent-cyan)" : "transparent"}`,
              cursor: "pointer",
              transition: "background .12s",
            }}
          >
            {/* Avatar con chip de canal abajo-derecha */}
            <span style={{ position: "relative", flex: "0 0 auto" }}>
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  background: `color-mix(in srgb, ${color} 16%, transparent)`,
                  color,
                }}
              >
                {initials(name)}
              </span>
              <span style={{ position: "absolute", right: -3, bottom: -3, transform: "scale(0.74)", transformOrigin: "bottom right" }}>
                <ChannelChip type={chipType(c.channel)} />
              </span>
            </span>

            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    fontWeight: c.unread ? 800 : 650,
                    fontSize: 13.5,
                    color: "var(--text-1)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {name}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--text-3)", flex: "0 0 auto" }}>
                  {fmtWhen(c.lastMessageAt)}
                </span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                <span
                  style={{
                    fontSize: 12,
                    color: c.unread ? "var(--text-1)" : "var(--text-3)",
                    fontWeight: c.unread ? 600 : 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {c.lastMessagePreview || "—"}
                </span>
                {c.unread > 0 && (
                  <span
                    style={{
                      flex: "0 0 auto",
                      minWidth: 18,
                      height: 18,
                      padding: "0 5px",
                      borderRadius: 999,
                      background: "var(--accent-cyan)",
                      color: "#fff",
                      fontSize: 10.5,
                      fontWeight: 800,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {c.unread}
                  </span>
                )}
                {c.status === "closed" && (
                  <span style={{ flex: "0 0 auto", fontSize: 10, color: "var(--text-3)" }} title="Cerrada">✓</span>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
