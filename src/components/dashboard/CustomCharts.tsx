import { useMemo, useState, type CSSProperties } from "react";
import type { EChartsOption } from "echarts";
import { EChart, useChartTokens, type ChartTokens } from "@/components/charts/EChart";
import * as Icon from "@/components/vox/primitives";

/**
 * CustomCharts — a user-customizable gallery of ECharts visuals for the
 * executive Inicio (Admins/Supervisors). Same "Personalizar" + localStorage
 * pattern as CustomWidgets (roadmap #8), but for charts.
 *
 * Design goals (per user): additive, NOT overloading. A curated default of 4
 * charts shows on load; the rest are available behind "Personalizar". Every
 * chart is fed REAL data via props (no mock) and only offered when its data
 * exists. Flat & hard style (square corners, solid color), infographic palette.
 */

export interface ChartData {
  dayLabels: string[];
  /** per-channel daily series (already in the active channels only) */
  channelSeries: { name: string; color: string; data: number[] }[];
  byQueue: { name: string; value: number; color?: string }[];
  liveQueues: { name: string; inQueue: number; available: number }[];
  funnel: { label: string; value: number; color: string }[];
  agentRank: { label: string; value: number }[];
  sources: { name: string; value: number; color?: string }[];
}

type ChartId =
  | "channelBreakdown"
  | "sourcesRings"
  | "queueBars"
  | "leadsPyramid"
  | "trendByChannel"
  | "agentRank"
  | "liveQueueLollipop"
  | "channelDotMatrix"
  | "sourcesPie";

/** A per-chart toggle control (e.g. "Comparación / Por canal", "% / N"). */
interface ChartControl {
  /** key used to namespace this control's state */
  key: string;
  options: { id: string; label: string }[];
}

interface ChartDef {
  id: ChartId;
  label: string;
  caption: string;
  /** wide charts span 2 columns in the 2-col grid */
  wide?: boolean;
  height?: number;
  available: (d: ChartData) => boolean;
  /** contextual toggle(s) shown in this chart's header */
  controls?: ChartControl[];
  /** ECharts option builder; `opt` carries the active control selection */
  build?: (d: ChartData, t: ChartTokens, opt: Record<string, string>) => EChartsOption;
  /** custom HTML render (Kommo-style blocks that aren't ECharts) */
  render?: (d: ChartData, t: ChartTokens, opt: Record<string, string>) => React.ReactNode;
}

// v2 key: ensures users get the improved Kommo-style defaults instead of the
// stale selection saved during the previous iteration.
// v3: the gallery now lives behind "Ver más" and must NOT duplicate the fixed
// cards above (funnel + sentiment are fixed; queue/sources live here). Defaults
// look great even with little data (Kommo-grade blocks, no empty plot area).
const LS_KEY = "vox_exec_charts_v3";
const DEFAULT_ON: ChartId[] = ["channelBreakdown", "sourcesRings", "trendByChannel", "channelDotMatrix"];

function loadEnabled(): Set<ChartId> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return new Set(JSON.parse(raw) as ChartId[]);
  } catch {
    /* default below */
  }
  return new Set<ChartId>(DEFAULT_ON);
}

function baseTooltip(t: ChartTokens) {
  return {
    backgroundColor: t.bg1,
    borderColor: t.border,
    borderWidth: 1,
    textStyle: { color: t.text1, fontSize: 12 },
    extraCssText: "border-radius:8px; box-shadow:0 8px 24px -8px rgba(0,0,0,0.5);",
  };
}

/** rgba from #rrggbb (or var()) + alpha. Falls back to the raw color for
 *  non-hex inputs (e.g. CSS vars) so gradients still render. */
