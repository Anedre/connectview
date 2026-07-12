import { RefreshCw } from "lucide-react";
import type { JourneyStats } from "@/hooks/useJourneys";
import { JOURNEY_ICONS } from "@/lib/journeyFlow";

/**
 * JourneyActivity — el tab "Actividad" del panel derecho: observabilidad EN VIVO
 * de un journey corriendo. KPIs (inscritos/activos/completados), embudo por paso
 * (cuántos leads en cada estación, con barra) y timeline reciente. El builder lo
 * re-consulta por polling mientras el tab está abierto → indicador "en vivo".
 * Sin journey guardado no hay stats (se pide guardar + activar).
 */
export interface ActivityStep {
  id: string;
  label: string;
  icon: string;
  accent: string;
}

function agoText(ts: number | null): string {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "ahora";
  if (s < 60) return `hace ${s}s`;
  return `hace ${Math.round(s / 60)}m`;
}

export function JourneyActivity({
  saved,
  stats,
  steps,
  live,
  lastUpdated,
  loading,
  onRefresh,
}: {
  /** ¿El journey está guardado? (sin id no hay stats). */
  saved: boolean;
  stats: JourneyStats | null;
  steps: ActivityStep[];
  live: boolean;
  lastUpdated: number | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const byNode = stats?.byNode || {};
  const maxCount = Math.max(1, ...steps.map((s) => byNode[s.id] || 0));
  const total = stats?.total || 0;
  const active = stats?.byStatus?.active || 0;
  const done = stats?.byStatus?.done || 0;
  const recent = stats?.recent || [];
  const labelOf = (id: string) => steps.find((s) => s.id === id)?.label || id;

  return (
    <div className="ja">
      <div className="ja__bar">
        <span className={`ja__live ${live ? "ja__live--on" : ""}`}>
          <span className="ja__dot" />
          {live ? "En vivo" : "Actividad"}
        </span>
        <span className="ja__ago">{agoText(lastUpdated)}</span>
        <button
          className="ja__refresh"
          onClick={onRefresh}
          disabled={loading}
          title="Actualizar ahora"
          aria-label="Actualizar"
        >
          <RefreshCw size={13} className={loading ? "ja__spin" : ""} />
        </button>
      </div>

      {!saved ? (
        <div className="ja__empty">
          Guarda y activa el journey para ver su actividad en vivo (inscritos, en qué paso está cada
          lead y el timeline).
        </div>
      ) : total === 0 ? (
        <div className="ja__empty">
          Todavía no hay leads inscritos. Cuando entren (por segmento, disparador o manual desde
          Leads), aparecerán aquí en tiempo real.
        </div>
      ) : (
        <>
          <div className="ja__kpis">
            <div className="ja__kpi">
              <span className="ja__kpi-n">{total}</span>
              <span className="ja__kpi-l">inscritos</span>
            </div>
            <div className="ja__kpi ja__kpi--active">
              <span className="ja__kpi-n">{active}</span>
              <span className="ja__kpi-l">activos</span>
            </div>
            <div className="ja__kpi ja__kpi--done">
              <span className="ja__kpi-n">{done}</span>
              <span className="ja__kpi-l">completados</span>
            </div>
          </div>

          <div className="ja__section">Embudo — leads por paso</div>
          <div className="ja__funnel">
            {steps.map((s) => {
              const c = byNode[s.id] || 0;
              const Icon = JOURNEY_ICONS[s.icon] || JOURNEY_ICONS.action;
              return (
                <div key={s.id} className="ja__row" style={{ ["--_c" as string]: s.accent }}>
                  <span className="ja__row-ico">
                    <Icon size={12} strokeWidth={2.2} />
                  </span>
                  <span className="ja__row-label" title={s.label}>
                    {s.label}
                  </span>
                  <span className="ja__row-bar">
                    <span className="ja__row-fill" style={{ width: `${(c / maxCount) * 100}%` }} />
                  </span>
                  <span className="ja__row-n">{c}</span>
                </div>
              );
            })}
          </div>

          {recent.length > 0 && (
            <>
              <div className="ja__section">Actividad reciente</div>
              <div className="ja__timeline">
                {recent.slice(0, 14).map((r, i) => (
                  <div key={i} className="ja__tl">
                    <span className="ja__tl-dot" />
                    <div className="ja__tl-body">
                      <div className="ja__tl-note">{r.note || `Pasó a "${labelOf(r.node)}"`}</div>
                      <div className="ja__tl-meta">
                        {r.leadId.slice(0, 14)}
                        {r.at
                          ? " · " +
                            new Date(r.at).toLocaleString("es-PE", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
