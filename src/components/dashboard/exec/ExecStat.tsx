import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { useCountUp, useMounted, useSvgId } from "./execUtils";

/**
 * ExecSpark — sparkline con trazo de gradiente + área, dibujo animado.
 * Recreación del componente del handoff v2 (`views/exec-charts.jsx`).
 */
export function ExecSpark({
  data,
  color,
  w = 116,
  h = 40,
  period,
}: {
  data: number[];
  color: string;
  w?: number;
  h?: number;
  period?: string;
}) {
  const mounted = useMounted([period]);
  const id = useSvgId("sp");
  const { line, area, len } = useMemo(() => {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => [
      (i / (data.length - 1)) * w,
      h - 4 - ((v - min) / range) * (h - 10),
    ]);
    const line = pts
      .map((p, i) => `${i ? "L" : "M"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
      .join(" ");
    const area = `${line} L ${w} ${h} L 0 ${h} Z`;
    return { line, area, len: w * 1.6 };
  }, [data, w, h]);

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ overflow: "visible" }}
      aria-hidden
    >
      <defs>
        <linearGradient id={id + "l"} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.5" />
          <stop offset="100%" stopColor={color} />
        </linearGradient>
        <linearGradient id={id + "a"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={area}
        fill={`url(#${id}a)`}
        style={{ opacity: mounted ? 1 : 0, transition: "opacity 0.7s 0.2s" }}
      />
      <path
        d={line}
        fill="none"
        stroke={`url(#${id}l)`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: len,
          strokeDashoffset: mounted ? 0 : len,
          transition: "stroke-dashoffset 0.9s cubic-bezier(0.3,0.7,0.2,1)",
        }}
      />
    </svg>
  );
}

export interface ExecStatProps {
  label: string;
  icon?: LucideIcon;
  accent: string;
  value: number;
  unit?: string;
  decimals?: number;
  prefix?: string;
  formatter?: (n: number) => string;
  delta?: number | null;
  deltaSuffix?: string;
  spark?: number[];
  sparkColor?: string;
  note?: string;
  /** Key para re-disparar el count-up al cambiar de período. */
  period?: string;
  /** Índice para el stagger de entrada. */
  index?: number;
  onClick?: () => void;
}

/**
 * ExecStat — tile KPI premium: icono + label uppercase, valor grande con
 * count-up, delta semántico o nota, y sparkline opcional. Hover-lift + radial
 * accent vía `.exec-stat` (exec.css).
 */
export function ExecStat({
  label,
  icon: Icn,
  accent,
  value,
  unit,
  decimals = 0,
  prefix = "",
  formatter,
  delta,
  deltaSuffix = "vs período anterior",
  spark,
  sparkColor,
  note,
  period,
  index = 0,
  onClick,
}: ExecStatProps) {
  const display = useCountUp(value, { deps: [period], decimals });
  const fmt = (n: number) =>
    formatter
      ? formatter(n)
      : prefix +
        n.toLocaleString("es-PE", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
  const deltaCls =
    delta == null
      ? ""
      : delta > 0
        ? "exec-delta--up"
        : delta < 0
          ? "exec-delta--down"
          : "exec-delta--flat";

  return (
    <button
      type="button"
      className="exec-stat exec-anim"
      style={
        {
          "--stat-accent": accent,
          animationDelay: `${index * 55}ms`,
        } as React.CSSProperties
      }
      onClick={onClick}
    >
      <div className="exec-stat__label">
        {Icn && <Icn className="exec-stat__icon" />}
        {label}
      </div>
      <div className="exec-stat__value">
        {fmt(display)}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="exec-stat__foot">
        {delta != null ? (
          <span className={`exec-delta ${deltaCls}`}>
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "■"} {delta > 0 ? "+" : ""}
            {delta}{" "}
            <span style={{ color: "var(--e-t3)", fontWeight: 400 }}>
              {deltaSuffix}
            </span>
          </span>
        ) : note ? (
          <span className="exec-stat__note">{note}</span>
        ) : (
          <span />
        )}
        {spark && (
          <ExecSpark
            data={spark}
            color={sparkColor || accent}
            period={period}
            w={92}
            h={32}
          />
        )}
      </div>
    </button>
  );
}
