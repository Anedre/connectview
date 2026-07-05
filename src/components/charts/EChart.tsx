import { useEffect, useState } from "react";
// PERF-A2 · echarts SELECTIVO: en vez de `echarts-for-react` (que arrastra TODO
// echarts, ~330KB gz), importamos el core tree-shakeable y registramos SOLO lo
// que la app usa realmente. El wrapper liviano vive en `echarts-for-react/lib/core`.
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import {
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  ScatterChart,
  PictorialBarChart,
  RadarChart,
  FunnelChart,
} from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  MarkPointComponent,
  MarkLineComponent,
  AxisPointerComponent,
  DatasetComponent,
  TransformComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

/**
 * EChart — thin, theme-aware Apache ECharts wrapper for Connectview.
 *
 * - Uses the SVG renderer (crisp, exportable, screenshot-friendly).
 * - Resolves the app's CSS design tokens (--text-*, --border-1, --bg-*) to
 *   concrete colors so charts match the active light/dark theme, and re-reads
 *   them whenever the theme attribute on <html> changes (via MutationObserver,
 *   so it works regardless of which theme provider is in use).
 * - Ships the agreed "infographic" palette (teal / emerald / lime / orange).
 *
 * ECharts is Apache-2.0 (free for commercial use) and far more capable than
 * recharts for premium, interactive visuals (gradients, markPoint pins,
 * pictorialBar ribbons, native gauges, rich tooltips).
 *
 * NOTA (bundle): registramos aquí SOLO las series y componentes que se usan en
 * toda la app (grep `type: "..."` + tooltip/legend/grid/markPoint/axisPointer).
 * Si agregás un gráfico con una serie o componente nuevo (p.ej. heatmap,
 * visualMap, dataZoom), IMPORTALO + agregalo al `echarts.use([...])` de abajo,
 * o el gráfico se renderiza vacío sin lanzar error.
 */

// Registro único de módulos de ECharts (idempotente).
echarts.use([
  // Series efectivamente usadas en la app.
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  ScatterChart,
  PictorialBarChart,
  RadarChart,
  FunnelChart,
  // Componentes de layout / interacción.
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  MarkPointComponent,
  MarkLineComponent,
  AxisPointerComponent,
  DatasetComponent,
  TransformComponent,
  // Renderer (el wrapper pide siempre "svg").
  SVGRenderer,
]);

export interface ChartTokens {
  text1: string;
  text2: string;
  text3: string;
  border: string;
  bg1: string;
  bg2: string;
  /** infographic palette: teal · emerald · lime · orange · cyan-teal · amber */
  palette: string[];
}

const PALETTE = ["#15485A", "#2E9D8E", "#92C73E", "#F2972E", "#1C97A6", "#F5A524"];

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function readTokens(): ChartTokens {
  return {
    text1: cssVar("--text-1", "#E8ECF4"),
    text2: cssVar("--text-2", "#94A3BE"),
    text3: cssVar("--text-3", "#5F6E8C"),
    border: cssVar("--border-1", "#1F2B43"),
    bg1: cssVar("--bg-1", "#111A2C"),
    bg2: cssVar("--bg-2", "#18243A"),
    palette: PALETTE,
  };
}

/** Read the app's theme tokens; recomputes ONLY when the theme actually flips.
 *  Returns a stable object reference between theme changes so chart options
 *  memoized on it don't recompute (which, with notMerge, restarts ECharts
 *  entrance animations on every unrelated <html> attribute mutation). */
export function useChartTokens(): ChartTokens {
  const [tokens, setTokens] = useState<ChartTokens>(() => readTokens());
  useEffect(() => {
    const apply = () =>
      setTokens((prev) => {
        const next = readTokens();
        const unchanged =
          prev.text1 === next.text1 &&
          prev.text2 === next.text2 &&
          prev.text3 === next.text3 &&
          prev.border === next.border &&
          prev.bg1 === next.bg1 &&
          prev.bg2 === next.bg2;
        return unchanged ? prev : next; // keep stable ref unless a value changed
      });
    // Only watch the theme switches (class / data-theme) — NOT style, which the
    // app mutates often (scroll locks, etc.) and would thrash the charts.
    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    apply(); // re-read once after mount in case vars resolved late
    return () => obs.disconnect();
  }, []);
  return tokens;
}

interface EChartProps {
  option: EChartsOption;
  height?: number | string;
  className?: string;
}

export function EChart({ option, height = 300, className }: EChartProps) {
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ height, width: "100%" }}
      opts={{ renderer: "svg" }}
      notMerge
      lazyUpdate
      className={className}
    />
  );
}
