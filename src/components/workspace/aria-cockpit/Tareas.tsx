/* ============================================================
   ARIA · Cockpit · Tareas y follow-ups — MODO DEMO
   Portado de aria-agent.jsx. Data mock (AG_TASKS).
   ============================================================ */
import { useState } from "react";
import { Btn, Card, Icon, Pill, Stat } from "@/components/aria";
import type { PillTone } from "./types";
import { AG_TASKS } from "./mockData";

type Filter = "hoy" | "vencidas" | "todas";

const PRIO: Record<string, { t: string; c: PillTone }> = {
  alta: { t: "Alta", c: "red" },
  media: { t: "Media", c: "gold" },
  baja: { t: "Baja", c: "outline" },
};

export function Tareas({ onCall }: { onCall: (phone: string) => void }) {
  const [f, setF] = useState<Filter>("hoy");
  const list = AG_TASKS.filter((t) => (f === "todas" ? true : f === "vencidas" ? t.overdue : !t.overdue));
  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 16 }}>
        <Stat icon="check" color="var(--coral)" label="Pendientes" value="4" sub="asignadas a ti" />
        <Stat icon="clock" color="var(--gold)" label="Vencen hoy" value="2" />
        <Stat icon="missed" color="var(--red)" label="Atrasadas" value="1" />
      </div>
      <Card
        title="Tus tareas y follow-ups"
        icon="check"
        extra={
          <div className="theme-tog">
            {(
              [
                ["hoy", "Hoy"],
                ["vencidas", "Vencidas"],
                ["todas", "Todas"],
              ] as [Filter, string][]
            ).map(([id, l]) => (
              <button
                key={id}
                type="button"
                aria-pressed={f === id}
                onClick={() => setF(id)}
                style={{ width: "auto", padding: "0 12px" }}
              >
                {l}
              </button>
            ))}
          </div>
        }
      >
        <div className="col gap10">
          {list.map((t) => (
            <div
              key={t.id}
              className="row gap12"
              style={{
                padding: "12px 14px",
                border: "1px solid " + (t.overdue ? "color-mix(in srgb,var(--red) 34%,var(--border-1))" : "var(--border-1)"),
                borderRadius: "var(--r-md)",
                background: t.overdue ? "var(--red-soft)" : "var(--bg-2)",
              }}
            >
              <div
                className="tl__ico"
                style={{ ["--_c" as string]: t.tipo === "callback" ? "var(--cyan)" : "var(--green)", flex: "0 0 auto" }}
              >
                <Icon name={t.tipo === "callback" ? "phone" : "wa"} size={16} />
              </div>
              <div className="grow">
                <div className="row gap8">
                  <b style={{ fontSize: 13.5 }}>{t.t}</b>
                  <Pill tone={PRIO[t.prio].c}>{PRIO[t.prio].t}</Pill>
                </div>
                <div className="dim" style={{ fontSize: 12, marginTop: 1 }}>
                  {t.m} · {t.prog}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11.5, marginBottom: 6, color: t.overdue ? "var(--red-2)" : "var(--text-3)" }}>
                  {t.due}
                </div>
                <div className="row gap6">
                  {t.phone && (
                    <Btn variant="soft" size="sm" icon="phone" onClick={() => onCall(t.phone!)}>
                      Llamar
                    </Btn>
                  )}
                  <Btn variant="ghost" size="sm" icon="check">
                    Listo
                  </Btn>
                </div>
              </div>
            </div>
          ))}
          {!list.length && (
            <div className="dim" style={{ textAlign: "center", padding: 20, fontSize: 13 }}>
              Sin tareas en este filtro 🎉
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
