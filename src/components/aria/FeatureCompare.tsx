/**
 * FeatureCompare — mini-panel que pone lado a lado Automatización · Journey · Bot · Agente IA
 * para que el usuario entienda de un vistazo la DIFERENCIA y cuándo usar cada una.
 * Las cuatro "automatizan", pero en ejes distintos:
 *   Automatización = reacción a un evento   ·   Journey    = secuencia en el tiempo
 *   Bot            = conversación con guion  ·   Agente IA  = conversación con IA
 * Se muestra en el empty state de cada sección y detrás del botón "¿Cuál necesito?".
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, Btn } from "@/components/aria";
import type { IconName } from "@/components/aria";

export type FeatureKey = "automations" | "journeys" | "bots" | "agente";

const FEATURES: {
  key: FeatureKey;
  route: string;
  icon: IconName;
  color: string;
  name: string;
  tagline: string;
  what: string;
  example: string;
  when: string;
}[] = [
  {
    key: "automations",
    route: "/automations",
    icon: "zap",
    color: "var(--gold)",
    name: "Automatización",
    tagline: "Reacciona al instante",
    what: "Una regla: cuando pasa algo, ARIA ejecuta una acción al toque — sin conversación.",
    example: "Entró un lead por WhatsApp → etiquétalo y avisa a un agente.",
    when: "reaccionar a un evento puntual.",
  },
  {
    key: "journeys",
    route: "/journeys",
    icon: "flow",
    color: "var(--green)",
    name: "Journey",
    tagline: "Acompaña en el tiempo",
    what: "Una secuencia de pasos con esperas y ramas, a lo largo de días o semanas.",
    example: "Bienvenida → espera 2 días → si no respondió, llámalo.",
    when: "guiar al lead por varios pasos en el tiempo.",
  },
  {
    key: "bots",
    route: "/bot",
    icon: "bot",
    color: "var(--iris)",
    name: "Bot",
    tagline: "Conversa con un guion",
    what: "Un árbol de botones y respuestas fijas que lleva al cliente por un menú, paso a paso.",
    example: "«1) Ventas  2) Soporte» → según lo que toca, responde y deriva.",
    when: "un menú predecible con opciones fijas.",
  },
  {
    key: "agente",
    route: "/agente",
    icon: "sparkle",
    color: "var(--cyan)",
    name: "Agente IA",
    tagline: "Conversa con IA",
    what: "Un asistente con IA que entiende lo que sea, responde con tu conocimiento y agenda.",
    example: "«¿Cuánto cuesta y hay cupos?» → responde con tus datos y agenda una cita.",
    when: "que la IA entienda y responda en lenguaje natural.",
  },
];

export function FeatureCompare({
  current,
  hideHeading,
}: {
  current?: FeatureKey;
  hideHeading?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className="col" style={{ gap: 10, width: "100%" }}>
      {!hideHeading && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-3)",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Automatización, Journey, Bot o Agente IA — ¿cuál necesito?
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 12,
        }}
      >
        {FEATURES.map((f) => {
          const isCurrent = f.key === current;
          return (
            <div
              key={f.key}
              onClick={() => {
                if (!isCurrent) navigate(f.route);
              }}
              role={isCurrent ? undefined : "button"}
              style={{
                position: "relative",
                padding: 15,
                borderRadius: 13,
                border: `1.5px solid ${isCurrent ? f.color : "var(--border-1)"}`,
                background: isCurrent
                  ? `color-mix(in srgb, ${f.color} 7%, transparent)`
                  : "var(--bg-1)",
                cursor: isCurrent ? "default" : "pointer",
                transition: "border-color .15s, background .15s",
              }}
            >
              <div className="row" style={{ gap: 9, alignItems: "center" }}>
                <span
                  aria-hidden
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 30,
                    height: 30,
                    borderRadius: 9,
                    background: `color-mix(in srgb, ${f.color} 15%, transparent)`,
                    color: f.color,
                    flex: "0 0 auto",
                  }}
                >
                  <Icon name={f.icon} size={16} weight="bold" />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: f.color, fontWeight: 600 }}>{f.tagline}</div>
                </div>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--text-2)",
                  lineHeight: 1.45,
                  marginTop: 10,
                }}
              >
                {f.what}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--text-3)",
                  marginTop: 9,
                  padding: "7px 9px",
                  borderRadius: 8,
                  background: "var(--bg-2)",
                  borderLeft: `2px solid ${f.color}`,
                  lineHeight: 1.4,
                }}
              >
                <b style={{ color: "var(--text-2)" }}>Ej.</b> {f.example}
              </div>
              <div
                style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 9, lineHeight: 1.4 }}
              >
                <b>Elígela si quieres</b> {f.when}
              </div>
              {isCurrent ? (
                <div
                  className="row"
                  style={{
                    gap: 5,
                    alignItems: "center",
                    fontSize: 11.5,
                    color: f.color,
                    fontWeight: 700,
                    marginTop: 10,
                  }}
                >
                  <Icon name="check" size={12} weight="bold" /> Estás aquí
                </div>
              ) : (
                <div
                  className="row"
                  style={{
                    gap: 4,
                    alignItems: "center",
                    fontSize: 11.5,
                    color: f.color,
                    fontWeight: 600,
                    marginTop: 10,
                  }}
                >
                  Ir a {f.name} <Icon name="arrowRight" size={12} weight="bold" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Botón "¿Cuál necesito?" + modal con el comparador. Para el header de cada sección. */
export function FeatureCompareButton({ current }: { current?: FeatureKey }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn variant="ghost" size="sm" icon="help" onClick={() => setOpen(true)}>
        ¿Cuál necesito?
      </Btn>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.45)",
            display: "grid",
            placeItems: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 980,
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              borderRadius: 16,
              padding: 22,
              boxShadow: "var(--shadow-pop)",
            }}
          >
            <div
              className="row"
              style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}
            >
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
                ¿Automatización, Journey, Bot o Agente IA?
              </h2>
              <Btn variant="ghost" size="sm" icon="x" onClick={() => setOpen(false)} />
            </div>
            <FeatureCompare current={current} hideHeading />
          </div>
        </div>
      )}
    </>
  );
}
