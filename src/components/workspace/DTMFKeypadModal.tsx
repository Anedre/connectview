import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useCCP } from "@/hooks/useCCP";
import * as Icon from "@/components/vox/primitives";

interface DTMFKeypadModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * DTMF keypad — a small modal the agent opens while in a live call to
 * send touch-tones into the customer's audio leg (e.g. when the
 * customer asks the agent to navigate an external IVR with them, or to
 * confirm an OTP).
 *
 * Each digit press fires `sendDigits()` immediately AND appends it to
 * the local display, so the agent has visual feedback of what they
 * pressed. We also support keyboard input for the same keys (0-9, *, #).
 */
export function DTMFKeypadModal({ open, onClose }: DTMFKeypadModalProps) {
  const { sendDigits } = useCCP();
  const [history, setHistory] = useState("");
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const press = (k: string) => {
    setHistory((h) => (h + k).slice(-32));
    try {
      sendDigits(k);
    } catch {
      toast.error("No se pudo enviar el tono");
    }
  };

  // ESC to close + auto-focus on open so keyboard input works immediately
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (/^[0-9*#]$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      }
    };
    window.addEventListener("keydown", handler);
    closeBtnRef.current?.focus();
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset history when the modal closes so the next open starts clean
  useEffect(() => {
    if (!open) setHistory("");
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Teclado DTMF"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8, 10, 16, 0.55)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 250,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 300,
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          padding: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <Icon.Pad size={16} style={{ color: "var(--accent-cyan)" }} />
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            Teclado · enviar tonos
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <Icon.Close size={14} />
          </button>
        </div>

        <div
          className="mono"
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--border-1)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 18,
            minHeight: 22,
            letterSpacing: 4,
            textAlign: "right",
            color: history ? "var(--text-1)" : "var(--text-3)",
            marginBottom: 12,
            overflow: "hidden",
            whiteSpace: "nowrap",
            direction: "rtl",
          }}
        >
          {history || "—"}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 6,
          }}
        >
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map(
            (k) => (
              <button
                key={k}
                type="button"
                className="btn"
                style={{
                  height: 44,
                  justifyContent: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: 16,
                  fontWeight: 600,
                }}
                onClick={() => press(k)}
              >
                {k}
              </button>
            )
          )}
        </div>

        <div
          className="muted"
          style={{
            fontSize: 11,
            marginTop: 10,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Los tonos se envían en vivo al canal del cliente.
          <br />
          Usa el teclado físico (0-9, *, #) si prefieres.
        </div>
      </div>
    </div>
  );
}
