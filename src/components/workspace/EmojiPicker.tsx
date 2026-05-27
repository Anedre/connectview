import { useState } from "react";
import { Popover } from "@base-ui/react/popover";

interface Props {
  /** Called with the chosen emoji glyph. */
  onPick: (emoji: string) => void;
  disabled?: boolean;
}

/**
 * Curated emoji set covering the cases that actually come up in agent
 * chats — greetings, acks, confirmations, emotions, business/contact
 * cues. Avoids a 30+KB picker dependency for a feature that only needs
 * ~60 glyphs.
 */
const GROUPS: Array<{ label: string; emojis: string[] }> = [
  {
    label: "Caras",
    emojis: ["😀", "😃", "😄", "😊", "🙂", "😉", "😎", "🤔", "😅", "🙏", "😔", "🥺", "😢", "😬"],
  },
  {
    label: "Manos",
    emojis: ["👋", "👍", "👎", "👌", "✌️", "🤝", "👏", "🙌", "✋", "🤞", "💪", "🫶"],
  },
  {
    label: "Corazones",
    emojis: ["❤️", "💚", "💙", "💜", "🧡", "💛", "🤍", "💕", "💖", "✨"],
  },
  {
    label: "Símbolos",
    emojis: ["✅", "❌", "⚠️", "ℹ️", "🔔", "⭐", "🎉", "🎯", "🚀", "💡", "🔥", "💯"],
  },
  {
    label: "Negocio",
    emojis: ["📞", "📧", "💬", "📝", "📅", "🕐", "📍", "🏢", "🎓", "📚", "💼", "📋"],
  },
];

export function EmojiPicker({ onPick, disabled }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={(props) => (
          <button
            {...props}
            className="btn btn--ghost btn--sm btn--icon"
            disabled={disabled}
            title="Insertar emoji"
            aria-label="Emojis"
            style={{ fontSize: 14 }}
          >
            😀
          </button>
        )}
      />
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} side="top" align="start">
          <Popover.Popup
            style={{
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              borderRadius: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,.18)",
              width: 280,
              maxHeight: 360,
              overflowY: "auto",
              padding: 8,
              zIndex: 1000,
            }}
          >
            {GROUPS.map((g) => (
              <div key={g.label} style={{ marginBottom: 8 }}>
                <div
                  className="muted"
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                    marginBottom: 4,
                    paddingLeft: 2,
                  }}
                >
                  {g.label}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(8, 1fr)",
                    gap: 2,
                  }}
                >
                  {g.emojis.map((e) => (
                    <button
                      key={e}
                      onClick={() => {
                        onPick(e);
                        // Keep the popover open so the agent can insert
                        // multiple emojis in a row without re-opening.
                      }}
                      style={{
                        padding: 4,
                        border: "1px solid transparent",
                        borderRadius: 4,
                        background: "transparent",
                        cursor: "pointer",
                        fontSize: 18,
                        aspectRatio: "1 / 1",
                      }}
                      onMouseEnter={(ev) => {
                        ev.currentTarget.style.background = "var(--bg-2)";
                      }}
                      onMouseLeave={(ev) => {
                        ev.currentTarget.style.background = "transparent";
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
