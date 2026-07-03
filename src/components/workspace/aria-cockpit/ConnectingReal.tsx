/* ============================================================
   ARIA · Cockpit · Connecting REAL (saliente/marcando) — DATOS REALES
   Variante de Connecting.tsx (modo demo) SIN el auto-connect por
   timeout: aquí el estado lo maneja Amazon Connect (el contacto pasa
   solo de "connecting" → "connected" y AgentDesktopPage cambia de
   pantalla). Sólo presenta avatar + nombre/número reales + estado, y
   el botón cancelar dispara hangup() REAL.
   Reusa el MISMO markup/clases del handoff (.card--pop .ring-pulse).
   ============================================================ */
import { Av, Icon, Pill } from "@/components/aria";

export function ConnectingReal({
  num,
  name,
  onCancel,
}: {
  num: string | null;
  /** Nombre resuelto del lead si lo conocemos; null = contacto nuevo. */
  name: string | null;
  onCancel: () => void;
}) {
  return (
    <div className="row center" style={{ padding: "20px 0" }}>
      <div
        className="card card--pop"
        style={{ padding: 32, textAlign: "center", maxWidth: 420, width: "100%" }}
      >
        <Pill tone="cyan" icon="arrowOut" style={{ margin: "0 auto" }}>
          Llamada saliente
        </Pill>
        <div
          className="ring-pulse"
          style={{ margin: "20px auto 14px", width: "fit-content", borderRadius: 26 }}
        >
          <Av name={name || num || "?"} size={84} radius={26} color="var(--cyan)" />
        </div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>
          {name || "Contacto nuevo"}
        </div>
        {num && (
          <div className="mono dim" style={{ fontSize: 13, marginTop: 4 }}>
            {num}
          </div>
        )}
        <div
          className="row gap8 center"
          style={{ color: "var(--text-2)", fontSize: 13, marginTop: 12 }}
        >
          <span className="dot dot--live" />
          Marcando…
        </div>
        <button
          type="button"
          className="btn"
          style={{
            background: "var(--red)",
            color: "#fff",
            height: 48,
            width: 48,
            borderRadius: "50%",
            margin: "18px auto 0",
          }}
          onClick={onCancel}
          title="Cancelar marcado"
        >
          <Icon name="phone" size={20} style={{ transform: "rotate(135deg)" }} />
        </button>
      </div>
    </div>
  );
}
