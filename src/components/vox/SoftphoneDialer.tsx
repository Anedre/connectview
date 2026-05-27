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
  const { placeCall, agentState, availableStates, changeAgentState } = useCCP();
  const [number, setNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Connect blocks `agent.connect()` whenever the agent isn't in a
  // routable state. The states that produce a working outbound call are
  // Available (agent is idle) and Busy/AfterCallWork (agent has a contact
  // attached but Connect permits a second leg for transfers etc.). When
  // the agent is in MissedCallAgent (Connect's auto-block after a missed
  // contact), Offline or Init, `agent.connect()` either throws
  // BadEndpointException or silently fails — both terrible UX.
  const isMissedBlocked =
    agentState === "MissedCallAgent" ||
    agentState === "MissedCall" ||
    agentState === "Missed Call Agent";
  const canDial =
    agentState === "Available" ||
    agentState === "Busy" ||
    agentState === "AfterCallWork";

  const normalise = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    const hasPlus = trimmed.startsWith("+");
    const digits = trimmed.replace(/[^\d]/g, "");
    if (!digits) return "";
    return hasPlus ? `+${digits}` : digits;
  };

  // Translate Streams' raw error codes into something an agent can act on.
  const friendlyError = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    const raw = String(msg);
    if (/BadEndpointException/i.test(raw)) {
      return "Connect rechazó el número. Verifica que comience con + y código de país (ej. +51).";
    }
    if (/Unauthorized|Permission|denied/i.test(raw)) {
      return "Tu perfil de seguridad no permite llamadas salientes. Contacta al admin.";
    }
    if (/InvalidStateException|state/i.test(raw)) {
      return "No puedes marcar en este estado. Cambia a Disponible primero.";
    }
    if (/Timeout|timed out/i.test(raw)) {
      return "Connect tardó demasiado en responder. Reintenta en unos segundos.";
    }
    return raw || "No se pudo iniciar la llamada";
  };

  const dial = async () => {
    const normalised = normalise(number);
    if (!normalised) {
      toast.error("Ingresa un número válido");
      return;
    }
    if (!/^\+\d{7,15}$/.test(normalised)) {
      toast.error(
        "Usa formato E.164 con código de país (ej. +51953730189).",
        { description: "Sin el + Connect no sabe a qué país enrutar." }
      );
      return;
    }
    setSubmitting(true);
    try {
      await placeCall(normalised);
      toast.success(`Llamando a ${normalised}…`);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  // One-click "unblock me" — agent missed a previous call, Connect put
  // them into MissedCallAgent, and now the dialer is gated. Surfacing
  // changeAgentState here saves a trip to the status menu.
  const returnToAvailable = () => {
    const available = availableStates.find((s) => s.name === "Available");
    if (!available) {
      toast.error("Estado 'Available' no disponible en este perfil");
      return;
    }
    try {
      changeAgentState(available);
      toast.success("De vuelta a Disponible");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar de estado");
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

      {/* Blocked-because-missed: most common reason the dialer "stops working" — an
          earlier missed call put the agent into MissedCallAgent and Connect refuses
          outbound. Give the agent a one-click way back to Available. */}
      {isMissedBlocked && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            background: "var(--accent-red-soft)",
            border: "1px solid var(--accent-red)",
            borderRadius: 6,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 11.5, color: "var(--accent-red)", lineHeight: 1.4 }}>
            Connect bloqueó las salientes porque no aceptaste un contacto previo.
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={returnToAvailable}
            style={{ height: 28, justifyContent: "center", fontSize: 11.5 }}
          >
            Volver a Disponible
          </button>
        </div>
      )}

      {!canDial && !isMissedBlocked && (
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
