import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { Activity } from "lucide-react";
import { EChart, useChartTokens } from "@/components/charts/EChart";
import { EmptyState } from "@/components/ui/empty-state";
import type { ContactRecord } from "@/types/monitoring";

/**
 * SentimentChart — barras apiladas por día × sentiment (Contact Lens), en
 * ECharts con la paleta semántica del dashboard (verde/azul/amarillo/rojo).
 * Reemplazó la versión recharts (era el ÚLTIMO uso de recharts del proyecto —
 * brief P6 cerrado). El Card lo pone la página; aquí solo el chart.
 */

const SENTIMENT_META = [
  { key: "POSITIVE", label: "Positivo", color: "#25B873" },
  { key: "NEUTRAL", label: "Neutral", color: "#6E8BFF" },
  { key: "MIXED", label: "Mixto", color: "#F5C518" },
  { key: "NEGATIVE", label: "Negativo", color: "#ED5257" },
] as const;

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function SentimentChart({ contacts }: { contacts: ContactRecord[] }) {
  const t = useChartTokens();

  const { labels, series } = useMemo(() => {
    const byDay = new Map<string, Record<string, number>>();
    for (const c of contacts) {
      const day = c.initiationTimestamp.split("T")[0];
      if (!byDay.has(day)) byDay.set(day, { POSITIVE: 0, NEUTRAL: 0, MIXED: 0, NEGATIVE: 0 });
      const s = (c.sentiment || "").toUpperCase();
      const row = byDay.get(day)!;
      if (s in row) row[s] += 1;
    }
    const days = Array.from(byDay.keys()).sort().slice(-14);
    const labels = days.map((d) => {
      const dt = new Date(d + "T00:00:00");
      return `${dt.getDate()}/${dt.getMonth() + 1}`;
    });
    const series = SENTIMENT_META.map((m) => ({
      meta: m,
      data: days.map((d) => byDay.get(d)![m.key] || 0),
    }));
    return { labels, series };
  }, [contacts]);

  const total = series.reduce((s, x) => s + x.data.reduce((a, b) => a + b, 0), 0);
  if (labels.length === 0 || total === 0) {
    return (
      <EmptyState
        icon={<Activity />}
        title="Sin datos de sentiment en el rango"
        description="Contact Lens analiza las conversaciones; ajusta el rango o espera nuevos contactos."
      />
    );
  }

  const option: EChartsOption = {
    animationDuration: 800,
    // Margen inferior amplio para que las fechas del eje X y la leyenda
    // (Positivo/Neutral/Mixto/Negativo) no se solapen.
    grid: { left: 34, right: 12, top: 18, bottom: 54 },
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
      data: labels,
      axisLine: { lineStyle: { color: t.border } },
      axisTick: { show: false },
      axisLabel: { color: t.text3, fontSize: 10 },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: t.border, type: "dashed" } },
      axisLabel: { color: t.text3, fontSize: 10 },
    },
    series: series.map((s, i) => ({
      name: s.meta.label,
      type: "bar",
      stack: "sent",
      data: s.data,
      barWidth: "46%",
      itemStyle: {
        color: {
          type: "linear",
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: rgba(s.meta.color, 1) },
            { offset: 1, color: rgba(s.meta.color, 0.78) },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        borderRadius: i === series.length - 1 ? ([3, 3, 0, 0] as number[]) : 0,
      },
    })),
  };

  return <EChart option={option} height={280} />;
}