function rgba(hex: string, a: number): string {
  if (!hex || hex[0] !== "#") return hex;
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Modern conversion funnel (Amplitude/Mixpanel-grade): centered tapering
 *  bars with gradient fills, value + % of top, and a step-to-step conversion
 *  chip between rows. Two modes: "funnel" (tapering) / "steps" (left-aligned). */
function ModernFunnel({
  stages,
  top,
  fmtPct,
  mode,
}: {
  stages: { label: string; value: number; color: string }[];
  top: number;
  fmtPct: (v: number) => string;
  mode: "funnel" | "steps";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, padding: "4px 0" }}>
      {stages.map((s, i) => {
        const widthPct = Math.max(8, (s.value / top) * 100); // min 8% so labels fit
        const prev = i === 0 ? null : stages[i - 1].value;
        // step conversion vs previous stage
        const conv = prev != null && prev > 0 ? Math.round((s.value / prev) * 100) : null;
        const drop = conv != null ? 100 - conv : null;
        return (
          <div key={s.label}>
            {/* connector + conversion chip between stages */}
            {i > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  height: 22,
                }}
              >
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: (drop ?? 0) > 50 ? "var(--accent-red)" : "var(--accent-green)",
                    background:
                      (drop ?? 0) > 50 ? "var(--accent-red-soft)" : "var(--accent-green-soft)",
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontVariantNumeric: "tabular-nums",
                  }}
                  title={`Conversión desde ${stages[i - 1].label}`}
                >
                  {conv}% ▼
                </span>
              </div>
            )}
            {/* the stage bar */}
            <div
              style={{
                display: "flex",
                justifyContent: mode === "funnel" ? "center" : "flex-start",
              }}
            >
              <div
                className="funnel-bar"
                style={{
                  width: `${widthPct}%`,
                  background: `linear-gradient(90deg, ${rgba(s.color, 0.92)}, ${s.color})`,
                  borderRadius: mode === "funnel" ? 8 : "0 8px 8px 0",
                }}
              >
                <span className="funnel-bar__label">{s.label}</span>
                <span className="funnel-bar__value">
                  {s.value}
                  <span className="funnel-bar__pct">{fmtPct(s.value)}</span>
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const CHARTS: ChartDef[] = [
  {
    // Kommo "INCOMING MESSAGES" block: big total + per-channel rows with a
    // proportion bar. Looks great even with little data (no empty plot area).
    id: "channelBreakdown",
    label: "Contactos por canal",
    caption: "desglose · estilo Kommo",
    height: 0,
    available: (d) => d.channelSeries.length > 0,
    controls: [{ key: "unit", options: [{ id: "n", label: "Número" }, { id: "pct", label: "%" }] }],
    render: (d, t, opt) => {
      const asPct = opt.unit === "pct";
      const rows = d.channelSeries
        .map((s) => ({ name: s.name, color: s.color, value: s.data.reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.value - a.value);
      const total = rows.reduce((a, r) => a + r.value, 0);
      const max = Math.max(1, ...rows.map((r) => r.value));
      return (
        <div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", color: t.palette[1], lineHeight: 1 }}>
              {total}
            </span>
            <span style={{ fontSize: 12, color: t.text3, marginBottom: 6 }}>contactos totales</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((r) => {
              const pct = total ? Math.round((r.value / total) * 100) : 0;
              return (
                <div key={r.name}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 4 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: r.color, flex: "0 0 auto" }} />
                    <span style={{ color: t.text2, flex: 1 }}>{r.name}</span>
                    <span style={{ color: t.text1, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {asPct ? `${pct}%` : r.value}
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: t.border, overflow: "hidden" }}>
                    <div style={{ width: `${asPct ? pct : (r.value / max) * 100}%`, height: "100%", background: r.color, borderRadius: 999, transition: "width .6s" }} />
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && <div style={{ color: t.text3, fontSize: 12 }}>Sin contactos en el período.</div>}
          </div>
        </div>
      );
    },
  },
  {
    // Kommo "LEAD SOURCES" concentric rings.
    id: "sourcesRings",
    label: "Fuentes de leads",
    caption: "anillos concéntricos · estilo Kommo",
    height: 300,
    available: (d) => d.sources.some((s) => s.value > 0),
    controls: [{ key: "view", options: [{ id: "rings", label: "Anillos" }, { id: "donut", label: "Dona" }] }],
    build: (d, t, opt) => {
      const data = d.sources.filter((s) => s.value > 0).slice(0, 5);
      const legend = { bottom: 0, data: data.map((s) => s.name), textStyle: { color: t.text2, fontSize: 11 }, icon: "circle" as const, itemWidth: 9, itemHeight: 9 };
      if (opt.view === "donut") {
        const total = data.reduce((a, s) => a + s.value, 0);
        return {
          tooltip: { ...baseTooltip(t), trigger: "item", formatter: "{b}: <b>{c}</b> ({d}%)" },
          legend,
          series: [{
            type: "pie", radius: ["46%", "76%"], center: ["50%", "46%"],
            itemStyle: { borderColor: t.bg2, borderWidth: 2 },
            label: { show: true, position: "center", formatter: `${total}\nleads`, color: t.text1, fontSize: 16, fontWeight: 700, lineHeight: 16 },
            data: data.map((s, i) => ({ name: s.name, value: s.value, itemStyle: { color: s.color || t.palette[i % t.palette.length] }, label: { show: false } })),
          }],
        };
      }
      const max = Math.max(1, ...data.map((s) => s.value));
      return {
        tooltip: { ...baseTooltip(t), trigger: "item", formatter: (p: unknown) => {
          const x = p as { seriesName: string; value: number; dataIndex: number };
          return x.dataIndex === 0 ? `${x.seriesName}: <b>${x.value}</b>` : "";
        } },
        legend,
        series: data.map((s, i) => {
          const outer = 90 - i * (70 / data.length);
          const inner = outer - 70 / data.length + 3;
          const color = s.color || t.palette[i % t.palette.length];
          return {
            name: s.name,
            type: "pie",
            radius: [`${inner}%`, `${outer}%`],
            center: ["50%", "46%"],
            startAngle: 90,
            label: { show: false },
            labelLine: { show: false },
            data: [
              { value: s.value, name: s.name, itemStyle: { color } },
              { value: max - s.value, name: "", itemStyle: { color: t.border }, tooltip: { show: false }, emphasis: { disabled: true } },
            ],
          };
        }),
      };
    },
  },
  {
    id: "trendByChannel",
    label: "Tendencia por canal",
    caption: "multi-línea",
    wide: true,
    height: 280,
    available: (d) => d.channelSeries.length > 0 && d.dayLabels.length > 1,
    controls: [{ key: "shape", options: [{ id: "line", label: "Líneas" }, { id: "area", label: "Áreas" }] }],
    build: (d, t, opt) => ({
      tooltip: { ...baseTooltip(t), trigger: "axis" },
      legend: { top: 0, textStyle: { color: t.text2, fontSize: 11 }, icon: "roundRect", itemWidth: 12, itemHeight: 8 },
      grid: { left: 34, right: 14, top: 30, bottom: 24 },
      xAxis: { type: "category", data: d.dayLabels, boundaryGap: false, axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.text3, fontSize: 10 }, axisTick: { show: false } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: t.border, type: "dashed" } }, axisLabel: { color: t.text3, fontSize: 10 } },
      series: d.channelSeries.map((s) => ({
        name: s.name, type: "line", smooth: false, symbol: "circle", symbolSize: 6,
        stack: opt.shape === "area" ? "all" : undefined,
        lineStyle: { width: 2, color: s.color }, itemStyle: { color: s.color, borderColor: t.bg2, borderWidth: 1.5 },
        areaStyle: opt.shape === "area" ? { color: rgba(s.color, 0.4) } : undefined,
        data: s.data,
      })),
    }),
  },
  {
    id: "queueBars",
    label: "Contactos por cola",
    caption: "barras horizontales",
    height: 280,
    available: (d) => d.byQueue.length > 0,
    controls: [{ key: "sort", options: [{ id: "desc", label: "Mayor" }, { id: "asc", label: "Menor" }] }],
    build: (d, t, opt) => {
      const rows = [...d.byQueue].sort((a, b) => (opt.sort === "asc" ? a.value - b.value : b.value - a.value));
      return {
        tooltip: { ...baseTooltip(t), trigger: "axis", axisPointer: { type: "shadow" } },
        grid: { left: 110, right: 28, top: 8, bottom: 8 },
        xAxis: { type: "value", splitLine: { lineStyle: { color: t.border, type: "dashed" } }, axisLabel: { color: t.text3, fontSize: 10 } },
        yAxis: {
          type: "category", inverse: true, data: rows.map((q) => q.name),
          axisLine: { lineStyle: { color: t.border } }, axisTick: { show: false },
          axisLabel: { color: t.text2, fontSize: 11 },
        },
        series: [{
          type: "bar", barWidth: 14,
          label: { show: true, position: "right", color: t.text1, fontSize: 11, fontWeight: 700 },
          data: rows.map((q, i) => ({ value: q.value, itemStyle: { color: q.color || t.palette[i % t.palette.length] } })),
        }],
      };
    },
  },
  {
    id: "leadsPyramid",
    label: "Embudo de conversión",
    caption: "leads por etapa",
    wide: true,
    height: 0,
    available: (d) => d.funnel.some((f) => f.value > 0),
    controls: [{ key: "view", options: [{ id: "funnel", label: "Embudo" }, { id: "steps", label: "Pasos" }] }],
    render: (d, t, opt) => {
      // keep only stages with data, descending; tip = first (top of funnel)
      const stages = d.funnel.filter((f) => f.value > 0);
      if (stages.length === 0) return <div style={{ color: t.text3, fontSize: 12 }}>Sin leads en el período.</div>;
      const top = stages[0].value || 1;
      const fmtPct = (v: number) => `${Math.round((v / top) * 100)}%`;
      return <ModernFunnel stages={stages} top={top} fmtPct={fmtPct} mode={opt.view === "steps" ? "steps" : "funnel"} />;
    },
  },
  {
    id: "agentRank",
    label: "Ranking de agentes",
    caption: "barras horizontales",
    height: 280,
    available: (d) => d.agentRank.length > 0,
    build: (d, t) => ({
      tooltip: { ...baseTooltip(t), trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 100, right: 28, top: 8, bottom: 8 },
      xAxis: { type: "value", splitLine: { lineStyle: { color: t.border, type: "dashed" } }, axisLabel: { color: t.text3, fontSize: 10 } },
      yAxis: {
        type: "category", inverse: true, data: d.agentRank.map((a) => a.label),
        axisLine: { lineStyle: { color: t.border } }, axisTick: { show: false },
        axisLabel: { color: t.text2, fontSize: 11 },
      },
      series: [{
        type: "bar", barWidth: 14,
        label: { show: true, position: "right", color: t.text1, fontSize: 11, fontWeight: 700 },
        data: d.agentRank.map((a, i) => ({ value: a.value, itemStyle: { color: t.palette[i % t.palette.length] } })),
      }],
    }),
  },
  {
    id: "liveQueueLollipop",
    label: "Cola en vivo",
    caption: "lollipop · contactos en cola",
    height: 280,
    available: (d) => d.liveQueues.length > 0,
    build: (d, t) => {
      const cats = d.liveQueues.map((q) => q.name);
      const vals = d.liveQueues.map((q) => q.inQueue);
      const max = Math.max(1, ...vals);
      return {
        tooltip: { ...baseTooltip(t), trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p: unknown) => {
          const a = p as { name: string; value: number }[];
          return `${a[0].name}: <b>${a[0].value}</b> en cola`;
        } },
        grid: { left: 30, right: 16, top: 24, bottom: 40 },
        xAxis: { type: "category", data: cats, axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.text3, fontSize: 10, interval: 0, rotate: cats.length > 4 ? 20 : 0 }, axisTick: { show: false } },
        yAxis: { type: "value", max: max + 1, splitLine: { lineStyle: { color: t.border, type: "dashed" } }, axisLabel: { color: t.text3, fontSize: 10 } },
        series: [
          { type: "bar", barWidth: 4, z: 1, data: vals.map((v, i) => ({ value: v, itemStyle: { color: t.palette[i % t.palette.length] } })) },
          {
            type: "scatter", symbol: "circle", symbolSize: 28, z: 3,
            data: vals.map((v, i) => ({
              value: [i, v],
              itemStyle: { color: t.bg2, borderColor: t.palette[i % t.palette.length], borderWidth: 2.5 },
              label: { show: true, formatter: String(v), color: t.palette[i % t.palette.length], fontSize: 11, fontWeight: 700 },
            })),
          },
        ],
      };
    },
  },
  {
    id: "channelDotMatrix",
    label: "Distribución por canal",
    caption: "dot-matrix (waffle)",
    height: 280,
    available: (d) => d.channelSeries.some((s) => s.data.some((v) => v > 0)),
    build: (d, t) => {
      const totals = d.channelSeries.map((s) => ({ name: s.name, color: s.color, value: s.data.reduce((a, b) => a + b, 0) }));
      const grand = totals.reduce((a, s) => a + s.value, 0) || 1;
      const cells: { value: [number, number]; itemStyle: { color: string }; name: string }[] = [];
      let idx = 0;
      totals.forEach((s) => {
        const dots = Math.round((s.value / grand) * 100);
        for (let k = 0; k < dots && idx < 100; k++) {
          cells.push({ value: [idx % 10, 9 - Math.floor(idx / 10)], itemStyle: { color: s.color }, name: s.name });
          idx++;
        }
      });
      return {
        tooltip: { ...baseTooltip(t), trigger: "item", formatter: (p: unknown) => (p as { name: string }).name },
        legend: { bottom: 0, data: totals.map((s) => s.name), textStyle: { color: t.text2, fontSize: 11 }, icon: "circle", itemWidth: 9, itemHeight: 9 },
        grid: { left: 6, right: 6, top: 6, bottom: 30 },
        xAxis: { type: "value", min: -0.5, max: 9.5, show: false },
        yAxis: { type: "value", min: -0.5, max: 9.5, show: false },
        series: [
          ...totals.map((s) => ({ name: s.name, type: "scatter" as const, data: [] as number[][], itemStyle: { color: s.color } })),
          { type: "scatter", symbol: "rect", symbolSize: 13, data: cells },
        ],
      };
    },
  },
  {
    id: "sourcesPie",
    label: "Fuentes de leads",
    caption: "pie explotado",
    height: 280,
    available: (d) => d.sources.some((s) => s.value > 0),
    build: (d, t) => ({
      tooltip: { ...baseTooltip(t), trigger: "item", formatter: "{b}: <b>{c}</b> ({d}%)" },
      legend: { bottom: 0, textStyle: { color: t.text2, fontSize: 11 }, icon: "circle", itemWidth: 9, itemHeight: 9 },
      series: [{
        type: "pie", radius: "66%", center: ["50%", "46%"], selectedMode: "single", selectedOffset: 12,
        itemStyle: { borderColor: t.bg2, borderWidth: 2 },
        label: { color: t.text2, fontSize: 11, formatter: "{d}%" },
        labelLine: { lineStyle: { color: t.border } },
        data: d.sources.map((s, i) => ({ name: s.name, value: s.value, selected: i === 0, itemStyle: { color: s.color || t.palette[i % t.palette.length] } })),
      }],
    }),
  },
];

