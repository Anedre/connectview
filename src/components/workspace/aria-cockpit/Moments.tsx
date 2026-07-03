/* ============================================================
   ARIA · Cockpit · Momentos clave — MODO DEMO
   Portado de aria-agent.jsx. Data mock (AG_MOM). El rediseño REAL
   usa MomentsPanel (Contact Lens). Icono: "target" (no existe
   "flag" en el set ARIA; MomentsPanel también usa target).
   ============================================================ */
import { Card, Icon } from "@/components/aria";
import { AG_MOM } from "./mockData";

export function Moments() {
  return (
    <Card title="Momentos clave" icon="target">
      <div className="col gap2">
        {AG_MOM.map((m, i) => (
          <div key={i} className="moment">
            <span className="mono dim" style={{ fontSize: 12, width: 34 }}>
              {m.t}
            </span>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: m.tone,
                flex: "0 0 auto",
                marginTop: 5,
              }}
            />
            <span style={{ fontSize: 12.5, flex: 1 }}>{m.label}</span>
            <Icon name="play" size={13} style={{ color: "var(--text-3)" }} />
          </div>
        ))}
      </div>
    </Card>
  );
}
