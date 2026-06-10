import type { EChartsOption } from "echarts";
import { EChart, useChartTokens } from "@/components/charts/EChart";
import { rgba } from "./execUtils";
import type { ExecChannelDay, ExecSlice, ExecTrendDay } from "./execMock";

/**
 * Charts ECharts del dashboard ejecutivo (recreación del diseño v2,
 * `views/exec-echarts.jsx`). Reusan el wrapper `EChart` (renderer SVG,
 * theme-aware) en vez de recharts → cierra el "doble motor" (brief P6) y la
 * paleta de datos (P7). Gradientes vía sintaxis-objeto de ECharts.
 */

/** Gradiente lineal vertical (claro→transparente) para áreas/barras. */
function vGrad(color: string, a0: number, a1: number) {
  return {
    type: "linear",
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: rgba(color, a0) },
      { offset: 1, color: rgba(color, a1) },
    ],
  };
}
/** Gradiente diagonal para segmentos de donut. */
function dGrad(color: string) {
  return {
    type: "linear",
    x: 0,
    y: 0,
    x2: 1,
    y2: 1,
    colorStops: [
      { offset: 0, color: rgba(color, 0.92) },
      { offset: 1, color },
    ],
  };
}

export const EXEC_CHANNEL_META: { key: keyof ExecChannelDay; label: string; color: string }[] = [
  { key: "voz", label: "Voz", color: "#15485A" },
  { key: "wa", label: "WhatsApp", color: "#2E9D8E" },
  { key: "chat", label: "Chat", color: "#92C73E" },
  { key: "email", label: "Email", color: "#F2972E" },
  { key: "sms", label: "SMS", color: "#1C97A6" },
];

/* ---------- Área comparativa (actual vs anterior) ---------- */
export function ExecAreaEChart({
  data,
  colorA = "#F2972E",
  colorB = "#2E9D8E",
  height = 282,
}: {
  data: ExecTrendDay[];
  colorA?: string;
  colorB?: string;
  height?: number;
}) {
  const t = useChartTokens();
  const tip = {
    backgroundColor: t.bg2,
    borderColor: t.border,
    borderWidth: 1,
    padding: [10, 13] as [number, number],
    textStyle: { color: t.text1, fontSize: 12, fontFamily: "inherit" },
    extraCssText: "border-radius:12px; box-shadow:0 16px 40px -12px rgba(0,0,0,0.55);",
  };
  const option: EChartsOption = {
    animationDuration: 900,
    animationEasing: "cubicOut",
    grid: { left: 38, right: 16, top: 16, bottom: 26 },
    tooltip: {
      trigger: "axis",
      ...tip,
      axisPointer: { type: "line", lineStyle: { color: t.text3, type: "dashed" } },
      formatter: (ps: unknown) => {
        const arr = ps as Array<{ seriesName: string; value: number; axisValue: string }>;
        const a = arr.find((p) => p.seriesName === "Período actual");
        const b = arr.find((p) => p.seriesName === "Período anterior");
        const va = a ? a.value : 0;
        const vb = b ? b.value : 0;
        const diff = va - vb;
        const pct = vb ? Math.round((diff / vb) * 100) : 0;
        const col = diff >= 0 ? "#2E9D8E" : "#ED5257";
        return (
          `<div style="font-size:10.5px;color:${t.text3};text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px;font-weight:600">${arr[0].axisValue}</div>` +
          `<div style="display:flex;align-items:center;gap:8px;padding:2px 0"><span style="width:9px;height:9px;border-radius:50%;background:${colorA}"></span><span style="color:${t.text2};flex:1">Período actual</span><b style="margin-left:14px">${va}</b></div>` +
          `<div style="display:flex;align-items:center;gap:8px;padding:2px 0"><span style="width:9px;height:9px;border-radius:50%;background:${colorB}"></span><span style="color:${t.text2};flex:1">Período anterior</span><b style="margin-left:14px">${vb}</b></div>` +
          `<div style="margin-top:7px;padding-top:7px;border-top:1px solid ${t.border};color:${col};font-weight:700;font-size:11.5px">${diff >= 0 ? "▲ +" : "▼ "}${diff} (${pct}%) vs anterior</div>`
        );
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: data.map((d) => d.label),
      axisLine: { lineStyle: { color: t.border } },
      axisTick: { show: false },
      axisLabel: { color: t.text3, fontSize: 10 },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: t.border, type: "dashed" } },
      axisLabel: { color: t.text3, fontSize: 10 },
    },
    series: [
      {
        name: "Período anterior",
        type: "line",
        smooth: 0.4,
        symbol: "circle",
        symbolSize: 7,
        showSymbol: false,
        data: data.map((d) => d.anterior),
        lineStyle: { width: 2.5, color: colorB },
        itemStyle: { color: colorB, borderColor: t.bg2, borderWidth: 2 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        areaStyle: { color: vGrad(colorB, 0.5, 0.02) as any },
        emphasis: { focus: "series" },
      },
      {
        name: "Período actual",
        type: "line",
        smooth: 0.4,
        symbol: "circle",
        symbolSize: 7,
        showSymbol: false,
        data: data.map((d) => d.actual),
        lineStyle: { width: 2.5, color: colorA },
        itemStyle: { color: colorA, borderColor: t.bg2, borderWidth: 2 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        areaStyle: { color: vGrad(colorA, 0.55, 0.03) as any },
        emphasis: { focus: "series" },
      },
    ],
  };
  return <EChart option={option} height={height} />;
}

/* ---------- Barras apiladas por canal ---------- */
export function ExecBarsEChart({
  data,
  height = 256,
}: {
  data: ExecChannelDay[];
  height?: number;
}) {
  const t = useChartTokens();
  const option: EChartsOption = {
    animationDuration: 800,
    grid: { left: 34, right: 12, top: 18, bottom: 26 },
    legend: {
      bottom: 0,
      itemWidth: 9,
      itemHeight: 9,
      itemGap: 16,
      textStyle: { color: t.text2, fontSize: 11 },
      icon: "roundRect",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: t.bg2,
      borderColor: t.border,
      borderWidth: 1,
      textStyle: { color: t.text1, fontSize: 12 },
      extraCssText: "border-radius:12px;",
    },
    xAxis: {
      type: "category",
      data: data.map((d) => d.label),
      axisLine: { lineStyle: { color: t.border } },
      axisTick: { show: false },
      axisLabel: { color: t.text3, fontSize: 10 },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: t.border, type: "dashed" } },
      axisLabel: { color: t.text3, fontSize: 10 },
    },
    series: EXEC_CHANNEL_META.map((ch, i) => ({
      name: ch.label,
      type: "bar",
      stack: "total",
      data: data.map((d) => (d[ch.key] as number) || 0),
      barWidth: "46%",
      itemStyle: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        color: vGrad(ch.color, 1, 0.78) as any,
        borderRadius:
          i === EXEC_CHANNEL_META.length - 1 ? ([3, 3, 0, 0] as number[]) : 0,
      },
    })),
  };
  return <EChart option={option} height={height} />;
}

