import * as Icon from "@/components/vox/primitives";
import { FLOW_ICONS } from "@/components/bots/icons";
import { botColor } from "@/pages/FlowBuilderPage";

/**
 * /bots-demo — preview sin auth de la LISTA de bots premium (acento por bot +
 * cards aireadas). DEV only. La lista real está tras Cognito; /bot-demo muestra
 * el builder, no la lista. Datos mock.
 */

const STATUS_LABEL: Record<string, string> = { active: "Activo", draft: "Borrador", paused: "Pausado" };

const MOCK = [
  { name: "Bienvenida + menú", status: "active", trigger: "Mensaje nuevo", steps: 5, date: "8 jun 2026" },
  { name: "Calificación de lead", status: "active", trigger: "Lead nuevo", steps: 7, date: "5 jun 2026" },
  { name: "Preguntas frecuentes", status: "draft", trigger: "Manual", steps: 4, date: "3 jun 2026" },
  { name: "Reactivación 7 días", status: "paused", trigger: "Lead inactivo", steps: 3, date: "1 jun 2026" },
  { name: "Agendar visita técnica", status: "active", trigger: "Mensaje nuevo", steps: 6, date: "28 may 2026" },
  { name: "Encuesta NPS", status: "draft", trigger: "Post-contacto", steps: 2, date: "20 may 2026" },
];

const CardIcon = FLOW_ICONS.bot;

export function BotsDemoPage() {
  const counts = {
    all: MOCK.length,
    active: MOCK.filter((b) => b.status === "active").length,
    draft: MOCK.filter((b) => b.status === "draft").length,
    paused: MOCK.filter((b) => b.status === "paused").length,
  };
  const totalSteps = MOCK.reduce((s, b) => s + b.steps, 0);

  return (
    <div style={{ height: "100vh", overflow: "auto", background: "var(--bg-0)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: 24 }}>
        <div style={{ marginBottom: 6, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>
          Bots · preview premium (mock)
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 18px", color: "var(--text-1)" }}>Bots</h1>

        <div className="bots-kpis">
          <div className="bots-kpi"><span className="bots-kpi__n">{counts.all}</span><span className="bots-kpi__l">Bots</span></div>
          <div className="bots-kpi"><span className="bots-kpi__n" style={{ color: "var(--accent-green)" }}>{counts.active}</span><span className="bots-kpi__l">Activos</span></div>
          <div className="bots-kpi"><span className="bots-kpi__n" style={{ color: "var(--text-2)" }}>{counts.draft}</span><span className="bots-kpi__l">Borradores</span></div>
          <div className="bots-kpi"><span className="bots-kpi__n" style={{ color: "var(--accent-violet)" }}>{totalSteps}</span><span className="bots-kpi__l">Pasos totales</span></div>
        </div>

        <div className="bots-filters">
          <button className="bots-filter bots-filter--on">Todos<span className="bots-filter__n">{counts.all}</span></button>
          <button className="bots-filter">Activos<span className="bots-filter__n">{counts.active}</span></button>
          <button className="bots-filter">Borradores<span className="bots-filter__n">{counts.draft}</span></button>
          <button className="bots-filter">Pausados<span className="bots-filter__n">{counts.paused}</span></button>
        </div>

        <div className="bots-grid">
          {MOCK.map((b, i) => (
            <div key={i} className="bot-card" style={{ "--bot-accent": botColor(i) } as React.CSSProperties}>
              <div className="bot-card__top">
                <span className="bot-card__icon"><CardIcon size={17} /></span>
                <span className={`bot-card__status bot-card__status--${b.status}`}>{STATUS_LABEL[b.status]}</span>
              </div>
              <div className="bot-card__name">{b.name}</div>
              <div className="bot-card__rail" aria-hidden>
                {Array.from({ length: Math.max(1, Math.min(b.steps, 7)) }).map((_, k) => (
                  <span key={k} className="bot-card__dot" />
                ))}
              </div>
              <div className="bot-card__meta">
                <span className="bot-card__chip"><Icon.Workflow size={12} /> {b.trigger}</span>
                <span className="bot-card__chip">{b.steps} {b.steps === 1 ? "paso" : "pasos"}</span>
              </div>
              <div className="bot-card__foot">
                <span>{b.date}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button className="btn btn--ghost btn--sm" style={{ padding: "3px 10px", fontSize: 11.5, color: "var(--bot-accent, var(--accent-cyan))" }}>Probar</button>
                  <button className="bot-card__del"><Icon.Trash size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
