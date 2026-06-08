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
          width: 340,
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-1)",
          }}
        >
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "var(--accent-cyan-soft)",
              color: "var(--accent-cyan)",
            }}
          >
            <Icon.Pad size={14} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Teclado DTMF</div>
            <div className="muted" style={{ fontSize: 11 }}>
              Los tonos llegan en vivo al cliente
            </div>
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

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Tone history display */}
          <div
            className="mono"
            style={{
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              borderRadius: 10,
              padding: "12px 14px",
              fontSize: 22,
              fontWeight: 600,
              minHeight: 50,
              letterSpacing: 6,
              textAlign: "right",
              color: history ? "var(--text-1)" : "var(--text-4)",
              overflow: "hidden",
              whiteSpace: "nowrap",
              direction: "rtl",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {history || "—"}
          </div>

          {/* Circular pad — same look as the new SoftphoneDialer */}
          <div className="vox-dial__pad">
            {(
              [
                { d: "1", sub: "" },
                { d: "2", sub: "ABC" },
                { d: "3", sub: "DEF" },
                { d: "4", sub: "GHI" },
                { d: "5", sub: "JKL" },
                { d: "6", sub: "MNO" },
                { d: "7", sub: "PQRS" },
                { d: "8", sub: "TUV" },
                { d: "9", sub: "WXYZ" },
                { d: "*", sub: "" },
                { d: "0", sub: "+" },
                { d: "#", sub: "" },
              ] as Array<{ d: string; sub: string }>
            ).map((k) => (
              <button
                key={k.d}
                type="button"
                className="vox-dial__key"
                onClick={() => press(k.d)}
              >
                <span>{k.d}</span>
                {k.sub && <span className="vox-dial__key-sub">{k.sub}</span>}
              </button>
            ))}
          </div>

          <div
            className="muted"
            style={{ fontSize: 10.5, textAlign: "center", lineHeight: 1.5 }}
          >
            Usa el teclado físico (0-9, *, #) si prefieres
          </div>
        </div>
      </div>
    </div>
  );
}
