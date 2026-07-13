import { useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { EChartsOption } from "echarts";
import { EChart, useChartTokens } from "@/components/charts/EChart";
import { Num } from "@/components/aria";
import { formatDurationSec } from "@/lib/utils";

/**
 * ReportsHero — el resumen ejecutivo narrado del período. La métrica estrella en
 * grande con su tendencia, un insight en lenguaje natural derivado de los datos
 * (no de una plantilla fija), y chips con las métricas de apoyo. Reemplaza al
 * HeroBand que no pintaba nada: es lo primero que ve el supervisor y cuenta la
 * historia del período de un vistazo.
 */

export interface HeroKpis {
  total: number;
  avgAht: number;
  medianAht: number;
  posPct: number;
  score: number;
}

export interface ChannelSlice {
  key: string;
  label: string;
  count: number;
  color: string;
}

function pctDelta(curr: number, prev?: number): number | null {
  if (prev == null || prev === 0) return null;
  return Math.round(((curr - prev) / Math.abs(prev)) * 100);
}

/**
 * Genera 1–3 frases de insight a partir de los KPIs, sus deltas y la mezcla de
 * canales. Prioriza lo más "noticiable" (mayor cambio primero). Determinista y
 * sin backend — si no hay señal, cae a una frase neutra.
 */
function narrate(kpis: HeroKpis, prev: HeroKpis | null, mix: ChannelSlice[]): string[] {
  const out: { text: string; weight: number }[] = [];
  const total = mix.reduce((a, c) => a + c.count, 0);

  const dv = prev ? pctDelta(kpis.total, prev.total) : null;
  if (dv != null && Math.abs(dv) >= 5) {
    out.push({
      text: `el volumen ${dv > 0 ? "subió" : "bajó"} ${Math.abs(dv)}% frente al período anterior`,
      weight: Math.abs(dv) + 20,
    });
  }

  const dominant = [...mix].sort((a, b) => b.count - a.count)[0];
  if (dominant && total > 0 && dominant.count > 0) {
    const pct = Math.round((dominant.count / total) * 100);
    if (pct >= 40)
      out.push({ text: `${dominant.label} domina con el ${pct}% del volumen`, weight: pct });
  }

  if (prev) {
    const ds = kpis.posPct - prev.posPct;
    if (Math.abs(ds) >= 3)
      out.push({
        text: `el sentimiento positivo ${ds > 0 ? "mejoró" : "cayó"} ${Math.abs(ds)} puntos`,
        weight: Math.abs(ds) + 10,
      });
    const da = pctDelta(kpis.avgAht, prev.avgAht);
    if (da != null && Math.abs(da) >= 8)
      out.push({
        text: `el tiempo de atención ${da > 0 ? "creció" : "bajó"} ${Math.abs(da)}%${da < 0 ? " — la operación está más ágil" : ""}`,
        weight: Math.abs(da),
      });
  }

  if (out.length === 0) {
    if (kpis.total === 0) return ["Sin actividad en el período elegido."];
    return [
      `${kpis.total} contacto${kpis.total === 1 ? "" : "s"} en el período, con ${kpis.posPct}% de sentimiento positivo.`,
    ];
  }

  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map((o) => o.text);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ReportsHero({
  kpis,
  prevKpis,
  volumeSpark,
  channelMix,
  periodLabel,
  loading,
  onChannelClick,
  activeChannel,
}: {
  kpis: HeroKpis;
  prevKpis: HeroKpis | null;
  volumeSpark: number[];
  channelMix: ChannelSlice[];
  periodLabel: string;
  loading: boolean;
  /** Drill-down: clic en un canal de la mezcla → filtra la vista de abajo. */
  onChannelClick?: (key: string) => void;
  activeChannel?: string | null;
}) {
  const t = useChartTokens();
  const [compare, setCompare] = useState(false);
  const dv = pctDelta(kpis.total, prevKpis?.total);
  const insights = useMemo(() => narrate(kpis, prevKpis, channelMix), [kpis, prevKpis, channelMix]);

  // Comparación con el período anterior (feature "explorable"): actual vs previo
  // + Δ por métrica. Solo si tenemos los KPIs del período previo.
  const compareRows: {
    label: string;
    curr: string;
    prev: string;
    delta: number | null;
    invert?: boolean;
  }[] = prevKpis
    ? [
        {
          label: "Volumen",
          curr: String(kpis.total),
          prev: String(prevKpis.total),
          delta: pctDelta(kpis.total, prevKpis.total),
        },
        {
          label: "AHT prom.",
          curr: kpis.avgAht ? formatDurationSec(Math.round(kpis.avgAht)) : "—",
          prev: prevKpis.avgAht ? formatDurationSec(Math.round(prevKpis.avgAht)) : "—",
          delta: pctDelta(kpis.avgAht, prevKpis.avgAht),
          invert: true,
        },
        {
          label: "Sentimiento +",
          curr: `${kpis.posPct}%`,
          prev: `${prevKpis.posPct}%`,
          delta: kpis.posPct - prevKpis.posPct,
        },
        {
          label: "Score neto",
          curr: `${kpis.score >= 0 ? "+" : ""}${Math.round(kpis.score)}`,
          prev: `${prevKpis.score >= 0 ? "+" : ""}${Math.round(prevKpis.score)}`,
          delta: kpis.score - prevKpis.score,
        },
      ]
    : [];
  const narrative = insights.length ? capitalize(insights.join(", y ")) + "." : "";

  const sparkOption: EChartsOption = useMemo(
    () => ({
      animationDuration: 700,
      grid: { left: 0, right: 0, top: 6, bottom: 2 },
      xAxis: { type: "category", show: false, data: volumeSpark.map((_, i) => i) },
      yAxis: { type: "value", show: false, min: 0 },
      tooltip: {
        trigger: "axis",
        backgroundColor: t.bg2,
        borderColor: t.border,
        borderWidth: 1,
        textStyle: { color: t.text1, fontSize: 12 },
        extraCssText: "border-radius:10px;",
        formatter: (ps: unknown) => {
          const p = (ps as Array<{ value: number }>)[0];
          return `<b>${p.value}</b> contactos`;
        },
      },
      series: [
        {
          type: "line",
          data: volumeSpark,
          smooth: 0.4,
          symbol: "none",
          lineStyle: { width: 2.5, color: "var(--cyan)" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "color-mix(in srgb, var(--cyan) 34%, transparent)" },
                { offset: 1, color: "color-mix(in srgb, var(--cyan) 2%, transparent)" },
              ],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
          },
        },
      ],
    }),
    [volumeSpark, t],
  );

  const chips: { label: string; value: string; color: string }[] = [
    {
      label: "Sentimiento",
      value: `${kpis.posPct}% positivo`,
      color: "var(--green)",
    },
    {
      label: "AHT",
      value: kpis.avgAht ? formatDurationSec(Math.round(kpis.avgAht)) : "—",
      color: "var(--gold)",
    },
    {
      label: "Score neto",
      value: `${kpis.score >= 0 ? "+" : ""}${Math.round(kpis.score)}`,
      color: "var(--iris)",
    },
  ];

  return (
    <div
      className="rep-hero"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 18,
        border: "1px solid var(--border-1)",
        background:
          "radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--cyan) 10%, var(--bg-1)) 0%, var(--bg-1) 55%)",
        padding: "22px 24px",
        marginBottom: 18,
      }}
    >
      {/* Glow decorativo */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -80,
          right: -60,
          width: 260,
          height: 260,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--iris) 16%, transparent), transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr)",
          gap: 24,
          alignItems: "center",
          position: "relative",
        }}
        className="rep-hero__grid"
      >
        {/* Izquierda: métrica estrella + narrativa */}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: ".06em",
              color: "var(--text-3)",
              marginBottom: 6,
            }}
          >
            Resumen · {periodLabel}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div
              style={{
                fontSize: 46,
                fontWeight: 850,
                lineHeight: 1,
                letterSpacing: "-.02em",
                color: "var(--text-1)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {loading ? "—" : <Num value={kpis.total} />}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>
                contactos
              </span>
              {dv != null && dv !== 0 && (
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 800,
                    color: dv > 0 ? "var(--green)" : "var(--coral)",
                  }}
                >
                  {dv > 0 ? "▲" : "▼"} {Math.abs(dv)}% vs. previo
                </span>
              )}
            </div>
          </div>

          <p
            style={{
              margin: "14px 0 0",
              fontSize: 14.5,
              lineHeight: 1.55,
              color: "var(--text-1)",
              fontWeight: 500,
              maxWidth: 460,
            }}
          >
            {loading ? "Analizando el período…" : narrative}
          </p>

          <div className="row gap8 wrap" style={{ marginTop: 16 }}>
            {chips.map((c) => (
              <span
                key={c.label}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "6px 11px",
                  borderRadius: 10,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border-1)",
                }}
              >
                <span
                  style={{ width: 7, height: 7, borderRadius: 99, background: c.color }}
                  aria-hidden
                />
                <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>
                  {c.label}
                </span>
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 750,
                    color: "var(--text-1)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {c.value}
                </span>
              </span>
            ))}
          </div>

          {compareRows.length > 0 && (
            <button
              type="button"
              onClick={() => setCompare((c) => !c)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginTop: 14,
                padding: "6px 11px",
                borderRadius: 9,
                border: "1px solid var(--border-1)",
                background: compare
                  ? "color-mix(in srgb, var(--cyan) 12%, var(--bg-1))"
                  : "var(--bg-2)",
                color: compare ? "var(--cyan)" : "var(--text-2)",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <ArrowLeftRight size={13} />{" "}
              {compare ? "Ocultar comparación" : "Comparar con período anterior"}
            </button>
          )}
        </div>

        {/* Derecha: tendencia + mezcla de canales */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 700, marginBottom: 2 }}>
            Tendencia del volumen
          </div>
          <div style={{ height: 92 }}>
            {volumeSpark.length > 1 ? (
              <EChart option={sparkOption} height={92} />
            ) : (
              <div
                className="dim"
                style={{ height: 92, display: "grid", placeItems: "center", fontSize: 12 }}
              >
                Necesita más de un día de datos
              </div>
            )}
          </div>
          <ChannelMixBar mix={channelMix} active={activeChannel} onSelect={onChannelClick} />
        </div>
      </div>

      {compare && compareRows.length > 0 && (
        <div
          style={{
            position: "relative",
            marginTop: 18,
            borderTop: "1px solid var(--border-1)",
            paddingTop: 14,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: ".05em",
              color: "var(--text-3)",
              marginBottom: 10,
            }}
          >
            Este período vs. el anterior
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
            }}
          >
            {compareRows.map((r, i) => {
              const unit = i < 2 ? "%" : " pts";
              const good = r.delta == null ? null : r.invert ? r.delta < 0 : r.delta > 0;
              const color =
                r.delta == null || r.delta === 0
                  ? "var(--text-3)"
                  : good
                    ? "var(--green)"
                    : "var(--coral)";
              return (
                <div
                  key={r.label}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "var(--bg-2)",
                    border: "1px solid var(--border-1)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>
                    {r.label}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3 }}>
                    <span
                      style={{
                        fontSize: 18,
                        fontWeight: 800,
                        color: "var(--text-1)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {r.curr}
                    </span>
                    {r.delta != null && r.delta !== 0 && (
                      <span style={{ fontSize: 12, fontWeight: 700, color }}>
                        {r.delta > 0 ? "▲" : "▼"} {Math.abs(r.delta)}
                        {unit}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
                    antes: {r.prev}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Barra apilada de mezcla de canales + leyenda compacta CLICABLE (drill-down). */
function ChannelMixBar({
  mix,
  active,
  onSelect,
}: {
  mix: ChannelSlice[];
  active?: string | null;
  onSelect?: (key: string) => void;
}) {
  const present = mix.filter((c) => c.count > 0);
  const total = present.reduce((a, c) => a + c.count, 0);
  if (total === 0) return null;
  const clickable = !!onSelect;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 2, height: 9, borderRadius: 99, overflow: "hidden" }}>
        {present.map((c) => (
          <div
            key={c.key}
            title={`${c.label}: ${c.count}`}
            style={{
              flex: c.count,
              background: c.color,
              opacity: active && active !== c.key ? 0.35 : 1,
              transition: "opacity .15s",
            }}
          />
        ))}
      </div>
      <div className="row wrap gap8" style={{ marginTop: 8 }}>
        {present
          .sort((a, b) => b.count - a.count)
          .map((c) => {
            const on = active === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={clickable ? () => onSelect!(c.key) : undefined}
                title={clickable ? (on ? "Quitar filtro" : `Filtrar por ${c.label}`) : undefined}
                className="row gap4"
                style={{
                  alignItems: "center",
                  padding: "3px 8px",
                  borderRadius: 8,
                  border: on ? `1px solid ${c.color}` : "1px solid transparent",
                  background: on
                    ? `color-mix(in srgb, ${c.color} 12%, transparent)`
                    : "transparent",
                  cursor: clickable ? "pointer" : "default",
                  opacity: active && !on ? 0.55 : 1,
                }}
              >
                <span
                  style={{ width: 8, height: 8, borderRadius: 99, background: c.color }}
                  aria-hidden
                />
                <span style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 600 }}>
                  {c.label}
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    color: "var(--text-3)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {Math.round((c.count / total) * 100)}%
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
