/**
 * PipelineSummary — la franja de DISTRIBUCIÓN del embudo, arriba del board
 * (firma Kommo/Pipedrive). Presentacional: recibe los stats ya calculados para
 * servir tanto a LeadsPage (datos reales) como a la demo (mock).
 *
 * Muestra un mini-embudo segmentado (un tramo por etapa, ancho ∝ leads, color
 * de la etapa) con chips de etapa (N · %) debajo. Los KPIs numéricos (total /
 * valor / ponderado) NO viven aquí — ya están en el strip de Stat cards del
 * header, así que aquí solo mostramos lo que ese strip no muestra: la forma del
 * embudo (dónde se acumulan los leads).
 */

export interface PipelineStageStat {
  id: string;
  label: string;
  color: string;
  count: number;
  value: number;
}

interface Props {
  stages: PipelineStageStat[];
  totalLeads: number;
  /** Retro-compat con call sites; ya no se renderizan aquí (viven en el strip). */
  totalValue?: number;
  weightedValue?: number;
}

export function PipelineSummary({ stages, totalLeads }: Props) {
  const max = Math.max(1, totalLeads);
  const active = stages.filter((s) => s.count > 0);

  return (
    <div
      style={{
        marginBottom: 16,
        border: "1px solid var(--border-1)",
        borderRadius: 14,
        background: "linear-gradient(135deg, var(--bg-2), var(--bg-1))",
        padding: "13px 18px 15px",
        boxShadow: "var(--shadow-card, 0 1px 2px rgba(0,0,0,0.05))",
      }}
    >
      {/* Encabezado ligero — contexto de la barra (sin repetir KPIs) */}
      <div className="row between" style={{ alignItems: "baseline", marginBottom: 11 }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          Distribución del embudo
        </span>
        <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
          {totalLeads} {totalLeads === 1 ? "lead" : "leads"} · {active.length}{" "}
          {active.length === 1 ? "etapa activa" : "etapas activas"}
        </span>
      </div>

      {/* Mini-embudo segmentado */}
      <div
        style={{
          display: "flex",
          height: 13,
          borderRadius: 999,
          overflow: "hidden",
          background: "var(--bg-3, var(--bg-2))",
          border: "1px solid var(--border-1)",
        }}
        role="img"
        aria-label="Distribución de leads por etapa"
      >
        {active.map((s) => (
          <div
            key={s.id}
            title={`${s.label}: ${s.count} leads (${Math.round((s.count / max) * 100)}%)`}
            style={{
              flex: `${s.count} 0 0`,
              minWidth: 6,
              background: s.color,
              opacity: 0.92,
              borderRight: "1px solid var(--bg-1)",
            }}
          />
        ))}
        {active.length === 0 && <div style={{ flex: 1, background: "var(--border-1)" }} />}
      </div>

      {/* Chips de etapa: N · % */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 11 }}>
        {stages.map((s) => (
          <span
            key={s.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 9px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              color: "var(--text-2)",
              opacity: s.count > 0 ? 1 : 0.5,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: s.color,
                flex: "0 0 auto",
              }}
            />
            {s.label}
            <span
              style={{
                fontWeight: 800,
                color: "var(--text-1)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {s.count}
            </span>
            <span style={{ color: "var(--text-3)", fontWeight: 600 }}>
              {Math.round((s.count / max) * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
