import { Headphones, Mic } from "lucide-react";
import { useCCP } from "@/hooks/useCCP";
import type { MonitorSession } from "@/context/CCPContext";

/**
 * MonitorControlBar — floating control surface for an active supervisor
 * monitoring session. The CCP runs headless (0×0 hidden), so when a
 * supervisor is monitoring an agent's call there's no native UI — this bar
 * is it. Lets them switch listen↔intervene live and leave.
 *
 * Renders nothing unless `monitorSession` is set (i.e. a monitor contact is
 * live on this CCP). Mounted once at the app shell so it shows on any route.
 *
 * Note: Amazon Connect + Streams expose only SILENT_MONITOR and BARGE
 * programmatically — there is NO whisper/coaching mode in the Streams API
 * (that lives in Connect's native Agent Workspace), so we deliberately
 * surface just the two real modes.
 */
interface Props {
  /** Demo / smoke-test seam: override the live session + handlers so the
   *  bar can be QA'd at /monitor-demo without a real monitor contact.
   *  Production mounts it with no props (reads from useCCP). */
  sessionOverride?: MonitorSession | null;
  onSetMode?: (mode: "SILENT_MONITOR" | "BARGE") => void;
  onEnd?: () => void;
}

export function MonitorControlBar({ sessionOverride, onSetMode, onEnd }: Props = {}) {
  const ccp = useCCP();
  const monitorSession =
    sessionOverride !== undefined ? sessionOverride : ccp.monitorSession;
  const setMonitorState = onSetMode ?? ccp.setMonitorState;
  const endMonitor = onEnd ?? ccp.endMonitor;
  if (!monitorSession) return null;

  const isBarge = monitorSession.mode === "BARGE";
  const canBarge = monitorSession.capabilities.includes("BARGE");

  return (
    <div
      style={{
        position: "fixed",
        bottom: 18,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 16px",
        borderRadius: 999,
        background: isBarge ? "rgba(239,68,68,0.96)" : "rgba(17,24,39,0.96)",
        color: "white",
        boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
        border: `1px solid ${isBarge ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.12)"}`,
        backdropFilter: "blur(8px)",
        fontSize: 13,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontWeight: 600,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: isBarge ? "#fff" : "var(--accent-green, #34d399)",
            boxShadow: isBarge
              ? "0 0 0 0 rgba(255,255,255,0.7)"
              : "0 0 0 0 rgba(52,211,153,0.7)",
            animation: "monitor-pulse 1.4s ease-in-out infinite",
          }}
        />
        {isBarge ? "Interviniendo en la llamada" : "Escuchando (silencioso)"}
      </span>

      <span style={{ opacity: 0.4 }}>·</span>

      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => setMonitorState("SILENT_MONITOR")}
          disabled={!isBarge}
          style={{ ...pillBtn(!isBarge), display: "inline-flex", alignItems: "center", gap: 6 }}
          title="Solo escuchar — el cliente y el agente no te oyen"
        >
          <Headphones size={14} /> Escuchar
        </button>
        <button
          onClick={() => setMonitorState("BARGE")}
          disabled={isBarge || !canBarge}
          style={{ ...pillBtn(isBarge), display: "inline-flex", alignItems: "center", gap: 6 }}
          title={
            canBarge
              ? "Entrar a la llamada — todos te escuchan"
              : "Esta sesión no permite intervenir"
          }
        >
          <Mic size={14} /> Intervenir
        </button>
      </div>

      <span style={{ opacity: 0.4 }}>·</span>

      <button
        onClick={endMonitor}
        style={{
          ...pillBtn(false),
          background: "rgba(255,255,255,0.14)",
          fontWeight: 600,
        }}
        title="Salir del monitoreo"
      >
        Salir
      </button>

      <style>{`
        @keyframes monitor-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.5); }
          50% { box-shadow: 0 0 0 5px rgba(255,255,255,0); }
        }
      `}</style>
    </div>
  );
}

function pillBtn(active: boolean): React.CSSProperties {
  return {
    border: 0,
    borderRadius: 999,
    padding: "5px 12px",
    fontSize: 12.5,
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    background: active ? "white" : "rgba(255,255,255,0.16)",
    color: active ? "#111827" : "white",
    opacity: 1,
    transition: "background 0.15s ease",
  };
}
