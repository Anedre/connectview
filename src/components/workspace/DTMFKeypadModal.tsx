import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useCCP } from "@/hooks/useCCP";
import { Icon } from "@/components/aria";

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
      className="scrim"
      style={{ zIndex: 250, display: "grid", placeItems: "center" }}
    >
      <div
        className="card card--pop"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 340, maxWidth: "92vw", overflow: "hidden" }}
      >
        <div
          className="row gap10"
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-1)",
            alignItems: "center",
          }}
        >
          <div
            className="tl__ico"
            style={{ ["--_c" as string]: "var(--accent)", width: 30, height: 30, flex: "0 0 auto" }}
          >
            <Icon name="grid" size={15} />
          </div>
          <div className="grow">
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Teclado DTMF</div>
            <div className="dim" style={{ fontSize: 11 }}>
              Los tonos llegan en vivo al cliente
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="ctab__x"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="card__pad">
          <div className="col gap14">
            {/* Tone history display */}
            <div
              className="mono"
              style={{
                background: "var(--bg-2)",
                border: "1px solid var(--border-1)",
                borderRadius: "var(--r-md)",
                padding: "12px 14px",
                fontSize: 22,
                fontWeight: 700,
                minHeight: 50,
                letterSpacing: 6,
                textAlign: "right",
                color: history ? "var(--text-1)" : "var(--text-3)",
                overflow: "hidden",
                whiteSpace: "nowrap",
                direction: "rtl",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {history || "—"}
            </div>

            {/* Teclado numérico — estilo demo (.dialpad) */}
            <div className="dialpad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map(
                (k) => (
                  <button key={k} type="button" onClick={() => press(k)}>
                    {k}
                  </button>
                )
              )}
            </div>

            <div
              className="dim"
              style={{ fontSize: 10.5, textAlign: "center", lineHeight: 1.5 }}
            >
              Usa el teclado físico (0-9, *, #) si prefieres
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
