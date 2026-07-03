/* ============================================================
   ARIA · Cockpit · TaskPanel (canal Tarea en llamada) — MODO DEMO
   Detalle de la tarea (canal Task de Connect). Reutiliza <Card>,
   .wstep, .tl__note, .pill — NO rediseña nada.
   ============================================================ */
import { useState } from "react";
import { Btn, Card, Icon, Pill } from "@/components/aria";
import type { PillTone } from "./types";
import { AG_TASK_DETAIL } from "./mockData";

const PRIO: Record<string, { t: string; c: PillTone }> = {
  alta: { t: "Prioridad alta", c: "red" },
  media: { t: "Prioridad media", c: "gold" },
  baja: { t: "Prioridad baja", c: "outline" },
};

export function TaskPanel() {
  const t = AG_TASK_DETAIL;
  const [checked, setChecked] = useState<boolean[]>(t.checklist.map((c) => c.done));
  const done = checked.filter(Boolean).length;

  return (
    <Card
      title="Tarea · seguimiento"
      icon="check"
      extra={<Pill tone={PRIO[t.prio].c}>{PRIO[t.prio].t}</Pill>}
    >
      <div className="col gap14">
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{t.titulo}</div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            {t.prog}
          </div>
        </div>

        <div className="tl__note" style={{ margin: 0 }}>
          {t.descripcion}
        </div>

        <div className="row gap16">
          <div>
            <div className="dim" style={{ fontSize: 11, textTransform: "uppercase" }}>
              Vence
            </div>
            <div className="row gap6" style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
              <Icon name="clock" size={14} style={{ color: "var(--gold-2)" }} />
              {t.vence}
            </div>
          </div>
          <div>
            <div className="dim" style={{ fontSize: 11, textTransform: "uppercase" }}>
              Origen
            </div>
            <div style={{ fontSize: 12.5, marginTop: 4, color: "var(--text-2)" }}>{t.origen}</div>
          </div>
        </div>

        <div>
          <div className="row between" style={{ marginBottom: 8 }}>
            <b style={{ fontSize: 13 }}>Checklist</b>
            <span className="dim" style={{ fontSize: 12 }}>
              {done}/{t.checklist.length}
            </span>
          </div>
          <div className="col gap8">
            {t.checklist.map((c, i) => (
              <label
                key={c.label}
                className="row gap10"
                style={{
                  padding: "10px 12px",
                  border: "1px solid var(--border-1)",
                  borderRadius: "var(--r-md)",
                  background: "var(--bg-2)",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked[i]}
                  onChange={() => setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)))}
                  style={{ accentColor: "var(--accent)" }}
                />
                <span
                  className="grow"
                  style={{
                    color: checked[i] ? "var(--text-3)" : "var(--text-1)",
                    textDecoration: checked[i] ? "line-through" : "none",
                  }}
                >
                  {c.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="row gap8">
          <Btn variant="ghost" icon="calendar" style={{ flex: 1 }}>
            Reagendar
          </Btn>
          <Btn variant="primary" icon="check" style={{ flex: 1.4 }}>
            Marcar completada
          </Btn>
        </div>
      </div>
    </Card>
  );
}
