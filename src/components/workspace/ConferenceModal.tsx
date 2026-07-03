import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCCP } from "@/hooks/useCCP";
import { Btn, Icon } from "@/components/aria";

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
      className="scrim"
      style={{ zIndex: 250, display: "grid", placeItems: "center" }}
    >
      <div
        className="card card--pop"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 380, maxWidth: "92vw", overflow: "hidden" }}
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
            style={{ ["--_c" as string]: "var(--iris)", width: 30, height: 30, flex: "0 0 auto" }}
          >
            <Icon name="users" size={15} />
          </div>
          <div className="grow">
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Añadir a la llamada</div>
            <div className="dim" style={{ fontSize: 11 }}>
              Conferencia · cliente + tú + 3er participante
            </div>
          </div>
          <button
            type="button"
            className="ctab__x"
            onClick={onClose}
            disabled={submitting}
            aria-label="Cerrar"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="card__pad col gap12">
          <div
            className="dim"
            style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}
          >
            Número del participante
          </div>
          <div
            className="row gap8"
            style={{
              background: "var(--bg-2)",
              border: "1px solid var(--border-1)",
              borderRadius: "var(--r-md)",
              padding: "0 12px",
              height: 46,
            }}
          >
            <Icon name="phone" size={14} style={{ color: "var(--text-3)" }} />
            <input
              ref={inputRef}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid && !submitting) onAdd();
              }}
              placeholder="+51953730189"
              inputMode="tel"
              className="mono"
              style={{
                flex: 1,
                background: "transparent",
                border: 0,
                outline: "none",
                fontSize: 16,
                fontWeight: 600,
                color: "var(--text-1)",
              }}
            />
          </div>
          <div className="dim" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
            Tu llamada queda activa mientras Connect marca al 3er participante. Una vez
            conectado, los tres están en una conferencia 3-way.
          </div>
        </div>

        <div
          className="row gap8"
          style={{
            padding: "10px 14px",
            borderTop: "1px solid var(--border-1)",
            justifyContent: "flex-end",
          }}
        >
          <Btn variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Btn>
          <Btn
            variant="primary"
            icon="phone"
            onClick={onAdd}
            disabled={submitting || !valid}
          >
            {submitting ? "Añadiendo…" : "Añadir a la llamada"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
