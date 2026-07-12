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
import { Modal } from "@/components/ui/modal";

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

/** Firma VISUAL del eje de cada feature (mini-SVG con currentColor):
 *  automations = un golpe instantáneo · journeys = pasos con esperas ·
 *  bots = bifurcación · agente = conversación con IA. */
function Sig({ k }: { k: FeatureKey }) {
  const s = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (k === "automations")
    return (
      <svg width="120" height="22" viewBox="0 0 120 22" aria-hidden>
        <path d="M12 3 L5 12 L11 12 L8 19 L16 9 L10 9 Z" fill="currentColor" stroke="none" />
        <line x1="24" y1="11" x2="82" y2="11" {...s} />
        <path d="M77 7 L83 11 L77 15" {...s} />
        <circle cx="98" cy="11" r="6" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.65">
          <line x1="98" y1="1" x2="98" y2="3.5" />
          <line x1="98" y1="18.5" x2="98" y2="21" />
          <line x1="110" y1="11" x2="112.5" y2="11" />
        </g>
      </svg>
    );
  if (k === "journeys")
    return (
      <svg width="120" height="22" viewBox="0 0 120 22" aria-hidden>
        <line x1="18" y1="11" x2="40" y2="11" {...s} strokeDasharray="2 4" />
        <line x1="62" y1="11" x2="84" y2="11" {...s} strokeDasharray="2 4" />
        <circle cx="10" cy="11" r="5" fill="currentColor" />
        <circle cx="51" cy="11" r="5" fill="currentColor" />
        <circle cx="92" cy="11" r="5" fill="currentColor" />
      </svg>
    );
  if (k === "bots")
    return (
      <svg width="120" height="22" viewBox="0 0 120 22" aria-hidden>
        <circle cx="12" cy="11" r="5" fill="currentColor" />
        <path d="M18 11 H36 M36 11 C44 11 44 4 50 4 M36 11 C44 11 44 18 50 18" {...s} />
        <circle cx="54" cy="4" r="4" fill="currentColor" />
        <circle cx="54" cy="18" r="4" fill="currentColor" />
      </svg>
    );
  return (
    <svg width="120" height="22" viewBox="0 0 120 22" aria-hidden>
      <path
        d="M6 3 h30 a4 4 0 0 1 4 4 v5 a4 4 0 0 1 -4 4 h-19 l-7 4 v-4 a4 4 0 0 1 -4 -4 v-5 a4 4 0 0 1 4 -4 z"
        {...s}
      />
      <path
        d="M58 4 l1.7 4.6 L64.5 10 l-4.8 1.7 L58 16 l-1.7-4.6 L51.5 10 l4.8 -1.7 Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/** Elige-rápido: 1 pregunta, botones por NECESIDAD (usan el `when` de cada feature)
 *  que llevan directo al builder correcto. Va arriba del comparador detallado. */
function QuickChooser({ current }: { current?: FeatureKey }) {
  const navigate = useNavigate();
  return (
    <div className="fc-quick">
      <div className="fc-quick__q">¿Qué necesitas hacer?</div>
      <div className="fc-quick__grid">
        {FEATURES.map((f) => (
          <button
            key={f.key}
            type="button"
            className={"fc-quick__opt" + (f.key === current ? " fc-quick__opt--on" : "")}
            style={{ ["--fc-c" as string]: f.color }}
            onClick={() => f.key !== current && navigate(f.route)}
          >
            <span className="fc-quick__ico">
              <Icon name={f.icon} size={15} weight="bold" />
            </span>
            <span className="fc-quick__txt">
              {f.when.charAt(0).toUpperCase() + f.when.slice(1).replace(/\.$/, "")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

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
              <div style={{ color: f.color, marginTop: 11, height: 22 }}>
                <Sig k={f.key} />
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--text-2)",
                  lineHeight: 1.45,
                  marginTop: 9,
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

/** Tagline de una feature (⚡ Reacciona al instante…) — chip para el header de
 *  cada sección; refuerza de un vistazo para qué es. Lee de FEATURES. */
export function FeatureTagline({ feature }: { feature: FeatureKey }) {
  const f = FEATURES.find((x) => x.key === feature);
  if (!f) return null;
  return (
    <span className="feat-tag" style={{ ["--fc-c" as string]: f.color }}>
      <Icon name={f.icon} size={12} weight="bold" />
      {f.tagline}
    </span>
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
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="¿Automatización, Journey, Bot o Agente IA?"
        className="max-w-[980px]"
      >
        <div style={{ marginTop: 14 }}>
          <QuickChooser current={current} />
          <div className="fc-divider">o compara en detalle</div>
          <FeatureCompare current={current} hideHeading />
        </div>
      </Modal>
    </>
  );
}
