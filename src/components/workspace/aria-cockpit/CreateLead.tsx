/* ============================================================
   ARIA · Cockpit · CreateLead (crear contacto al vuelo) — MODO DEMO
   Portado de aria-agent.jsx. Data mock (DEMO_PROGRAMAS).
   ============================================================ */
import { useState } from "react";
import { Btn, Card, Icon } from "@/components/aria";
import { DEMO_PROGRAMAS } from "./mockData";
import { INP_STYLE } from "./styles";

export function CreateLead({
  phone,
  onSave,
}: {
  phone: string;
  onSave?: (fullName: string) => void;
}) {
  const [n, setN] = useState("");
  const [a, setA] = useState("");
  const [p, setP] = useState("adm27");
  const [done, setDone] = useState(false);

  if (done)
    return (
      <Card title="Lead creado ✓" icon="checkCircle" accent="var(--green)">
        <div className="col gap10" style={{ fontSize: 13 }}>
          <div className="row between">
            <span className="dim">Nombre</span>
            <b>
              {n || "Nuevo contacto"} {a}
            </b>
          </div>
          <div className="row between">
            <span className="dim">Teléfono</span>
            <span className="mono">{phone}</span>
          </div>
          <div className="tl__note" style={{ margin: 0 }}>
            Candidato creado en Salesforce y vinculado a esta llamada.
          </div>
        </div>
      </Card>
    );

  return (
    <Card title="Contacto no registrado" icon="userplus" accent="var(--gold)">
      <div className="dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Este número no está en Salesforce. Créalo al vuelo — se guarda como candidato y se vincula a la llamada.
      </div>
      <div className="col gap10">
        <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Nombres" style={INP_STYLE} />
        <input value={a} onChange={(e) => setA(e.target.value)} placeholder="Apellidos" style={INP_STYLE} />
        <div className="row gap8" style={{ fontSize: 13, color: "var(--text-3)" }}>
          <Icon name="phone" size={14} />
          <span className="mono">{phone}</span>
        </div>
        <select value={p} onChange={(e) => setP(e.target.value)} style={INP_STYLE}>
          {DEMO_PROGRAMAS.map((pr) => (
            <option key={pr.id} value={pr.id}>
              {pr.nombre}
            </option>
          ))}
        </select>
        <Btn
          variant="primary"
          icon="check"
          onClick={() => {
            setDone(true);
            onSave?.((n || "Nuevo contacto") + (a ? " " + a : ""));
          }}
          style={{ width: "100%" }}
        >
          Crear lead en Salesforce
        </Btn>
      </div>
    </Card>
  );
}
