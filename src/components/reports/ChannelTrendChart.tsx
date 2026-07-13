import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { EChart, useChartTokens } from "@/components/charts/EChart";
import type { ExecChannelDay } from "@/components/dashboard/exec/execMock";

/**
 * ChannelTrendChart — "Volumen por canal" como ÁREA APILADA por día (antes eran
 * barras, casi idénticas al histograma de AHT de al lado). El área suave y
 * multicolor cuenta la TENDENCIA + la composición del volumen a lo largo del
 * período, y es visualmente muy distinta del histograma de distribución.
 */

const CHANNELS: {
  key: keyof Omit<ExecChannelDay, "label">;
  label: string;
  tone: keyof ReturnType<typeof useChartTokens>;
}[] = [
  { key: "voz", label: "Voz", tone: "cyan" },
  { key: "wa", label: "WhatsApp", tone: "green" },
  { key: "chat", label: "Chat", tone: "iris" },
  { key: "email", label: "Email", tone: "gold" },
  { key: "sms", label: "SMS", tone: "coral" },
];

export function ChannelTrendChart({
  data,
  height = 264,
}: {
  data: ExecChannelDay[];
  height?: number;
}) {
  const t = useChartTokens();

  const option: EChartsOption = useMemo(() => {
    const labels = data.map((d) => d.label);
    // Con pocos puntos mostramos el marcador para que un solo día no se "pierda".
    const showSymbol = data.length <= 3;
    // Solo canales con algún dato → leyenda limpia.
    const active = CHANNELS.filter((ch) => data.some((d) => (d[ch.key] as number) > 0));
    const series = (active.length ? active : CHANNELS).map((ch) => {
      const color = t[ch.tone] as string;
      return {
        name: ch.label,
        type: "line" as const,
        stack: "total",
        smooth: 0.35,
        symbol: "circle",
        symbolSize: showSymbol ? 6 : 0,
        showSymbol,
        lineStyle: { width: 1.5, color },
        itemStyle: { color },
        areaStyle: {
          color: {
            type: "linear" as const,
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `color-mix(in srgb, ${color} 55%, transparent)` },
              { offset: 1, color: `color-mix(in srgb, ${color} 6%, transparent)` },
            ],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        },
        emphasis: { focus: "series" as const },
        data: data.map((d) => d[ch.key] as number),
      };
    });

    return {
      animationDuration: 800,
      grid: { left: 34, right: 14, top: 16, bottom: 44 },
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
        backgroundColor: t.bg2,
        borderColor: t.border,
        borderWidth: 1,
        textStyle: { color: t.text1, fontSize: 12 },
        extraCssText: "border-radius:12px;",
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: labels,
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.text3, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        splitLine: { lineStyle: { color: t.border, type: "dashed" } },
        axisLabel: { color: t.text3, fontSize: 10 },
      },
      series,
    };
  }, [data, t]);

  return <EChart option={option} height={height} />;
}
