import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCCP } from "@/hooks/useCCP";
import * as Icon from "@/components/vox/primitives";

interface ConferenceModalProps {
  open: boolean;
  onClose: () => void;
  contactId: string | null;
}

/**
 * Conference modal — add a 3rd-party phone number to the live call.
 * Uses CCPContext.addParticipantByPhone which calls Streams'
 * `contact.addConnection` and keeps the agent's leg alive (no merge
 * call needed; Streams auto-bridges all CONNECTED legs).
 *
 * Single input + dial. Keep the surface small — the heavy lifting
 * (queue / quick-connect routing) belongs to the transfer modal in
 * warm-transfer mode.
 */
export function ConferenceModal({ open, onClose, contactId }: ConferenceModalProps) {
  const { addParticipantByPhone } = useCCP();
  const [phone, setPhone] = useState("+");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setPhone("+");
      setSubmitting(false);
      return;
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const valid = /^\+\d{7,15}$/.test(phone.trim());

  const onAdd = async () => {
    if (!valid) {
      toast.error("Número inválido", {
        description: "Usa formato E.164 con + y código de país (ej. +51953730189).",
      });
      return;
    }
    setSubmitting(true);
    try {
      await addParticipantByPhone(phone.trim(), contactId || undefined);
      toast.success(`Añadiendo a ${phone.trim()} a la llamada…`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo añadir el participante");
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Conferencia"
      onClick={() => !submitting && onClose()}
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
          width: 380,
          background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-1)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Icon.Users size={16} style={{ color: "var(--accent-violet)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Añadir a la llamada</div>
            <div className="muted" style={{ fontSize: 11 }}>
              Conferencia · cliente + tú + 3er participante
            </div>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--icon"
            onClick={onClose}
            disabled={submitting}
            aria-label="Cerrar"
          >
            <Icon.Close size={14} />
          </button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Número del participante
          </label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              borderRadius: 8,
              padding: "8px 12px",
            }}
          >
            <Icon.Phone size={14} style={{ color: "var(--text-3)" }} />
            <input
              ref={inputRef}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid && !submitting) onAdd();
              }}
              placeholder="+51953730189"
              inputMode="tel"
              style={{
                flex: 1,
                background: "transparent",
                border: 0,
                outline: "none",
                fontFamily: "var(--font-mono)",
                fontSize: 16,
                fontWeight: 600,
                color: "var(--text-1)",
              }}
            />
          </div>
          <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
            Tu llamada queda activa mientras Connect marca al 3er participante. Una vez
            conectado, los tres están en una conferencia 3-way.
          </div>
        </div>

        <div
          style={{
            padding: "10px 14px",
            borderTop: "1px solid var(--border-1)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onAdd}
            disabled={submitting || !valid}
            style={{ background: "var(--accent-violet)", borderColor: "var(--accent-violet)", color: "white" }}
          >
            <Icon.PhoneIn size={12} /> {submitting ? "Añadiendo…" : "Añadir a la llamada"}
          </button>
        </div>
      </div>
    </div>
  );
}
