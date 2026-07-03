/* ============================================================
   ARIA · Cockpit · Connecting (marcando/timbrando) — MODO DEMO
   Portado de aria-agent.jsx.
   ============================================================ */
import { useEffect, useState } from "react";
import { Av, Icon, Pill } from "@/components/aria";

export function Connecting({
  num,
  name,
  onCancel,
  onConnect,
}: {
  num: string;
  name: string | null;
  onCancel: () => void;
  onConnect: () => void;
}) {
  const [lbl, setLbl] = useState("Marcando…");
  useEffect(() => {
    const t1 = setTimeout(() => setLbl("Timbrando…"), 1100);
    const t2 = setTimeout(onConnect, 2900);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="row center" style={{ padding: "20px 0" }}>
      <div className="card card--pop" style={{ padding: 32, textAlign: "center", maxWidth: 420, width: "100%" }}>
        <Pill tone="cyan" icon="arrowOut" style={{ margin: "0 auto" }}>
          Llamada saliente
        </Pill>
        <div className="ring-pulse" style={{ margin: "20px auto 14px", width: "fit-content", borderRadius: 26 }}>
          <Av name={name || "?"} size={84} radius={26} color="var(--cyan)" />
        </div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{name || "Contacto nuevo"}</div>
        <div className="mono dim" style={{ fontSize: 13, marginTop: 4 }}>
          {num}
        </div>
        <div className="row gap8 center" style={{ color: "var(--text-2)", fontSize: 13, marginTop: 12 }}>
          <span className="dot dot--live" />
          {lbl}
        </div>
        <button
          type="button"
          className="btn"
          style={{ background: "var(--red)", color: "#fff", height: 48, width: 48, borderRadius: "50%", margin: "18px auto 0" }}
          onClick={onCancel}
        >
          <Icon name="phone" size={20} style={{ transform: "rotate(135deg)" }} />
        </button>
      </div>
    </div>
  );
}
