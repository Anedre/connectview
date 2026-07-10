import { useEffect, useMemo, useState } from "react";
import { GraduationCap, TrendingUp, Target, CalendarClock, Layers } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useProgram } from "@/context/ProgramContext";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import type { Valoracion } from "@/lib/dispositions";

/**
 * ProgramReport (Pilar 9 · Fase A) — el "Dashboard por Programa": el reporte
 * diferido de Pilar 1 y el diferenciador #1 frente a Chattigo (que no tiene el
 * concepto de "programa"). Para el programa activo del switcher muestra:
 * embudo por etapa (funnel), KPIs de conversión/golpes, conversión por # de
 * golpes y la mezcla de canales. Se alimenta de manage-leads ?report=attribution
 * &programId= (que ahora devuelve byStage).
 */
interface Attribution {
  totalLeads: number;
  converted: number;
  conversionRate: number;
  avgGolpes: number;
  avgGolpesToClose: number;
  avgDaysToClose: number;
  totalGolpes: number;
  byBucket: Array<{ label: string; leads: number; converted: number; rate: number }>;
  byChannel: Record<string, number>;
  byStage: Record<string, number>;
}

const VAL_COLOR: Record<Valoracion, string> = {
  inicial: "var(--accent-cyan)",
  positiva: "var(--accent-green)",
  negativa: "var(--accent-red)",
  cierre: "var(--accent-violet)",
};

const CH_COLORS: Record<string, string> = {
  Llamada: "var(--accent-cyan)",
  WhatsApp: "var(--accent-green)",
  Correo: "var(--accent-amber)",
  Chat: "var(--accent-pink)",
};

