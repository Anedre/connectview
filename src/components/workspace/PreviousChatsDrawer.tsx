import { useEffect } from "react";
import { WhatsAppThreadView } from "@/components/recordings/WhatsAppThreadView";
import * as Icon from "@/components/vox/primitives";

interface Props {
  open: boolean;
  onClose: () => void;
  phone: string | null;
  customerName: string;
}

/**
 * Right-side drawer that hosts the WhatsAppThreadView for the customer's
 * phone — so the agent can read prior conversations (across every past
 * CHAT contactId, with calendar jump + session separators) without
 * leaving the active chat session.
 *
 * Built as an overlay + slide-in panel instead of a full-page route so
 * the active chat composer stays visible behind it.
 */
export function PreviousChatsDrawer({ open, onClose, phone, customerName }: Props) {
  // Close on Escape — matches the dialog pattern used elsewhere.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.32)",
          zIndex: 1500,
          animation: "previousChatsBackdropFade 0.18s ease-out",
        }}
      />
      {/* Drawer */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(640px, 92vw)",
          background: "var(--bg-1)",
          borderLeft: "1px solid var(--border-1)",
          boxShadow: "-8px 0 24px rgba(0,0,0,0.18)",
          zIndex: 1501,
          display: "flex",
          flexDirection: "column",
          animation: "previousChatsSlideIn 0.22s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-1)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <Icon.User size={15} style={{ color: "var(--text-3)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Historial de {customerName || phone || "cliente"}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>
              Conversaciones anteriores · Solo lectura
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn--ghost btn--sm btn--icon"
            title="Cerrar (Esc)"
            aria-label="Cerrar"
          >
            <Icon.Close size={13} />
          </button>
        </div>

        {/* Body — embedded WhatsApp unified view */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <WhatsAppThreadView phone={phone} />
        </div>
      </div>

      {/* Minimal keyframes — inlined so we don't have to add to index.css. */}
      <style>{`
        @keyframes previousChatsBackdropFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes previousChatsSlideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
