import { useMemo, type CSSProperties } from "react";
import type { EChartsOption } from "echarts";
import { PageHeader } from "@/components/vox/PageHeader";
import { EChart, useChartTokens } from "@/components/charts/EChart";

/**
 * ChartsLabPage — a showcase of "premium" interactive charts built with Apache
 * ECharts (SVG renderer, theme-aware), inspired by the Freepik infographic
 * reference. Data here is representative (clearly a lab) so we can judge the
 * visual quality before wiring these chart types into real pages.
 *
 * Route: /charts-lab
 */

const cardStyle: CSSProperties = {
  padding: 18,
  borderRadius: 14,
  background: "var(--bg-2)",
  border: "1px solid var(--border-1)",
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
};
const labelStyle: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "var(--text-3)",
  fontWeight: 700,
};
const captionStyle: CSSProperties = {
  fontSize: 11.5,
  color: "var(--text-3)",
  marginTop: 2,
};

/** rgba helper from #rrggbb + alpha. */
function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3 ? h.split("").map((c) => c + c).join("") : h,
    16
  );
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function ChartCard({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <div style={labelStyle}>{title}</div>
        <span style={{ ...captionStyle, marginLeft: "auto" }}>{caption}</span>
      </div>
      {children}
    </div>
  );
}

export function ChartsLabPage() {
  const t = useChartTokens();
  const [teal, emerald, lime, orange, cyan, amber] = t.palette;

  const tooltip = useMemo(
    () => ({
      backgroundColor: t.bg1,
      borderColor: t.border,
      borderWidth: 1,
      textStyle: { color: t.text1, fontSize: 12 },
      extraCssText: "border-radius:8px; box-shadow:0 8px 24px -8px rgba(0,0,0,0.5);",
    }),
    [t]
  );

  /* 1 — Multi-radius donut (nightingale / roseType) — "Contactos por cola" */
  const donut: EChartsOption = useMemo(() => {
    const data = [
      { name: "UDEP-Pregrado", value: 78 },
      { name: "UDEP-Posgrado", value: 41 },
      { name: "UDEP-Alumnos", value: 33 },
      { name: "UDEP-Diplomados", value: 20 },
      { name: "Gerencia", value: 12 },
    ];
    return {
      tooltip: { ...tooltip, trigger: "item", formatter: "{b}<br/><b>{c}</b> ({d}%)" },
      legend: {
        bottom: 0,
        textStyle: { color: t.text2, fontSize: 11 },
        icon: "circle",
        itemWidth: 9,
        itemHeight: 9,
      },
      series: [
        {
          type: "pie",
          radius: ["38%", "78%"],
          center: ["50%", "46%"],
          roseType: "radius",
          itemStyle: { borderColor: t.bg2, borderWidth: 2 },
          label: { color: t.text2, fontSize: 11, formatter: "{d}%" },
          labelLine: { lineStyle: { color: t.border } },
          data: data.map((d, i) => ({
            ...d,
            itemStyle: { color: t.palette[i] },
          })),
        },
      ],
    };
  }, [t, tooltip]);

  /* 2 — Comparative stacked area + numbered pins (01–04) */
  const area: EChartsOption = useMemo(() => {
    const days = ["20/5", "21/5", "22/5", "23/5", "24/5", "25/5", "26/5", "27/5", "28/5", "29/5", "30/5"];
    const actual = [128, 184, 64, 96, 150, 88, 58, 92, 112, 142, 96];
    const prev = [102, 110, 78, 44, 70, 62, 84, 120, 146, 158, 40];
    // 4 numbered pins at notable peaks of the "actual" series
    const pins = [1, 4, 9, 10].map((idx, i) => ({
      name: `pin-${i + 1}`,
      coord: [idx, actual[idx]],
      value: String(i + 1).padStart(2, "0"),
    }));
    return {
      tooltip: { ...tooltip, trigger: "axis" },
      legend: {
        top: 0,
        right: 0,
        data: ["Período actual", "Período anterior"],
        textStyle: { color: t.text2, fontSize: 11 },
        icon: "roundRect",
        itemWidth: 12,
        itemHeight: 8,
      },
      grid: { left: 36, right: 14, top: 30, bottom: 24 },
      xAxis: {
        type: "category",
        data: days,
        boundaryGap: false,
        axisLine: { lineStyle: { color: t.border } },
        axisLabel: { color: t.text3, fontSize: 10 },
        axisTick: { show: false },
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
          smooth: false,
          symbol: "none",
          lineStyle: { width: 2, color: emerald },
          areaStyle: { color: rgba(emerald, 0.5) },
          data: prev,
        },
        {
          name: "Período actual",
          type: "line",
          smooth: false,
          symbol: "none",
          lineStyle: { width: 2, color: orange },
          areaStyle: { color: rgba(orange, 0.6) },
          data: actual,
          markPoint: {
            symbol: "circle",
            symbolSize: 26,
            itemStyle: { color: orange, borderColor: t.bg2, borderWidth: 2 },
            label: { color: "#fff", fontSize: 11, fontWeight: 700 },
            data: pins,
          },
        },
      ],
    };
  }, [t, tooltip, emerald, orange]);

  /* 3 — Gradient "mountain" peaks (pictorialBar triangles) */
  const mountains: EChartsOption = useMemo(() => {
    const cats = ["Voz", "WhatsApp", "Chat", "Email"];
    const vals = [80, 62, 50, 40];
    const colors = [teal, emerald, lime, orange];
    return {
      tooltip: { ...tooltip, trigger: "item", formatter: "{b}: <b>{c}%</b>" },
      grid: { left: 10, right: 10, top: 30, bottom: 24 },
      xAxis: {
        type: "category",
        data: cats,
        axisLine: { lineStyle: { color: t.border } },
        axisLabel: { color: t.text3, fontSize: 11 },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        max: 100,
        splitLine: { lineStyle: { color: t.border, type: "dashed" } },
        axisLabel: { color: t.text3, fontSize: 10, formatter: "{value}%" },
      },
      series: [
        {
          type: "pictorialBar",
          symbol: "triangle",
          // Overlap the peaks a bit (negative category gap) so the silhouette
          // reads as a mountain range; each tip height = its volume.
          barCategoryGap: "-22%",
          z: 2,
          label: {
            show: true,
            position: "top",
            color: t.text2,
            fontWeight: 700,
            fontSize: 11,
            formatter: "{c}%",
          },
          data: vals.map((v, i) => ({
            value: v,
            // thin separator border so overlapping triangles stay legible
            itemStyle: { color: colors[i], borderColor: t.bg2, borderWidth: 1 },
          })),
        },
      ],
    };
  }, [t, tooltip, teal, emerald, lime, orange]);

  /* 4 — Native ECharts gauge (CSAT) */
  const gauge: EChartsOption = useMemo(
    () => ({
      series: [
        {
          type: "gauge",
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max: 100,
          progress: {
            show: true,
            width: 18,
            roundCap: false,
            itemStyle: { color: emerald },
          },
          axisLine: { lineStyle: { width: 18, color: [[1, t.border]] } },
          pointer: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          anchor: { show: false },
          title: { show: false },
          detail: {
            valueAnimation: true,
            offsetCenter: [0, 0],
            fontSize: 38,
            fontWeight: 800,
            color: emerald,
            formatter: "{value}%",
          },
          data: [{ value: 88 }],
        },
      ],
    }),
    [t, lime, emerald]
  );

  /* 5 — Flat slider bars with a numbered ring-cap at the end (the "01–04"
     sliders from the reference): square corners, solid color, no gradient. */
  const ribbons: EChartsOption = useMemo(() => {
    const cats = ["Retención", "Soporte L2", "Ventas", "Cobranza", "Soporte L1"];
    const vals = [94, 91, 89, 82, 76];
    const colors = [emerald, teal, lime, amber, orange];
    return {
      tooltip: { ...tooltip, trigger: "item", formatter: "{b}: <b>{c}</b>" },
      grid: { left: 92, right: 44, top: 10, bottom: 6 },
      xAxis: {
        type: "value",
        max: 105,
        splitLine: { show: false },
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: cats,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: t.text2, fontSize: 12 },
      },
      series: [
        {
          // flat square track + fill
          type: "bar",
          barWidth: 12,
          showBackground: true,
          backgroundStyle: { color: t.border },
          itemStyle: { color: "#0000" },
          data: vals.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })),
          z: 1,
        },
        {
          // numbered ring-cap badge at the end of each bar
          type: "scatter",
          symbol: "circle",
          symbolSize: 26,
          data: vals.map((v, i) => ({
            value: [v, i],
            itemStyle: { color: t.bg2, borderColor: colors[i], borderWidth: 2.5 },
            label: {
              show: true,
              formatter: String(i + 1).padStart(2, "0"),
              color: colors[i],
              fontSize: 11,
              fontWeight: 700,
            },
          })),
          labelLayout: { hideOverlap: false },
          z: 3,
        },
      ],
    };
  }, [t, tooltip, teal, emerald, lime, amber, orange]);

  /* 6 — Waterfall (running balance with +/- bars) */
  const waterfall: EChartsOption = useMemo(() => {
    const cats = ["Inicial", "Nuevos", "Resueltos", "Reabiertos", "Escalados", "Final"];
    const deltas = [120, 60, -90, 25, -40, 0];
    // invisible base so floating bars start at the running total
    const base: number[] = [];
    const pos: (number | "-")[] = [];
    const neg: (number | "-")[] = [];
    let run = 0;
    deltas.forEach((d, i) => {
      const isTotal = i === 0 || i === deltas.length - 1;
      if (isTotal) {
        base.push(0);
        const total = i === 0 ? d : run;
        pos.push(total);
        neg.push("-");
      } else {
        if (d >= 0) {
          base.push(run);
          pos.push(d);
          neg.push("-");
        } else {
          base.push(run + d);
          pos.push("-");
          neg.push(-d);
        }
        run += d;
      }
      if (i === 0) run = d;
    });
    return {
      tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 36, right: 14, top: 16, bottom: 24 },
      xAxis: {
        type: "category",
        data: cats,
        axisLine: { lineStyle: { color: t.border } },
        axisLabel: { color: t.text3, fontSize: 10 },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: t.border, type: "dashed" } },
        axisLabel: { color: t.text3, fontSize: 10 },
      },
      series: [
        { type: "bar", stack: "wf", barWidth: 30, barCategoryGap: "46%", itemStyle: { color: "transparent" }, emphasis: { itemStyle: { color: "transparent" } }, data: base },
        { type: "bar", stack: "wf", barWidth: 30, itemStyle: { color: teal }, data: pos, label: { show: true, position: "top", color: t.text2, fontSize: 10 } },
        { type: "bar", stack: "wf", barWidth: 30, itemStyle: { color: orange }, data: neg, label: { show: true, position: "bottom", color: t.text2, fontSize: 10 } },
      ],
    };
  }, [t, tooltip, teal, orange]);

  /* 7 — Tornado / diverging bars (promotores vs detractores) */
  const tornado: EChartsOption = useMemo(() => {
    const cats = ["Retención", "Ventas", "Soporte L1", "Soporte L2", "Cobranza"];
    const promot = [62, 54, 38, 47, 29];
    const detract = [-12, -18, -33, -21, -40];
    return {
      tooltip: {
        ...tooltip,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (p: unknown) => {
          const arr = p as { name: string; seriesName: string; value: number }[];
          return `${arr[0].name}<br/>` + arr.map((s) => `${s.seriesName}: <b>${Math.abs(s.value)}%</b>`).join("<br/>");
        },
      },
      legend: { top: 0, textStyle: { color: t.text2, fontSize: 11 }, icon: "rect", itemWidth: 11, itemHeight: 9 },
      grid: { left: 76, right: 24, top: 30, bottom: 16 },
      xAxis: {
        type: "value",
        axisLabel: { color: t.text3, fontSize: 10, formatter: (v: number) => `${Math.abs(v)}` },
        splitLine: { lineStyle: { color: t.border, type: "dashed" } },
      },
      yAxis: {
        type: "category",
        data: cats,
        inverse: true,
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.text2, fontSize: 11 },
      },
      series: [
        { name: "Promotores", type: "bar", stack: "t", itemStyle: { color: emerald }, data: promot },
        { name: "Detractores", type: "bar", stack: "t", itemStyle: { color: orange }, data: detract },
      ],
    };
  }, [t, tooltip, emerald, orange]);

  /* 8 — Bubble scatter (esfuerzo vs satisfacción, tamaño = volumen) */
  const bubbles: EChartsOption = useMemo(() => {
    // [x effort, y csat, size volume, name]
    const groups: { name: string; color: string; pts: [number, number, number][] }[] = [
      { name: "Voz", color: teal, pts: [[3, 88, 40], [5, 72, 24], [2, 91, 30]] },
      { name: "WhatsApp", color: emerald, pts: [[2, 94, 52], [4, 80, 28], [3, 86, 36]] },
      { name: "Chat", color: lime, pts: [[4, 78, 22], [6, 65, 18], [3, 83, 26]] },
      { name: "Email", color: orange, pts: [[7, 60, 16], [5, 70, 20], [8, 55, 14]] },
    ];
    return {
      tooltip: { ...tooltip, trigger: "item", formatter: (p: unknown) => {
        const d = p as { seriesName: string; value: number[] };
        return `${d.seriesName}<br/>Esfuerzo: <b>${d.value[0]}</b> · CSAT: <b>${d.value[1]}%</b><br/>Volumen: <b>${d.value[2]}</b>`;
      } },
      legend: { top: 0, textStyle: { color: t.text2, fontSize: 11 }, icon: "circle", itemWidth: 9, itemHeight: 9 },
      grid: { left: 36, right: 16, top: 30, bottom: 30 },
      xAxis: { type: "value", name: "Esfuerzo", nameTextStyle: { color: t.text3, fontSize: 10 }, min: 0, max: 10, splitLine: { lineStyle: { color: t.border, type: "dashed" } }, axisLabel: { color: t.text3, fontSize: 10 }, axisLine: { lineStyle: { color: t.border } } },
      yAxis: { type: "value", name: "CSAT %", nameTextStyle: { color: t.text3, fontSize: 10 }, min: 40, max: 100, splitLine: { lineStyle: { color: t.border, type: "dashed" } }, axisLabel: { color: t.text3, fontSize: 10 } },
      series: groups.map((g) => ({
        name: g.name,
        type: "scatter",
        symbolSize: (d: number[]) => d[2],
        itemStyle: { color: rgba(g.color, 0.7), borderColor: g.color, borderWidth: 1.5 },
        data: g.pts,
      })),
    };
  }, [t, tooltip, teal, emerald, lime, orange]);

  /* 9 — Multi-line with markers (tendencia por canal) */
  const multiLine: EChartsOption = useMemo(() => {
    const days = ["L", "M", "M", "J", "V", "S", "D"];
    const series = [
      { name: "Voz", color: teal, data: [42, 50, 38, 55, 60, 30, 18] },
      { name: "WhatsApp", color: emerald, data: [30, 45, 52, 48, 66, 40, 28] },
      { name: "Chat", color: orange, data: [20, 26, 22, 30, 34, 18, 12] },
    ];
    return {
      tooltip: { ...tooltip, trigger: "axis" },
      legend: { top: 0, textStyle: { color: t.text2, fontSize: 11 }, icon: "roundRect", itemWidth: 12, itemHeight: 8 },
      grid: { left: 32, right: 14, top: 30, bottom: 24 },
      xAxis: { type: "category", data: days, boundaryGap: false, axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.text3, fontSize: 10 }, axisTick: { show: false } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: t.border, type: "dashed" } }, axisLabel: { color: t.text3, fontSize: 10 } },
      series: series.map((s) => ({
        name: s.name,
        type: "line",
        smooth: false,
        symbol: "circle",
        symbolSize: 7,
        lineStyle: { width: 2, color: s.color },
        itemStyle: { color: s.color, borderColor: t.bg2, borderWidth: 1.5 },
        data: s.data,
      })),
    };
  }, [t, tooltip, teal, emerald, orange]);

  /* 10 — Radar / spider (perfil del equipo) */
  const radar: EChartsOption = useMemo(() => ({
    tooltip: { ...tooltip, trigger: "item" },
    legend: { bottom: 0, textStyle: { color: t.text2, fontSize: 11 }, icon: "roundRect", itemWidth: 12, itemHeight: 8 },
    radar: {
      indicator: [
        { name: "CSAT", max: 100 },
        { name: "FCR", max: 100 },
        { name: "Adherencia", max: 100 },
        { name: "QA", max: 100 },
        { name: "Velocidad", max: 100 },
        { name: "Resolución", max: 100 },
      ],
      axisName: { color: t.text3, fontSize: 10 },
      splitLine: { lineStyle: { color: t.border } },
      splitArea: { areaStyle: { color: ["transparent", rgba(t.text3, 0.04)] } },
      axisLine: { lineStyle: { color: t.border } },
    },
    series: [
      {
        type: "radar",
        symbol: "circle",
        symbolSize: 5,
        data: [
          { value: [88, 86, 98, 92, 75, 90], name: "Equipo A", lineStyle: { color: emerald, width: 2 }, itemStyle: { color: emerald }, areaStyle: { color: rgba(emerald, 0.35) } },
          { value: [72, 70, 84, 78, 88, 68], name: "Equipo B", lineStyle: { color: orange, width: 2 }, itemStyle: { color: orange }, areaStyle: { color: rgba(orange, 0.3) } },
        ],
      },
    ],
  }), [t, tooltip, emerald, orange]);

  /* 11 — Dot-matrix (waffle 10x10 = share of channels) */
  const dotMatrix: EChartsOption = useMemo(() => {
    // distribute 100 dots across channels by share
    const shares = [
      { name: "Voz", value: 38, color: teal },
      { name: "WhatsApp", value: 30, color: emerald },
      { name: "Chat", value: 18, color: lime },
      { name: "Email", value: 14, color: orange },
    ];
    const cells: { value: [number, number]; itemStyle: { color: string }; name: string }[] = [];
    let idx = 0;
    shares.forEach((s) => {
      for (let k = 0; k < s.value; k++) {
        const col = idx % 10;
        const row = Math.floor(idx / 10);
        cells.push({ value: [col, 9 - row], itemStyle: { color: s.color }, name: s.name });
        idx++;
      }
    });
    return {
      tooltip: { ...tooltip, trigger: "item", formatter: (p: unknown) => (p as { name: string }).name },
      legend: { bottom: 0, data: shares.map((s) => s.name), textStyle: { color: t.text2, fontSize: 11 }, icon: "circle", itemWidth: 9, itemHeight: 9 },
      grid: { left: 6, right: 6, top: 6, bottom: 30 },
      xAxis: { type: "value", min: -0.5, max: 9.5, show: false },
      yAxis: { type: "value", min: -0.5, max: 9.5, show: false },
      series: [
        ...shares.map((s) => ({ name: s.name, type: "scatter" as const, data: [], itemStyle: { color: s.color } })),
        {
          type: "scatter",
          symbol: "rect",
          symbolSize: 14,
          data: cells,
          silent: false,
        },
      ],
    };
  }, [t, tooltip, teal, emerald, lime, orange]);

  /* 12 — Funnel (embudo de leads con %) */
  const funnel: EChartsOption = useMemo(() => {
    const data = [
      { name: "Contactado", value: 100 },
      { name: "Interesado", value: 66 },
      { name: "Negociando", value: 38 },
      { name: "Cerrando", value: 19 },
      { name: "Inscrito", value: 11 },
    ];
    return {
      tooltip: { ...tooltip, trigger: "item", formatter: "{b}: <b>{c}%</b>" },
      series: [
        {
          type: "funnel",
          left: 10,
          right: 10,
          top: 10,
          bottom: 10,
          gap: 2,
          label: { show: true, position: "inside", color: "#fff", fontSize: 11, fontWeight: 600, formatter: "{b} · {c}%" },
          itemStyle: { borderWidth: 0 },
          data: data.map((d, i) => ({ ...d, itemStyle: { color: t.palette[i] } })),
        },
      ],
    };
  }, [t, tooltip]);

  /* 13 — Concentric progress rings (full circle, multi-ring) */
  const rings: EChartsOption = useMemo(() => {
    const data = [
      { name: "Voz", value: 78, color: orange },
      { name: "WhatsApp", value: 62, color: teal },
      { name: "Chat", value: 45, color: emerald },
      { name: "Email", value: 30, color: lime },
    ];
    return {
      tooltip: { ...tooltip, trigger: "item", formatter: (p: unknown) => {
        const d = p as { seriesName: string; value: number; dataIndex: number };
        return d.dataIndex === 0 ? `${d.seriesName}: <b>${d.value}%</b>` : "";
      } },
      legend: { bottom: 0, data: data.map((d) => d.name), textStyle: { color: t.text2, fontSize: 11 }, icon: "circle", itemWidth: 9, itemHeight: 9 },
      series: data.map((r, i) => {
        const outer = 88 - i * 17;
        const inner = outer - 12;
        return {
          name: r.name,
          type: "pie",
          radius: [`${inner}%`, `${outer}%`],
          center: ["50%", "46%"],
          startAngle: 90,
          silent: false,
          label: { show: false },
          labelLine: { show: false },
          data: [
            { value: r.value, name: r.name, itemStyle: { color: r.color } },
            { value: 100 - r.value, name: "", itemStyle: { color: t.border }, tooltip: { show: false }, emphasis: { disabled: true } },
          ],
        };
      }),
    };
  }, [t, tooltip, orange, teal, emerald, lime]);

  /* 14 — Concentric arcs (half circle, gauge rings) */
  const halfRings: EChartsOption = useMemo(() => {
    const data = [
      { name: "Pregrado", value: 82, color: orange },
      { name: "Posgrado", value: 64, color: teal },
      { name: "Diplomados", value: 47, color: emerald },
    ];
    return {
      tooltip: { ...tooltip, trigger: "item", formatter: (p: unknown) => {
        const d = p as { seriesName: string; value: number };
        return `${d.seriesName}: <b>${d.value}%</b>`;
      } },
      legend: { bottom: 0, data: data.map((d) => d.name), textStyle: { color: t.text2, fontSize: 11 }, icon: "roundRect", itemWidth: 12, itemHeight: 8 },
      series: data.map((r, i) => ({
        name: r.name,
        type: "gauge",
        startAngle: 180,
        endAngle: 0,
        min: 0,
        max: 100,
        radius: `${92 - i * 20}%`,
        center: ["50%", "72%"],
        progress: { show: true, width: 11, roundCap: false, itemStyle: { color: r.color } },
        axisLine: { lineStyle: { width: 11, color: [[1, t.border]] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: { show: false },
        title: { show: false },
        detail: { show: false },
        data: [{ value: r.value }],
      })),
    };
  }, [t, tooltip, orange, teal, emerald]);

  /* 15 — Stacked vertical bars (volumen por canal apilado) */
  const stacked: EChartsOption = useMemo(() => {
    const days = ["Lun", "Mar", "Mié", "Jue", "Vie"];
    const series = [
      { name: "Voz", color: teal, data: [14, 18, 12, 20, 9] },
      { name: "WhatsApp", color: emerald, data: [22, 25, 30, 28, 33] },
      { name: "Chat", color: lime, data: [6, 9, 7, 11, 5] },
      { name: "Email", color: orange, data: [3, 2, 4, 3, 6] },
    ];
    return {
      tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, textStyle: { color: t.text2, fontSize: 11 }, icon: "rect", itemWidth: 11, itemHeight: 9 },
      grid: { left: 32, right: 14, top: 30, bottom: 24 },
      xAxis: { type: "category", data: days, axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.text3, fontSize: 10 }, axisTick: { show: false } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: t.border, type: "dashed" } }, axisLabel: { color: t.text3, fontSize: 10 } },
      series: series.map((s) => ({
        name: s.name,
        type: "bar",
        stack: "ch",
        barWidth: 26,
        barCategoryGap: "46%",
        itemStyle: { color: s.color },
        data: s.data,
      })),
    };
  }, [t, tooltip, teal, emerald, lime, orange]);

  /* 16 — Exploded pie (distribución, una porción separada) */
  const pie: EChartsOption = useMemo(() => {
    const data = [
      { name: "Voz", value: 38 },
      { name: "WhatsApp", value: 30 },
      { name: "Chat", value: 18 },
      { name: "Email", value: 14 },
    ];
    return {
      tooltip: { ...tooltip, trigger: "item", formatter: "{b}: <b>{c}</b> ({d}%)" },
      legend: { bottom: 0, textStyle: { color: t.text2, fontSize: 11 }, icon: "circle", itemWidth: 9, itemHeight: 9 },
      series: [
        {
          type: "pie",
          radius: "68%",
          center: ["50%", "46%"],
          selectedMode: "single",
          selectedOffset: 14,
          itemStyle: { borderColor: t.bg2, borderWidth: 2 },
          label: { color: t.text2, fontSize: 11, formatter: "{d}%" },
          labelLine: { lineStyle: { color: t.border } },
          data: data.map((d, i) => ({
            ...d,
            selected: i === 0,
            itemStyle: { color: t.palette[i] },
          })),
        },
      ],
    };
  }, [t, tooltip]);

  /* 17 — Simple vertical bars (llamadas por día) */
  const vBars: EChartsOption = useMemo(() => {
    const days = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const vals = [42, 38, 55, 49, 63, 24];
    const colors = [teal, emerald, lime, amber, orange, cyan];
    return {
      tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 32, right: 14, top: 20, bottom: 24 },
      xAxis: { type: "category", data: days, axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.text3, fontSize: 10 }, axisTick: { show: false } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: t.border, type: "dashed" } }, axisLabel: { color: t.text3, fontSize: 10 } },
      series: [
        {
          type: "bar",
          barWidth: 22,
          barCategoryGap: "42%",
          label: { show: true, position: "top", color: t.text2, fontSize: 10 },
          data: vals.map((v, i) => ({ value: v, itemStyle: { color: colors[i % colors.length] } })),
        },
      ],
    };
  }, [t, tooltip, teal, emerald, lime, amber, orange, cyan]);

  /* 18 — Horizontal bars, descending (top motivos de contacto) */
  const hBars: EChartsOption = useMemo(() => {
    const rows = [
      { name: "Consulta de saldo", value: 84 },
      { name: "Cambio de plan", value: 67 },
      { name: "Reclamo facturación", value: 53 },
      { name: "Soporte técnico", value: 41 },
      { name: "Cancelación", value: 28 },
    ];
    const colors = [orange, amber, lime, emerald, teal];
    return {
      tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 130, right: 30, top: 8, bottom: 8 },
      xAxis: { type: "value", splitLine: { lineStyle: { color: t.border, type: "dashed" } }, axisLabel: { color: t.text3, fontSize: 10 } },
      yAxis: {
        type: "category",
        inverse: true,
        data: rows.map((r) => r.name),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.text2, fontSize: 11 },
      },
      series: [
        {
          type: "bar",
          barWidth: 14,
          label: { show: true, position: "right", color: t.text1, fontSize: 11, fontWeight: 700 },
          data: rows.map((r, i) => ({ value: r.value, itemStyle: { color: colors[i % colors.length] } })),
        },
      ],
    };
  }, [t, tooltip, teal, emerald, lime, amber, orange]);

  /* 19 — Grouped/clustered vertical bars (multi-series side by side) */
  const groupedBars: EChartsOption = useMemo(() => {
    const days = ["Lun", "Mar", "Mié", "Jue", "Vie"];
    const series = [
      { name: "Voz", color: teal, data: [40, 32, 48, 38, 55] },
      { name: "WhatsApp", color: lime, data: [52, 60, 45, 58, 66] },
      { name: "Chat", color: cyan, data: [22, 28, 30, 25, 33] },
    ];
    return {
      tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, textStyle: { color: t.text2, fontSize: 11 }, icon: "rect", itemWidth: 11, itemHeight: 9 },
      grid: { left: 32, right: 14, top: 30, bottom: 24 },
      xAxis: { type: "category", data: days, axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.text3, fontSize: 10 }, axisTick: { show: false } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: t.border, type: "dashed" } }, axisLabel: { color: t.text3, fontSize: 10 } },
      series: series.map((s) => ({
        name: s.name,
        type: "bar",
        // tight clusters: small gap within a group, generous gap between days
        barGap: "8%",
        barCategoryGap: "44%",
        barWidth: 14,
        itemStyle: { color: s.color },
        data: s.data,
      })),
    };
  }, [t, tooltip, teal, lime, cyan]);

  /* 20 — Lollipop columns: thin bars with a numbered ring-cap showing % */
  const lollipops: EChartsOption = useMemo(() => {
    const cats = ["Q ATA", "Q INFO", "Q VENT", "Q SOP", "Q COBR"];
    const vals = [20, 40, 50, 80, 80];
    const colors = [teal, cyan, lime, emerald, orange];
    return {
      tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p: unknown) => {
        const a = p as { name: string; value: number }[];
        return `${a[0].name}: <b>${a[0].value}%</b>`;
      } },
      grid: { left: 30, right: 16, top: 30, bottom: 24 },
      xAxis: { type: "category", data: cats, axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.text3, fontSize: 10 }, axisTick: { show: false } },
      yAxis: { type: "value", max: 100, splitLine: { lineStyle: { color: t.border, type: "dashed" } }, axisLabel: { color: t.text3, fontSize: 10, formatter: "{value}%" } },
      series: [
        {
          // thin stick
          type: "bar",
          barWidth: 4,
          z: 1,
          data: vals.map((v, i) => ({ value: v, itemStyle: { color: colors[i] } })),
        },
        {
          // ring-cap with % label at the top of each stick
          type: "scatter",
          symbol: "circle",
          symbolSize: 30,
          z: 3,
          data: vals.map((v, i) => ({
            value: [i, v],
            itemStyle: { color: t.bg2, borderColor: colors[i], borderWidth: 2.5 },
            label: { show: true, formatter: `${v}%`, color: colors[i], fontSize: 10, fontWeight: 700 },
          })),
        },
      ],
    };
  }, [t, tooltip, teal, cyan, lime, emerald, orange]);

  /* 21 — Combo: bars (volumen) + line (SLA %) on a dual axis */
  const combo: EChartsOption = useMemo(() => {
    const days = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const volume = [320, 280, 410, 360, 480, 190];
    const sla = [92, 88, 79, 84, 73, 95];
    return {
      tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "cross", crossStyle: { color: t.border } } },
      legend: { top: 0, data: ["Volumen", "SLA %"], textStyle: { color: t.text2, fontSize: 11 }, icon: "roundRect", itemWidth: 12, itemHeight: 8 },
      grid: { left: 40, right: 40, top: 30, bottom: 24 },
      xAxis: { type: "category", data: days, axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.text3, fontSize: 10 }, axisTick: { show: false } },
      yAxis: [
        { type: "value", name: "Vol", nameTextStyle: { color: t.text3, fontSize: 10 }, splitLine: { lineStyle: { color: t.border, type: "dashed" } }, axisLabel: { color: t.text3, fontSize: 10 } },
        { type: "value", name: "SLA", min: 0, max: 100, position: "right", splitLine: { show: false }, axisLabel: { color: t.text3, fontSize: 10, formatter: "{value}%" } },
      ],
      series: [
        { name: "Volumen", type: "bar", barWidth: "46%", itemStyle: { color: cyan }, data: volume },
        { name: "SLA %", type: "line", yAxisIndex: 1, smooth: false, symbol: "circle", symbolSize: 7, lineStyle: { width: 2, color: orange }, itemStyle: { color: orange, borderColor: t.bg2, borderWidth: 1.5 }, data: sla },
      ],
    };
  }, [t, tooltip, cyan, orange]);

  /* 22 — Pyramid (hierarchy with %) — funnel sorted ascending = pyramid */
  const pyramid: EChartsOption = useMemo(() => {
    const data = [
      { name: "Champions", value: 10 },
      { name: "Leales", value: 30 },
      { name: "Potenciales", value: 50 },
      { name: "Nuevos", value: 100 },
    ];
    const colors = [emerald, cyan, teal, lime];
    return {
      tooltip: { ...tooltip, trigger: "item", formatter: "{b}: <b>{c}%</b>" },
      series: [
        {
          type: "funnel",
          sort: "ascending", // widest at the bottom → pyramid
          left: 10,
          right: 10,
          top: 10,
          bottom: 10,
          gap: 2,
          minSize: "22%",
          label: { show: true, position: "inside", color: "#fff", fontSize: 11, fontWeight: 600, formatter: "{b} · {c}%" },
          itemStyle: { borderWidth: 0 },
          data: data.map((d, i) => ({ ...d, itemStyle: { color: colors[i] } })),
        },
      ],
    };
  }, [t, tooltip, emerald, cyan, teal, lime]);

  return (
    <div className="view">
      <PageHeader
        crumb="Laboratorio"
        title="Gráficos premium · ECharts"
        sub="22 gráficos interactivos (datos representativos) — área, donut, picos, gauge, sliders, waterfall, tornado, burbujas, multi-línea, radar, dot-matrix, embudo, anillos/arcos concéntricos, apiladas, pie, barras V/H, agrupadas, lollipop, combo y pirámide. Estilo plano y duro. Pasa el mouse para ver tooltips."
      />

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }}>
        <ChartCard title="Volumen de contactos · comparativo" caption="área + pins 01–04 · hover">
          <EChart option={area} height={320} />
        </ChartCard>
        <ChartCard title="Contactos por cola" caption="donut multi-radio (roseType)">
          <EChart option={donut} height={320} />
        </ChartCard>
      </div>

      <div style={{ height: 16 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <ChartCard title="Volumen por canal" caption="picos con gradiente (pictorialBar)">
          <EChart option={mountains} height={260} />
        </ChartCard>
        <ChartCard title="Satisfacción (CSAT)" caption="gauge nativo ECharts">
          <EChart option={gauge} height={260} />
        </ChartCard>
        <ChartCard title="Equipos por rendimiento" caption="sliders con badge numerado">
          <EChart option={ribbons} height={260} />
        </ChartCard>
      </div>

      <div style={{ height: 16 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ChartCard title="Flujo de casos" caption="waterfall (balance +/−)">
          <EChart option={waterfall} height={280} />
        </ChartCard>
        <ChartCard title="Promotores vs detractores" caption="tornado (barras divergentes)">
          <EChart option={tornado} height={280} />
        </ChartCard>
      </div>

      <div style={{ height: 16 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ChartCard title="Esfuerzo vs satisfacción" caption="bubble scatter · tamaño = volumen">
          <EChart option={bubbles} height={300} />
        </ChartCard>
        <ChartCard title="Tendencia por canal" caption="multi-línea con marcadores">
          <EChart option={multiLine} height={300} />
        </ChartCard>
      </div>

      <div style={{ height: 16 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <ChartCard title="Perfil de equipos" caption="radar / spider">
          <EChart option={radar} height={300} />
        </ChartCard>
        <ChartCard title="Distribución por canal" caption="dot-matrix (waffle 10×10)">
          <EChart option={dotMatrix} height={300} />
        </ChartCard>
        <ChartCard title="Embudo de leads" caption="funnel con %">
          <EChart option={funnel} height={300} />
        </ChartCard>
      </div>

      <div style={{ height: 16 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ChartCard title="Cumplimiento por canal" caption="anillos concéntricos (círculo completo)">
          <EChart option={rings} height={300} />
        </ChartCard>
        <ChartCard title="Avance por programa" caption="arcos concéntricos (medio círculo)">
          <EChart option={halfRings} height={300} />
        </ChartCard>
      </div>

      <div style={{ height: 16 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ChartCard title="Volumen por canal · apilado" caption="barras apiladas">
          <EChart option={stacked} height={280} />
        </ChartCard>
        <ChartCard title="Distribución de contactos" caption="pie explotado">
          <EChart option={pie} height={280} />
        </ChartCard>
      </div>

      <div style={{ height: 16 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ChartCard title="Llamadas por día" caption="barras simples">
          <EChart option={vBars} height={280} />
        </ChartCard>
        <ChartCard title="Top motivos de contacto" caption="barras horizontales descendentes">
          <EChart option={hBars} height={280} />
        </ChartCard>
      </div>

      <div style={{ height: 16 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ChartCard title="Comparativo por canal" caption="barras agrupadas (multi-serie)">
          <EChart option={groupedBars} height={280} />
        </ChartCard>
        <ChartCard title="SLA por cola" caption="lollipop con tapa-anillo %">
          <EChart option={lollipops} height={280} />
        </ChartCard>
      </div>

      <div style={{ height: 16 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }}>
        <ChartCard title="Volumen vs SLA" caption="combo barras + línea (doble eje)">
          <EChart option={combo} height={300} />
        </ChartCard>
        <ChartCard title="Segmentos de clientes" caption="pirámide con %">
          <EChart option={pyramid} height={300} />
        </ChartCard>
      </div>
    </div>
  );
}