/* ---------- Donut ---------- */
export function ExecDonutEChart({
  data,
  centerValue,
  centerLabel,
  height = 196,
}: {
  data: ExecSlice[];
  centerValue: number | string;
  centerLabel: string;
  height?: number;
}) {
  const t = useChartTokens();
  const option: EChartsOption = {
    animationDuration: 800,
    tooltip: {
      trigger: "item",
      backgroundColor: t.bg2,
      borderColor: t.border,
      borderWidth: 1,
      textStyle: { color: t.text1, fontSize: 12 },
      extraCssText: "border-radius:12px;",
      formatter: (p: unknown) => {
        const it = p as { name: string; value: number; percent: number };
        return `${it.name}<b style="margin-left:10px">${it.value}</b> · ${it.percent}%`;
      },
    },
    title: {
      text: String(centerValue),
      subtext: centerLabel,
      left: "center",
      top: "center",
      textStyle: { color: t.text1, fontSize: 28, fontWeight: 800, fontFamily: "inherit" },
      subtextStyle: { color: t.text3, fontSize: 10.5, fontWeight: 600 },
      itemGap: 2,
    },
    series: [
      {
        type: "pie",
        radius: ["56%", "86%"],
        center: ["50%", "50%"],
        avoidLabelOverlap: false,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderColor: t.bg1, borderWidth: 3, borderRadius: 5 },
        data: data.map((d) => ({
          name: d.name,
          value: d.value,
          itemStyle: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            color: dGrad(d.color) as any,
            shadowBlur: 8,
            shadowColor: rgba(d.color, 0.45),
          },
        })),
        emphasis: { scale: true, scaleSize: 6 },
      },
    ],
  };
  return <EChart option={option} height={height} />;
}

/* ---------- Gauge (CSAT) ---------- */
export function ExecGaugeEChart({
  value,
  color = "#2E9D8E",
  label = "satisfacción",
  height = 184,
}: {
  value: number;
  color?: string;
  label?: string;
  height?: number;
}) {
  const t = useChartTokens();
  const option: EChartsOption = {
    animationDuration: 1100,
    series: [
      {
        type: "gauge",
        startAngle: 220,
        endAngle: -40,
        min: 0,
        max: 100,
        radius: "100%",
        center: ["50%", "58%"],
        progress: {
          show: true,
          width: 16,
          roundCap: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          itemStyle: { color: { type: "linear", x: 0, y: 0, x2: 1, y2: 1, colorStops: [{ offset: 0, color: rgba(color, 0.6) }, { offset: 1, color }] } as any },
        },
        axisLine: { lineStyle: { width: 16, color: [[1, t.bg2]] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: { show: false },
        title: { show: true, offsetCenter: [0, "32%"], color: t.text3, fontSize: 10.5, fontWeight: 600 },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, "0%"],
          formatter: "{value}%",
          color: t.text1,
          fontSize: 30,
          fontWeight: 800,
          fontFamily: "inherit",
        },
        data: [{ value, name: label.toUpperCase() }],
      },
    ],
  };
  return <EChart option={option} height={height} />;
}
