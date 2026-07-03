/* ============================================================
   ARIA · Cockpit · CallBar (barra horizontal en-llamada)
   Portado de aria-agent.jsx y generalizado para servir a DOS
   consumidores:
     • MODO DEMO — timer mock (dur en segundos), sentiment fijo.
     • EN-LLAMADA REAL — se le pasan el nodo del timer real, el
       valor de sentiment calculado, y los handlers del softphone
       (mute/hold/DTMF/transfer/conferencia/hangup).
   Usa clases CSS existentes (.card--pop .wave .smeter .netbars .btn).
   ============================================================ */
import type { CSSProperties, ReactNode } from "react";
import { Av, Icon, Pill } from "@/components/aria";
import { Wave, Senti, Net } from "./primitives";
import { fmtDur } from "./constants";

/** Botón circular de control del CallBar con tooltip. */
export function CBtn({
  icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <span className="tt">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={active}
        aria-label={label}
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          display: "grid",
          placeItems: "center",
          background: active ? "var(--accent)" : "var(--bg-2)",
          color: active ? "var(--accent-ink)" : "var(--text-2)",
          border: "1px solid " + (active ? "var(--accent)" : "var(--border-1)"),
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <Icon name={icon} size={19} />
      </button>
      <span className="tt__bub">{label}</span>
    </span>
  );
}

export interface CallBarProps {
  name: string;
  phone?: string | null;
  prog?: string | null;
  /** Etiqueta del pill de estado (por defecto "En llamada"). */
  statusLabel?: string;
  /** Sentiment en vivo 0..100 (por defecto 68 en demo). null = sin data. */
  sentiment?: number | null;
  /** true = hay audio (waveform animada). false = en espera. */
  audioOn?: boolean;
  /** Niveles reales 0..1 por barra (micrófono del agente). Sin esto → CSS. */
  levels?: number[];
  /** Nodo del timer. En demo pasar undefined y usar `durSeconds`. */
  timer?: ReactNode;
  /** Timer mock (segundos) — solo si no se pasa `timer`. */
  durSeconds?: number;
  /** Colorea el timer en dorado cuando está en espera. */
  hold?: boolean;
  avatarColor?: string;
  /** Controles. Cada uno se oculta si su handler es undefined. */
  muted?: boolean;
  onMute?: () => void;
  onHold?: () => void;
  onKeypad?: () => void;
  /** Volver al menú de inicio (marcador) sin colgar — la llamada sigue viva. */
  onHome?: () => void;
  onTransfer?: () => void;
  onConference?: () => void;
  onEnd?: () => void;
  /** Slot extra a la derecha (p.ej. REC indicator del real). */
  rightExtra?: ReactNode;
  style?: CSSProperties;
}

export function CallBar({
  name,
  phone,
  prog,
  statusLabel = "En llamada",
  sentiment = 68,
  audioOn = true,
  levels,
  timer,
  durSeconds = 0,
  hold = false,
  avatarColor = "var(--cyan)",
  muted = false,
  onMute,
  onHold,
  onKeypad,
  onHome,
  onTransfer,
  onConference,
  onEnd,
  rightExtra,
  style,
}: CallBarProps) {
  return (
    <div
      className="card card--pop"
      style={{
        padding: "14px 18px",
        marginBottom: 16,
        borderColor: "color-mix(in srgb,var(--green) 38%,var(--border-1))",
        background: "linear-gradient(100deg,var(--green-soft),transparent 55%)",
        ...style,
      }}
    >
      <div className="row between wrap gap14">
        <div className="row gap14">
          <Av name={name} size={46} color={avatarColor} />
          <div>
            <div className="row gap8" style={{ fontSize: 15.5, fontWeight: 750 }}>
              {name}
              <Pill tone="cyan" icon="phone">
                {statusLabel}
              </Pill>
            </div>
            <div className="row gap10" style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>
              {phone && <span className="mono">{phone}</span>}
              {phone && prog && <span>·</span>}
              {prog && <span>{prog}</span>}
            </div>
          </div>
        </div>
        <div className="row gap16 wrap">
          {sentiment != null && (
            <div style={{ minWidth: 120 }}>
              <div
                className="dim"
                style={{
                  fontSize: 10.5,
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                  marginBottom: 4,
                }}
              >
                Sentiment en vivo
              </div>
              <Senti val={sentiment} />
            </div>
          )}
          <Wave on={audioOn} levels={levels} />
          <div style={{ textAlign: "center" }}>
            <div
              className="mono"
              style={{ fontSize: 20, fontWeight: 700, color: hold ? "var(--gold-2)" : "var(--text-1)" }}
            >
              {timer ?? fmtDur(durSeconds)}
            </div>
            <div className="row gap6 center" style={{ marginTop: 2 }}>
              <Net />
              <span className="dim" style={{ fontSize: 10 }}>
                HD
              </span>
            </div>
          </div>
          {rightExtra}
          <div className="row gap6">
            {onMute && <CBtn icon="mic" label={muted ? "Activar mic" : "Silenciar"} active={muted} onClick={onMute} />}
            {onHold && <CBtn icon="pause" label={hold ? "Reanudar" : "Espera"} active={hold} onClick={onHold} />}
            {onHome && <CBtn icon="home" label="Volver al inicio" onClick={onHome} />}
            {onKeypad && <CBtn icon="grid" label="Teclado" onClick={onKeypad} />}
            {onTransfer && <CBtn icon="route" label="Transferir" onClick={onTransfer} />}
            {onConference && <CBtn icon="users" label="Conferencia" onClick={onConference} />}
            {onEnd && (
              <button
                type="button"
                className="btn"
                style={{ background: "var(--red)", color: "#fff", height: 44, padding: "0 18px", fontWeight: 700 }}
                onClick={onEnd}
              >
                <Icon name="phone" size={18} style={{ transform: "rotate(135deg)" }} />
                Colgar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
