/* ============================================================
   ARIA · Cockpit · Cliente 360° (tabbed) — MODO DEMO
   Portado de aria-agent.jsx. Data mock (C360). En el rediseño
   REAL se usa el CustomerProfilePanel existente, no este.
   ============================================================ */
import { useState } from "react";
import { Btn, Card, Icon, Pill, SegBar } from "@/components/aria";
import { C360 } from "./mockData";

type Tab = "perfil" | "historial" | "notas" | "casos";

export function Cliente360() {
  const [t, setT] = useState<Tab>("perfil");
  return (
    <Card
      title="Cliente 360°"
      icon="user"
      extra={
        <Btn variant="quiet" size="sm" iconR="arrowRight">
          Ficha
        </Btn>
      }
    >
      <div className="c360-tabs">
        {(
          [
            ["perfil", "Perfil"],
            ["historial", "Historial"],
            ["notas", "Notas"],
            ["casos", "Casos"],
          ] as [Tab, string][]
        ).map(([id, l]) => (
          <button key={id} type="button" aria-pressed={t === id} onClick={() => setT(id)}>
            {l}
          </button>
        ))}
      </div>
      {t === "perfil" && (
        <div className="col gap10" style={{ fontSize: 13 }}>
          {C360.perfil.map(([k, v]) => (
            <div key={k} className="row between">
              <span className="dim">{k}</span>
              <b>{v}</b>
            </div>
          ))}
          <div style={{ marginTop: 2 }}>
            <div className="dim" style={{ marginBottom: 6, fontSize: 12 }}>
              Mezcla de canales
            </div>
            <SegBar
              segments={[
                { v: 6, color: "var(--ch-voz)" },
                { v: 12, color: "var(--ch-wa)" },
                { v: 1, color: "var(--ch-email)" },
              ]}
            />
          </div>
        </div>
      )}
      {t === "historial" && (
        <div className="tl">
          {C360.historial.map((e, i) => (
            <div key={i} className="tl__item" style={{ paddingBottom: 14 }}>
              <div className="tl__ico" style={{ ["--_c" as string]: e.c, width: 28, height: 28 }}>
                <Icon name={e.i} size={14} />
              </div>
              <div>
                <div className="tl__title" style={{ fontSize: 13 }}>
                  {e.t}
                </div>
                <div className="tl__meta">{e.m}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {t === "notas" && (
        <div className="col gap8">
          <div className="tl__note" style={{ margin: 0 }}>
            Cliente pidió info de becas. Prefiere WhatsApp por las tardes.
          </div>
          <textarea
            rows={3}
            placeholder="Agregar nota…"
            style={{
              width: "100%",
              resize: "vertical",
              border: "1px solid var(--border-1)",
              borderRadius: "var(--r-md)",
              padding: "9px 11px",
              background: "var(--bg-2)",
              fontSize: 13,
              outline: "none",
            }}
          />
        </div>
      )}
      {t === "casos" && (
        <div className="col gap8" style={{ fontSize: 13 }}>
          <div
            className="row between"
            style={{
              padding: "10px 12px",
              border: "1px solid var(--border-1)",
              borderRadius: "var(--r-sm)",
              background: "var(--bg-2)",
            }}
          >
            <span className="row gap8">
              <span className="chdot chdot--email" />
              Solicitud de beca
            </span>
            <Pill tone="gold">Abierto</Pill>
          </div>
          <div
            className="row between"
            style={{
              padding: "10px 12px",
              border: "1px solid var(--border-1)",
              borderRadius: "var(--r-sm)",
              background: "var(--bg-2)",
            }}
          >
            <span className="row gap8">
              <span className="chdot chdot--voz" />
              Reprogramar examen
            </span>
            <Pill tone="green">Resuelto</Pill>
          </div>
        </div>
      )}
    </Card>
  );
}
