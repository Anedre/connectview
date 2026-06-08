import { useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * StatCard — a modern KPI tile (Linear/Stripe-style): big value, a colored
 * delta vs the previous period, and an inline sparkline of recent activity.
 * Hoverable + clickable (navigates to the relevant page). Theme-aware.
 */
export function StatCard({
  label,
  value,
  accent,
  delta,
  deltaSuffix = "vs período anterior",
  sub,
  spark,
  to,
}: {
  label: string;
  value: string | number;
  accent: string;
  /** signed number → ▲ green / ▼ red. Omit for no delta. */
  delta?: number;
  deltaSuffix?: string;
  /** shown when no delta. */
  sub?: string;
  /** sparkline series (small ints). */
  spark?: number[];
  /** route to navigate to on click. */
  to?: string;
}) {
  const navigate = useNavigate();
  const [hover, setHover] = useState(false);
  const clickable = Boolean(to);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => to && navigate(to)}
      style={{
        position: "relative",
        overflow: "hidden",
        padding: "15px 16px",
        borderRadius: 12,
        background: "var(--bg-2)",
        border: "1px solid var(--border-1)",
        borderColor: hover && clickable ? accent : "var(--border-1)",
        cursor: clickable ? "pointer" : "default",
        transform: hover && clickable ? "translateY(-2px)" : "none",
        boxShadow: hover && clickable ? `0 10px 24px -14px ${accent}` : "none",
        transition: "transform .15s, box-shadow .15s, border-color .15s",
      }}
    >
      {/* accent wash on hover */}
      <div
        style={{
          position: "absolute", inset: 0,
          background: `linear-gradient(135deg, ${accent}14, transparent 55%)`,
          opacity: hover ? 1 : 0, transition: "opacity .15s", pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-3)", fontWeight: 600 }}>
          {label}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: accent, lineHeight: 1 }}>{value}</span>
          {spark && spark.length > 1 && <Sparkline data={spark} color={accent} />}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 7, display: "flex", alignItems: "center", gap: 6 }}>
          {delta !== undefined && delta !== 0 ? (
            <>
              <span style={{ fontWeight: 700, color: delta > 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
              </span>
              <span>{deltaSuffix}</span>
            </>
          ) : (
            <span>{sub}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Tiny inline area sparkline (SVG, no deps). */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 64;
  const h = 26;
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((v, i) => [i * step, h - (v / max) * (h - 3) - 1.5]);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const gid = `sl${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width={w} height={h} style={{ flex: "0 0 auto", overflow: "visible" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
