/* ============================================================
   ARIA · UI primitives  ·  ported from aria-ui.jsx to typed TSX
   ============================================================ */
import { useContext, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { SectionColorContext } from "./sectionColors";
import { initials } from "@/lib/initials";

/* ---- Button ---- */
type BtnVariant = "primary" | "ghost" | "subtle" | "soft" | "quiet";
type BtnSize = "sm" | "lg";
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: IconName | string;
  iconR?: IconName | string;
}
export function Btn({ variant = "ghost", size, icon, iconR, children, className = "", ...p }: BtnProps) {
  const cls = [
    "btn",
    "btn--" + variant,
    size && "btn--" + size,
    !children && icon && "btn--icon",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const isz = size === "sm" ? 15 : 17;
  return (
    <button className={cls} {...p}>
      {/* Iconos inline en peso "bold": nítidos a tamaño pequeño (3er estilo,
          junto al duotone de títulos y el fill del sidebar activo). */}
      {icon && <Icon name={icon} size={isz} weight="bold" />}
      {children}
      {iconR && <Icon name={iconR} size={isz} weight="bold" />}
    </button>
  );
}

/* ---- Tooltip ---- */
export function TT({ label, children, side }: { label: ReactNode; children: ReactNode; side?: "r" }) {
  return (
    <span className="tt">
      {children}
      <span className={"tt__bub" + (side === "r" ? " tt__bub--r" : "")}>{label}</span>
    </span>
  );
}

/* ---- Hint (coach dot with tooltip) ---- */
export function Hint({ text, pulse }: { text: ReactNode; pulse?: boolean }) {
  return (
    <span className="tt" style={{ verticalAlign: "middle" }}>
      <span className={"hint" + (pulse ? " hint--pulse" : "")}>?</span>
      <span className="tt__bub" style={{ minWidth: 180 }}>
        {text}
      </span>
    </span>
  );
}

/* ---- Pill ---- */
type PillTone = "accent" | "green" | "gold" | "red" | "coral" | "iris" | "cyan" | "outline";
interface PillProps {
  tone?: PillTone;
  icon?: IconName | string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}
export function Pill({ tone, icon, children, className = "", style }: PillProps) {
  return (
    <span className={"pill" + (tone ? " pill--" + tone : "") + " " + className} style={style}>
      {icon && <Icon name={icon} size={12} weight="bold" />}
      {children}
    </span>
  );
}

/* ---- Avatar ---- */
export function Av({
  name,
  size = 34,
  color,
  radius = 11,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  radius?: number;
  style?: CSSProperties;
}) {
  const ini = initials(name);
  return (
    <div
      className="av"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        borderRadius: radius,
        ...(color ? { background: color } : {}),
        ...style,
      }}
    >
      {ini}
    </div>
  );
}

/* ---- Card ---- */
interface CardProps {
  title?: ReactNode;
  icon?: IconName | string;
  /** Color del chip del icono de título (gradiente). Default: --accent. */
  iconColor?: string;
  extra?: ReactNode;
  accent?: string;
  children: ReactNode;
  pad?: boolean;
  className?: string;
  bodyStyle?: CSSProperties;
  style?: CSSProperties;
}
export function Card({ title, icon, iconColor, extra, accent, children, pad = true, className = "", bodyStyle, style }: CardProps) {
  // Sin iconColor explícito, el chip del título toma el color de la sección
  // activa (variedad de color por página); cae a --accent fuera del shell.
  const sectionColor = useContext(SectionColorContext);
  const chipColor = iconColor || sectionColor;
  return (
    <div
      className={"card " + (accent ? "card__accent-bar " : "") + className}
      style={{ ...(accent ? ({ "--_c": accent } as CSSProperties) : {}), ...style }}
    >
      {title && (
        <div className="card__head">
          <div className="card__title">
            {icon && (
              <span className="card__ico" style={{ ["--_c" as string]: chipColor }}>
                <Icon name={icon} size={16} />
              </span>
            )}
            {title}
          </div>
          {extra}
        </div>
      )}
      <div className={pad ? "card__pad" : ""} style={bodyStyle}>
        {children}
      </div>
    </div>
  );
}

