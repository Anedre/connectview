import { useState } from "react";
import { toast } from "sonner";
import { useCCP } from "@/hooks/useCCP";
import * as Icon from "@/components/vox/primitives";

/**
 * Compact dialer shown in the softphone left panel when there's no
 * active contact and the agent can place outbound calls. Drives the
 * streams API via `useCCP().placeCall(phoneNumber)`.
 *
 * Accepts free-form input but normalises before submit — strips spaces
 * and non-digit chars except the leading '+' (E.164).
 */
export function SoftphoneDialer({ disabled }: { disabled?: boolean }) {
  const { placeCall, agentState } = useCCP();
  const [number, setNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canDial = agentState === "Available" || agentState === "Busy";

  const normalise = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    const hasPlus = trimmed.startsWith("+");
    const digits = trimmed.replace(/[^\d]/g, "");
    if (!digits) return "";
    return hasPlus ? `+${digits}` : digits;
  };

  const dial = async () => {
    const normalised = normalise(number);
    if (!normalised) {
      toast.error("Ingresa un número válido");
      return;
    }
    setSubmitting(true);
    try {
      await placeCall(normalised);
      toast.success(`Llamando a ${normalised}…`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo iniciar la llamada");
    } finally {
      setSubmitting(false);
    }
  };

  const appendDigit = (d: string) => {
    setNumber((curr) => curr + d);
  };

  return (
    <div style={{ padding: 14, borderTop: "1px solid var(--border-1)" }}>
      <div className="section-title">Marcador</div>
      <div
        style={{
          display: "flex",
          gap: 6,
          background: "var(--bg-2)",
          border: "1px solid var(--border-1)",
          borderRadius: 6,
          padding: "6px 8px",
          alignItems: "center",
        }}
      >
        <Icon.Phone size={14} style={{ color: "var(--text-3)" }} />
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") dial();
          }}
          placeholder="+51 953 730 189"
          inputMode="tel"
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: 0,
            outline: "none",
            fontSize: 14,
            fontFamily: "var(--font-mono)",
            color: "var(--text-1)",
          }}
        />
        {number && (
          <button
            className="btn btn--ghost btn--sm btn--icon"
            onClick={() => setNumber("")}
            title="Limpiar"
          >
            <Icon.Close size={12} />
          </button>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 4,
          marginTop: 8,
        }}
      >
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
          <button
            key={k}
            className="btn"
            style={{
              height: 32,
              justifyContent: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
            }}
            onClick={() => appendDigit(k)}
          >
            {k}
          </button>
        ))}
      </div>

      <button
        className="btn btn--success"
        style={{
          width: "100%",
          marginTop: 10,
          height: 38,
          justifyContent: "center",
        }}
        onClick={dial}
        disabled={disabled || submitting || !canDial || !number.trim()}
        title={
          !canDial
            ? "Cambia el estado a Available para poder llamar"
            : "Iniciar llamada"
        }
      >
        <Icon.PhoneIn size={14} />
        {submitting ? "Marcando…" : "Llamar"}
      </button>

      {!canDial && (
        <div
          className="muted"
          style={{ fontSize: 11, marginTop: 6, textAlign: "center" }}
        >
          Necesitas estar en estado "Available" para llamar.
        </div>
      )}
    </div>
  );
}
