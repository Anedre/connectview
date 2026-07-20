import { useEffect, useMemo, useState } from "react";
// PERF-A2 · echarts SELECTIVO: en vez de `echarts-for-react` (que arrastra TODO
// echarts, ~330KB gz), importamos el core tree-shakeable y registramos SOLO lo
// que la app usa realmente. El wrapper liviano vive en `echarts-for-react/lib/core`.
import ReactEChartsCoreImport from "echarts-for-react/lib/core";
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

// `echarts-for-react/lib/core` es CJS (`exports.default = Component`). Según el
// interop CJS/ESM de Vite/rolldown, el import default puede traer el objeto módulo
// (`{ default: Component }`) en vez del componente → "Element type is invalid: …
// got: object". Normalizamos tomando `.default` si vino envuelto.
const ReactEChartsCore = ((ReactEChartsCoreImport as { default?: typeof ReactEChartsCoreImport })
  .default ?? ReactEChartsCoreImport) as typeof ReactEChartsCoreImport;

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
 * Si agregas un gráfico con una serie o componente nuevo (p.ej. heatmap,
 * visualMap, dataZoom), IMPORTALO + agrégalo al `echarts.use([...])` de abajo,
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
  /** Acentos ARIA resueltos del DOM (valores concretos, reactivos al tema) — para
   *  que los charts no hardcodeen hex que rompen el dark mode. */
  cyan: string;
  green: string;
  red: string;
  gold: string;
  iris: string;
  coral: string;
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
    cyan: cssVar("--cyan", "#2bc6e6"),
    green: cssVar("--green", "#33c084"),
    red: cssVar("--red", "#ed5257"),
    gold: cssVar("--gold", "#f5c518"),
    iris: cssVar("--iris", "#9b6dff"),
    coral: cssVar("--coral", "#ff7a66"),
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
          prev.bg2 === next.bg2 &&
          prev.cyan === next.cyan &&
          prev.green === next.green &&
          prev.red === next.red &&
          prev.gold === next.gold &&
          prev.iris === next.iris &&
          prev.coral === next.coral;
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

// La fuente de la app (Plus Jakarta) NO llega sola al SVG de ECharts: sin
// textStyle.fontFamily todo texto de chart cae a la sans-serif genérica del
// renderer y se ve "de otra familia". La resolvemos una vez del body computado.
let APP_FONT: string | null = null;
function appFont(): string {
  if (APP_FONT) return APP_FONT;
  if (typeof document === "undefined") return "system-ui, sans-serif";
  APP_FONT = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  return APP_FONT;
}

export function EChart({ option, height = 300, className }: EChartProps) {
  // Memoizado por referencia de `option`: con notMerge, un objeto nuevo por
  // render dispararía setOption y reiniciaría las animaciones de entrada.
  const merged = useMemo<EChartsOption>(
    () => ({ textStyle: { fontFamily: appFont() }, ...option }),
    [option],
  );
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={merged}
      style={{ height, width: "100%" }}
      opts={{ renderer: "svg" }}
      notMerge
      lazyUpdate
      className={className}
    />
  );
}