/* ---- Stat card ---- */
interface StatProps {
  icon: IconName | string;
  color?: string;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number | null;
  deltaUp?: boolean;
}
export function Stat({ icon, color, label, value, sub, delta, deltaUp }: StatProps) {
  return (
    <div className="stat" style={color ? ({ "--_c": color } as CSSProperties) : undefined}>
      <div className="stat__top">
        <div className="stat__ico">
          <Icon name={icon} size={16} />
        </div>
        <div className="stat__label">{label}</div>
      </div>
      <div className="stat__val tnum">{value}</div>
      <div className="stat__sub">
        {delta != null && (
          <span className={"delta " + (deltaUp ? "delta--up" : "delta--down")}>
            <Icon name="trending" size={13} style={deltaUp ? undefined : { transform: "scaleY(-1)" }} />
            {delta > 0 ? "+" : ""}
            {delta}%
          </span>
        )}
        {delta != null && sub ? " " : null}
        {sub}
      </div>
    </div>
  );
}

/* ---- Donut (conic-gradient) ---- */
export interface DonutSeg {
  v: number;
  color: string;
}
export function Donut({
  segments,
  size = 150,
  thickness = 20,
  center,
}: {
  segments: DonutSeg[];
  size?: number;
  thickness?: number;
  center?: ReactNode;
}) {
  let acc = 0;
  const total = segments.reduce((s, x) => s + x.v, 0) || 1;
  const stops = segments
    .map((s) => {
      const a = (acc / total) * 360;
      const b = ((acc + s.v) / total) * 360;
      acc += s.v;
      return `${s.color} ${a}deg ${b}deg`;
    })
    .join(",");
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `conic-gradient(${stops})`,
        position: "relative",
        flex: "0 0 auto",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: thickness,
          borderRadius: "50%",
          background: "var(--bg-1)",
          display: "grid",
          placeItems: "center",
        }}
      >
        {center}
      </div>
    </div>
  );
}

/* ---- Area sparkline / line chart (svg) ---- */
export function AreaChart({
  series,
  prev,
  w = 560,
  h = 200,
  color = "var(--accent)",
  pad = 10,
}: {
  series: number[];
  prev?: number[];
  w?: number;
  h?: number;
  color?: string;
  pad?: number;
}) {
  const all = [...series, ...(prev || [])];
  const max = Math.max(...all) * 1.12 || 1;
  const min = 0;
  const X = (i: number) => pad + (i / (series.length - 1)) * (w - pad * 2);
  const Y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  const path = (s: number[]) => s.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const area = path(series) + ` L${X(series.length - 1)} ${h - pad} L${X(0)} ${h - pad} Z`;
  const id = "g" + Math.abs(series.reduce((a, b) => a + b, series.length)).toString(36);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.24" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={pad} x2={w - pad} y1={h * f} y2={h * f} stroke="var(--border-1)" strokeDasharray="3 5" />
      ))}
      {prev && (
        <path d={path(prev)} fill="none" stroke="var(--text-3)" strokeWidth="2" strokeDasharray="5 5" opacity="0.5" />
      )}
      <path d={area} fill={`url(#${id})`} />
      <path d={path(series)} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---- Mini bars ---- */
export function MiniBars({ data, color = "var(--accent)", h = 40 }: { data: number[]; color?: string; h?: number }) {
  const max = Math.max(...data) || 1;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: h }}>
      {data.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${(v / max) * 100}%`,
            minHeight: 3,
            background: color,
            borderRadius: 3,
            opacity: 0.35 + 0.65 * (v / max),
          }}
        />
      ))}
    </div>
  );
}

/* ---- Segment bar ---- */
export function SegBar({ segments }: { segments: DonutSeg[] }) {
  const total = segments.reduce((s, x) => s + x.v, 0) || 1;
  return (
    <div className="segbar">
      {segments.map((s, i) => (
        <span key={i} style={{ width: `${(s.v / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}

export { Icon } from "./Icon";
export type { IconName } from "./Icon";