const cardStyle: CSSProperties = {
  padding: 16, borderRadius: 14, background: "var(--bg-2)",
  border: "1px solid var(--border-1)", display: "flex", flexDirection: "column", minWidth: 0,
};
const labelStyle: CSSProperties = {
  fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--text-3)", fontWeight: 700,
};

/** One chart card: header (label + its own contextual toggles) + the chart. */
function ChartCardItem({ def, data, t }: { def: ChartDef; data: ChartData; t: ChartTokens }) {
  // local state for this chart's contextual controls (default = first option)
  const [opt, setOpt] = useState<Record<string, string>>(() =>
    Object.fromEntries((def.controls ?? []).map((c) => [c.key, c.options[0].id]))
  );
  return (
    <div style={{ ...cardStyle, gridColumn: def.wide ? "1 / -1" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={labelStyle}>{def.label}</div>
        <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>{def.caption}</span>
        {/* per-chart contextual toggles (Kommo "Comparación/Por canal" style) */}
        {def.controls && def.controls.length > 0 && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {def.controls.map((ctrl) => (
              <div key={ctrl.key} className="chart-toggle">
                {ctrl.options.map((o) => (
                  <button
                    key={o.id}
                    className={`chart-toggle__opt ${opt[ctrl.key] === o.id ? "chart-toggle__opt--active" : ""}`}
                    onClick={() => setOpt((p) => ({ ...p, [ctrl.key]: o.id }))}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {def.render
        ? def.render(data, t, opt)
        : def.build
        ? <EChart option={def.build(data, t, opt)} height={def.height ?? 280} />
        : null}
    </div>
  );
}

export function CustomCharts({ data, loading }: { data: ChartData; loading?: boolean }) {
  const t = useChartTokens();
  const [enabled, setEnabled] = useState<Set<ChartId>>(loadEnabled);
  const [customizing, setCustomizing] = useState(false);

  const toggle = (id: ChartId) =>
    setEnabled((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });

  // Only render charts that are enabled AND have real data to show.
  const shown = useMemo(
    () => CHARTS.filter((c) => enabled.has(c.id) && c.available(data)),
    [enabled, data]
  );

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <span style={labelStyle}>Mis gráficos</span>
        <button
          className="btn btn--ghost btn--sm"
          style={{ marginLeft: "auto" }}
          onClick={() => setCustomizing((c) => !c)}
        >
          <Icon.Settings size={12} /> Personalizar
        </button>
      </div>

      {customizing && (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 8 }}>
            Elige qué gráficos mostrar. Tu selección se guarda en este navegador.
          </div>
          <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
            {CHARTS.map((c) => {
              const has = c.available(data);
              return (
                <label
                  key={c.id}
                  className="row"
                  style={{ gap: 6, fontSize: 12.5, cursor: has ? "pointer" : "not-allowed", opacity: has ? 1 : 0.45 }}
                  title={has ? c.caption : "Sin datos en el período"}
                >
                  <input type="checkbox" checked={enabled.has(c.id)} disabled={!has} onChange={() => toggle(c.id)} />
                  {c.label}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12.5 }}>
          {loading ? "Cargando datos…" : 'No hay gráficos activos. Usa "Personalizar" para agregar.'}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {shown.map((c) => (
            <ChartCardItem key={c.id} def={c} data={data} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}
