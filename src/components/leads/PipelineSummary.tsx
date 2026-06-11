/**
 * PipelineSummary — la franja de resumen del embudo, arriba del board (firma
 * Kommo/Pipedrive que faltaba). Presentacional: recibe los stats ya calculados
 * para servir tanto a LeadsPage (datos reales) como a la demo (mock).
 *
 * Muestra: total de leads · valor total · valor ponderado (probabilístico) +
 * un mini-embudo segmentado (un tramo por etapa, ancho ∝ leads, color de la
 * etapa) con chips de etapa (N · monto) debajo.
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
  totalValue: number;
  weightedValue: number;
}

function money(n: number): string {
  if (!n || n <= 0) return "S/ 0";
  if (n >= 1_000_000) return `S/ ${(n / 1_000_000).toFixed(1)}M`;
  return n >= 1000 ? `S/ ${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `S/ ${Math.round(n)}`;
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingRight: 18, borderRight: "1px solid var(--border-1)" }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 21,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          color: accent || "var(--text-1)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function PipelineSummary({ stages, totalLeads, totalValue, weightedValue }: Props) {
  const max = Math.max(1, totalLeads);
  const active = stages.filter((s) => s.count > 0);

  return (
    <div
      style={{
        marginBottom: 16,
        border: "1px solid var(--border-1)",
        borderRadius: 14,
        background: "linear-gradient(135deg, var(--bg-2), var(--bg-1))",
        padding: "14px 18px",
        boxShadow: "var(--shadow-card, 0 1px 2px rgba(0,0,0,0.05))",
      }}
    >
      {/* KPIs */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <Kpi label="Leads en el embudo" value={String(totalLeads)} accent="var(--accent-cyan)" />
        <Kpi label="Valor total" value={money(totalValue)} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)" }}>
            Valor ponderado
          </span>
          <span style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: "var(--accent-green)", lineHeight: 1.1 }}>
            {money(weightedValue)}
          </span>
        </div>
        <span className="muted" style={{ fontSize: 11, marginLeft: "auto", maxWidth: 220, lineHeight: 1.4, textAlign: "right" }}>
          El valor ponderado pesa cada lead por su probabilidad de cierre según la etapa.
        </span>
      </div>

      {/* Mini-embudo segmentado */}
      <div style={{ marginTop: 14 }}>
        <div
          style={{
            display: "flex",
            height: 12,
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
              title={`${s.label}: ${s.count} leads`}
              style={{
                flex: `${s.count} 0 0`,
                minWidth: 6,
                background: s.color,
                opacity: 0.9,
                borderRight: "1px solid var(--bg-1)",
              }}
            />
          ))}
          {active.length === 0 && <div style={{ flex: 1, background: "var(--border-1)" }} />}
        </div>

        {/* Chips de etapa: N · monto */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
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
                opacity: s.count > 0 ? 1 : 0.55,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, flex: "0 0 auto" }} />
              {s.label}
              <span style={{ fontWeight: 800, color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>
                {s.count}
              </span>
              <span style={{ color: "var(--text-3)", fontWeight: 600 }}>
                {Math.round((s.count / max) * 100)}%
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
