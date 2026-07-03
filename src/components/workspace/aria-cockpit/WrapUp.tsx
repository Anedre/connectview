/* ============================================================
   ARIA · Cockpit · WrapUp (tipificar y cerrar) — MODO DEMO
   Portado de aria-agent.jsx. El rediseño REAL usa WrapUpView.
   ============================================================ */
import { useState } from "react";
import { Btn, Card, Icon, Pill } from "@/components/aria";
import { DISPO, AG_FOLLOWUP_PRESETS } from "./mockData";

const NEXT_ACTIONS: [string, string, string][] = [
  ["calendar", "Agendar cita con asesoría financiera", "var(--gold)"],
  ["wa", "Enviar info de becas por WhatsApp", "var(--green)"],
  ["tag", "Actualizar etapa en Salesforce", "var(--accent)"],
];

export function WrapUp({ onDone }: { onDone: () => void }) {
  const [d, setD] = useState("Interesado");
  const [followup, setFollowup] = useState<string | null>(null);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
      <div className="col gap16">
        <Card title="Resumen de la llamada" icon="sparkle" accent="var(--iris)">
          <div className="row gap16" style={{ marginBottom: 12 }}>
            <div>
              <div className="dim" style={{ fontSize: 11, textTransform: "uppercase" }}>
                Duración
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
                3:27
              </div>
            </div>
            <div>
              <div className="dim" style={{ fontSize: 11, textTransform: "uppercase" }}>
                Sentiment
              </div>
              <Pill tone="gold">Mixto → positivo</Pill>
            </div>
          </div>
          <div className="tl__note" style={{ margin: 0 }}>
            El cliente consultó por Ingeniería de Sistemas y mostró interés tras ver el brochure. Surgió objeción de costo; se
            ofreció información de becas. Acordó recibir detalles por WhatsApp.
          </div>
          <div className="row gap8" style={{ marginTop: 12 }}>
            <span
              className="pill pill--outline"
              style={{ borderColor: "color-mix(in srgb,var(--ch-sf) 45%,var(--border-1))" }}
            >
              <span className="chdot chdot--sf" />
              Sincronizado con Salesforce
              <Icon name="check" size={12} style={{ color: "var(--green)" }} />
            </span>
            <span className="dim" style={{ fontSize: 11 }}>
              Etapa y notas escritas en el candidato.
            </span>
          </div>
        </Card>
        <Card title="Próximas acciones sugeridas" icon="target">
          <div className="col gap8">
            {NEXT_ACTIONS.map((a, i) => (
              <div
                key={i}
                className="row gap11"
                style={{
                  padding: "10px 12px",
                  border: "1px solid var(--border-1)",
                  borderRadius: "var(--r-md)",
                  background: "var(--bg-2)",
                }}
              >
                <div className="tl__ico" style={{ ["--_c" as string]: a[2], width: 30, height: 30 }}>
                  <Icon name={a[0]} size={15} />
                </div>
                <span className="grow" style={{ fontSize: 13 }}>
                  {a[1]}
                </span>
                <Btn variant="soft" size="sm">
                  Hacer
                </Btn>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Tipificar y cerrar" icon="check">
        <div className="col gap14">
          <div className="wstep">
            <span className="wstep__n" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
              1
            </span>
            <div className="grow">
              <b style={{ fontSize: 13 }}>Selecciona el resultado</b>
            </div>
          </div>
          <div className="row wrap gap6">
            {DISPO.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setD(t)}
                className={"pill " + (d === t ? "pill--accent" : "pill--outline")}
                style={{ cursor: "pointer", height: 30 }}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="wstep">
            <span className="wstep__n" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
              2
            </span>
            <div className="grow">
              <b style={{ fontSize: 13 }}>Nota de cierre</b>
            </div>
          </div>
          <textarea
            rows={3}
            defaultValue="Interesado en Ing. Sistemas. Enviar becas + agendar asesoría."
            style={{
              width: "100%",
              resize: "vertical",
              border: "1px solid var(--border-1)",
              borderRadius: "var(--r-md)",
              padding: "10px 12px",
              background: "var(--bg-2)",
              fontSize: 13,
              outline: "none",
            }}
          />
          <div className="wstep">
            <span className="wstep__n" style={{ background: "var(--gold)", color: "#3a2c00" }}>
              3
            </span>
            <div className="grow">
              <b style={{ fontSize: 13 }}>Agendar follow-up</b>
            </div>
            {followup && (
              <Pill tone="green" icon="calendar">
                {followup}
              </Pill>
            )}
          </div>
          <div className="row wrap gap6">
            {AG_FOLLOWUP_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setFollowup(p.when)}
                className={"pill " + (followup === p.when ? "pill--accent" : "pill--outline")}
                style={{ cursor: "pointer", height: 30 }}
              >
                {p.label}
              </button>
            ))}
            <input
              type="datetime-local"
              onChange={(e) => setFollowup(e.target.value ? "Personalizado" : null)}
              style={{
                height: 30,
                border: "1px solid var(--border-1)",
                borderRadius: "var(--r-pill)",
                padding: "0 10px",
                background: "var(--bg-2)",
                fontSize: 12,
                color: "var(--text-2)",
                outline: "none",
              }}
            />
          </div>
          <div className="row gap8">
            <Btn variant="ghost" icon="calendar" style={{ flex: 1 }}>
              {followup ? "Follow-up listo" : "Agendar"}
            </Btn>
            <Btn variant="primary" icon="check" style={{ flex: 1.4 }} onClick={onDone}>
              Guardar y siguiente
            </Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}
