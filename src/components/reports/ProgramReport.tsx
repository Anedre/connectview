import { useEffect, useMemo, useState } from "react";
import { GraduationCap, TrendingUp, Target, CalendarClock, Layers } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useProgram } from "@/context/ProgramContext";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import type { Valoracion } from "@/lib/dispositions";
import { Kpi, KpiRow, BarList, Funnel } from "@/components/reports/kit";

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
  inicial: "var(--cyan)",
  positiva: "var(--green)",
  negativa: "var(--red)",
  cierre: "var(--iris)",
};

const CH_COLORS: Record<string, string> = {
  Llamada: "var(--cyan)",
  WhatsApp: "var(--green)",
  Correo: "var(--gold)",
  Chat: "var(--coral)",
};

export function ProgramReport() {
  const { activeProgramId, activeProgram } = useProgram();
  const { tree } = useTaxonomy(activeProgram?.taxonomyId);
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
          <KpiRow>
            <Kpi
              icon={<Layers size={14} />}
              color="var(--cyan)"
              label="Leads"
              value={data.totalLeads}
              sub={`${data.totalGolpes} golpes · ${fmt1(data.avgGolpes)}/lead`}
            />
            <Kpi
              icon={<TrendingUp size={14} />}
              color="var(--green)"
              label="Conversión"
              value={pct(data.conversionRate)}
              sub={`${data.converted}/${data.totalLeads} convertidos`}
            />
            <Kpi
              icon={<Target size={14} />}
              color="var(--iris)"
              label="Golpes al cierre"
              value={data.avgGolpesToClose ? fmt1(data.avgGolpesToClose) : "—"}
              sub="promedio para convertir"
            />
            <Kpi
              icon={<CalendarClock size={14} />}
              color="var(--gold)"
              label="Días al cierre"
              value={data.avgDaysToClose ? String(Math.round(data.avgDaysToClose)) : "—"}
              sub="del 1er toque al cierre"
            />
          </KpiRow>

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
              <Funnel
                total={data.totalLeads}
                stages={funnel.map((s) => ({ label: s.label, value: s.count, color: s.color }))}
              />
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
              <BarList
                color="var(--green)"
                max={100}
                rows={data.byBucket.map((b) => ({
                  label: `${b.label} golpes`,
                  value: Math.round(b.rate * 100),
                  valueLabel: `${pct(b.rate)} · ${b.converted}/${b.leads}`,
                }))}
              />
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
              {Object.entries(data.byChannel).length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>Sin golpes registrados.</div>
              ) : (
                <BarList
                  rows={Object.entries(data.byChannel)
                    .sort((a, b) => b[1] - a[1])
                    .map(([ch, n]) => ({
                      label: ch,
                      value: n,
                      color: CH_COLORS[ch] || "var(--text-3)",
                    }))}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
