/* ============================================================
   ARIA · Cockpit · Copiloto de llamada (tabbed) — MODO DEMO
   Portado de aria-agent.jsx. Data mock (COP). En el rediseño
   REAL se usa AIAssistPanel/AICoachPanel, no este.
   ============================================================ */
import { useState } from "react";
import { Card, Icon } from "@/components/aria";
import { COP } from "./mockData";

type Tab = "guiones" | "objeciones" | "conocimiento";

export function Copiloto() {
  const [t, setT] = useState<Tab>("guiones");
  const data = COP[t];
  return (
    <Card title="Copiloto de llamada" icon="sparkle" accent="var(--iris)">
      <div className="cop-tabs">
        {(
          [
            ["guiones", "Guiones"],
            ["objeciones", "Objeciones"],
            ["conocimiento", "Conocimiento"],
          ] as [Tab, string][]
        ).map(([id, l]) => (
          <button key={id} type="button" aria-pressed={t === id} onClick={() => setT(id)}>
            {l}
          </button>
        ))}
      </div>
      <div className="col gap9">
        <div
          style={{
            padding: "11px 12px",
            borderRadius: "var(--r-md)",
            background: "var(--iris-soft)",
            border: "1px solid color-mix(in srgb,var(--iris) 24%,transparent)",
          }}
        >
          <div className="row gap8" style={{ fontWeight: 700, fontSize: 12.5, color: "var(--iris-2)" }}>
            <Icon name="sparkle" size={14} />
            Sugerido ahora
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 4, lineHeight: 1.45 }}>
            Detecté objeción de <b>costo</b>. Menciona el programa de becas por mérito y ofrece asesoría financiera.
          </div>
        </div>
        {data.map(([title, d], i) => (
          <div
            key={i}
            style={{
              padding: "10px 12px",
              borderRadius: "var(--r-md)",
              border: "1px solid var(--border-1)",
              background: "var(--bg-2)",
              cursor: "pointer",
            }}
          >
            <div className="row between">
              <b style={{ fontSize: 13 }}>{title}</b>
              <Icon name="copy" size={13} style={{ color: "var(--text-3)" }} />
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 3, lineHeight: 1.45 }}>{d}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