function Kpi({
  icon,
  label,
  value,
  hint,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: "var(--bg-2)",
        border: "1px solid var(--border-1)",
        borderRadius: 13,
        padding: "13px 15px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(135deg, color-mix(in srgb, ${color} 10%, transparent), transparent 60%)`,
          pointerEvents: "none",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 7, position: "relative" }}>
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 24,
            height: 24,
            borderRadius: 7,
            background: `color-mix(in srgb, ${color} 16%, transparent)`,
            color,
          }}
        >
          {icon}
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: "var(--text-3)",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 800,
          lineHeight: 1.05,
          marginTop: 6,
          fontVariantNumeric: "tabular-nums",
          position: "relative",
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2, position: "relative" }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function ProgramReport() {
  const { activeProgramId, activeProgram } = useProgram();
  const { tree } = useTaxonomy();
  const [data, setData] = useState<Attribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scoped = !!activeProgramId && activeProgramId !== "all" && activeProgramId !== "none";

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const ep = getApiEndpoints();
      if (!ep?.manageLeads) {
        if (!cancelled) setLoading(false);
        return;
      }
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
      const url = `${ep.manageLeads}?report=attribution${scoped ? `&programId=${encodeURIComponent(activeProgramId)}` : ""}`;
      try {
        const r = await authedFetch(url);
        const d = await r.json();
        if (!cancelled) setData(d.attribution || null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeProgramId, scoped]);

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();

  // Embudo ordenado por la taxonomía (tree); etapas desconocidas van al final.
  const funnel = useMemo(() => {
    const byStage = data?.byStage || {};
    const known = tree.map((s) => ({
      id: s.id,
      label: s.label,
      color: VAL_COLOR[s.valoracion] || "var(--accent-violet)",
      count: byStage[s.id] || 0,
    }));
    const knownIds = new Set(tree.map((s) => s.id));
    const extra = Object.entries(byStage)
      .filter(([id]) => !knownIds.has(id))
      .map(([id, count]) => ({
        id,
        label: id === "(sin etapa)" ? "Sin etapa" : id,
        color: "var(--text-3)",
        count,
      }));
    return [...known, ...extra].filter((s) => s.count > 0);
  }, [data, tree]);

  const maxStage = Math.max(1, ...funnel.map((s) => s.count));

  return (
    <div
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border-2)",
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 34,
            height: 34,
            borderRadius: 10,
            background: "var(--accent-violet-soft)",
            color: "var(--accent-violet)",
            flex: "0 0 auto",
          }}
        >
          <GraduationCap size={18} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 800 }}>Dashboard por Programa</h3>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 1 }}>
            {scoped ? activeProgram?.name || "—" : "Todos los programas"}
          </div>
        </div>
      </div>

      {!scoped ? (
        <div
          style={{
            borderRadius: 12,
            border: "1px dashed var(--border-1)",
            background: "var(--bg-2)",
            padding: "20px 16px",
            textAlign: "center",
            color: "var(--text-3)",
            fontSize: 13,
          }}
        >
          Elige un programa en el selector de arriba para ver su embudo, conversión y golpes.
          Mostrando el consolidado de todos los programas.
        </div>
      ) : null}

      {loading ? (
        <div style={{ color: "var(--text-3)", padding: 24, textAlign: "center" }}>
          Cargando el dashboard del programa…
        </div>
      ) : error ? (
        <div className="chip chip--red" style={{ display: "block", padding: "8px 12px" }}>
          Error: {error}
        </div>
      ) : !data || data.totalLeads === 0 ? (
        <div
          style={{
            color: "var(--text-3)",
            padding: 24,
            textAlign: "center",
            marginTop: scoped ? 0 : 12,
          }}
        >
          Sin leads en este programa todavía.
        </div>
      ) : (
        <div style={{ marginTop: scoped ? 0 : 12 }}>
          {/* KPIs */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 11,
            }}
          >
            <Kpi
              icon={<Layers size={14} />}
              color="var(--accent-cyan)"
              label="Leads"
              value={String(data.totalLeads)}
              hint={`${data.totalGolpes} golpes · ${fmt1(data.avgGolpes)}/lead`}
            />
            <Kpi
              icon={<TrendingUp size={14} />}
              color="var(--accent-green)"
              label="Conversión"
              value={pct(data.conversionRate)}
              hint={`${data.converted}/${data.totalLeads} convertidos`}
            />
            <Kpi
              icon={<Target size={14} />}
              color="var(--accent-violet)"
              label="Golpes al cierre"
              value={data.avgGolpesToClose ? fmt1(data.avgGolpesToClose) : "—"}
              hint="promedio para convertir"
            />
            <Kpi
              icon={<CalendarClock size={14} />}
              color="var(--accent-amber)"
              label="Días al cierre"
              value={data.avgDaysToClose ? String(Math.round(data.avgDaysToClose)) : "—"}
              hint="del 1er toque al cierre"
            />
          </div>

          {/* Embudo por etapa */}
          <div style={{ marginTop: 20 }}>
            <h4
              style={{
                margin: "0 0 10px",
                fontSize: 12,
                color: "var(--text-2)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Embudo por etapa
            </h4>
            {funnel.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>Sin etapas asignadas.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {funnel.map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 150,
                        fontSize: 12,
                        color: "var(--text-2)",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={s.label}
                    >
                      {s.label}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: 22,
                        background: "var(--bg-3)",
                        borderRadius: 6,
                        overflow: "hidden",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(3, Math.round((s.count / maxStage) * 100))}%`,
                          height: "100%",
                          background: `linear-gradient(90deg, ${s.color}, color-mix(in srgb, ${s.color} 70%, transparent))`,
                          borderRadius: 6,
                          transition: "width .25s",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        width: 76,
                        fontSize: 11.5,
                        color: "var(--text-3)",
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <b style={{ color: "var(--text-1)" }}>{s.count}</b> ·{" "}
                      {pct(s.count / data.totalLeads)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Conversión por # de golpes + canales (2 columnas) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 20,
              marginTop: 20,
            }}
          >
            <div>
              <h4
                style={{
                  margin: "0 0 10px",
                  fontSize: 12,
                  color: "var(--text-2)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Conversión por # de golpes
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.byBucket.map((b) => (
                  <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 38,
                        fontSize: 12,
                        color: "var(--text-2)",
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {b.label}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: 16,
                        background: "var(--bg-3)",
                        borderRadius: 5,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round(b.rate * 100)}%`,
                          height: "100%",
                          background: "var(--accent-green)",
                          minWidth: b.converted > 0 ? 2 : 0,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        width: 88,
                        fontSize: 11,
                        color: "var(--text-3)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {pct(b.rate)} · {b.converted}/{b.leads}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4
                style={{
                  margin: "0 0 10px",
                  fontSize: 12,
                  color: "var(--text-2)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Golpes por canal
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.entries(data.byChannel).length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                    Sin golpes registrados.
                  </div>
                ) : (
                  Object.entries(data.byChannel)
                    .sort((a, b) => b[1] - a[1])
                    .map(([ch, n]) => {
                      const max = Math.max(1, ...Object.values(data.byChannel));
                      return (
                        <div key={ch} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ width: 80, fontSize: 12, color: "var(--text-2)" }}>
                            {ch}
                          </span>
                          <div
                            style={{
                              flex: 1,
                              height: 16,
                              background: "var(--bg-3)",
                              borderRadius: 5,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.round((n / max) * 100)}%`,
                                height: "100%",
                                background: CH_COLORS[ch] || "var(--text-3)",
                              }}
                            />
                          </div>
                          <span
                            style={{
                              width: 40,
                              fontSize: 11,
                              color: "var(--text-3)",
                              textAlign: "right",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {n}
                          </span>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
