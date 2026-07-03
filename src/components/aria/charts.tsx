/* ============================================================
   ARIA · chart helpers  ·  count-up numbers + interactive area
   ============================================================ */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTopBarActions } from "@/components/layout/TopBarSlot";

/* ---- count-up hook (respects reduce-motion / hidden tab) ---- */
export function useCountUp(target: number, dur = 1000): number {
  const reduce =
    typeof window !== "undefined" &&
    ((window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
      document.hidden);
  const [v, setV] = useState(reduce ? target : 0);
  useEffect(() => {
    if (reduce) {
      setV(target);
      return;
    }
    let raf = 0;
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const p = Math.min((t - start) / dur, 1);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // safety: land on target even if rAF is throttled
    const floor = setTimeout(() => setV(target), dur + 150);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(floor);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return v;
}

export function Num({
  value,
  dec = 0,
  suffix = "",
  prefix = "",
}: {
  value: number;
  dec?: number;
  suffix?: string;
  prefix?: string;
}) {
  const v = useCountUp(value);
  const s = dec > 0 ? v.toFixed(dec) : Math.round(v).toLocaleString("es-PE");
  return (
    <span className="tnum">
      {prefix}
      {s}
      {suffix}
    </span>
  );
}

/* ---- interactive area chart with hover tooltip ---- */
export function InteractiveArea({
  series,
  prev,
  labels,
  color = "var(--accent)",
  h = 230,
}: {
  series: number[];
  prev?: number[];
  labels?: string[];
  color?: string;
  h?: number;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const w = 600;
  const pad = 14;
  const max = Math.max(...series, ...(prev || [series[0] || 0])) * 1.14 || 1;
  const X = (i: number) => pad + (i / (series.length - 1)) * (w - pad * 2);
  const Y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const line = (s: number[]) => s.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const area = line(series) + `L${X(series.length - 1)} ${h - pad}L${X(0)} ${h - pad}Z`;
  const id = "ig" + Math.abs(series.reduce((a, b) => a + b, series.length)).toString(36);
  const move = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let idx = Math.round(((e.clientX - r.left) / r.width) * (series.length - 1));
    idx = Math.max(0, Math.min(series.length - 1, idx));
    setHi(idx);
  };
  return (
    <div ref={ref} style={{ position: "relative" }} onMouseMove={move} onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" preserveAspectRatio="none" style={{ display: "block" }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.26" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad} x2={w - pad} y1={h * f} y2={h * f} stroke="var(--border-1)" strokeDasharray="3 6" />
        ))}
        {prev && (
          <path d={line(prev)} fill="none" stroke="var(--text-3)" strokeWidth="2" strokeDasharray="5 5" opacity="0.45" />
        )}
        <path d={area} fill={`url(#${id})`} />
        <path d={line(series)} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        {hi != null && (
          <>
            <line x1={X(hi)} x2={X(hi)} y1={pad} y2={h - pad} stroke={color} strokeWidth="1.2" opacity="0.5" />
            <circle cx={X(hi)} cy={Y(series[hi])} r="4.5" fill="var(--bg-1)" stroke={color} strokeWidth="2.5" />
          </>
        )}
      </svg>
      {hi != null && (
        <div className="chart-tip" style={{ left: (X(hi) / w) * 100 + "%", top: 6 }}>
          <Num value={series[hi]} />
          {labels && <small>{labels[hi]}</small>}
        </div>
      )}
    </div>
  );
}

/* ---- Funnel (stage bars) ---- */
export interface FunnelStage {
  et: string;
  n: number;
  color: string;
}
export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const maxF = stages[0]?.n || 1;
  return (
    <div className="col gap12">
      {stages.map((f) => (
        <div key={f.et}>
          <div className="row between" style={{ fontSize: 12.5, marginBottom: 5 }}>
            <span className="muted">{f.et}</span>
            <b className="tnum">{f.n.toLocaleString()}</b>
          </div>
          <div className="bar" style={{ height: 10 }}>
            <span style={{ width: (f.n / maxF) * 100 + "%", background: f.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---- Section actions → topbar ----
   El bloque hero (título + fecha + chip) se eliminó de TODAS las secciones por
   pedido de diseño: el breadcrumb del topbar ya indica en qué sección estás.
   HeroBand ahora SOLO publica sus acciones (`right`) en el topbar (a la derecha)
   y no renderiza nada. Se conserva la firma completa (title/chip/…) para no
   tocar los ~13 call sites que ya las pasan. */
export function HeroBand({
  right,
}: {
  title?: ReactNode;
  chip?: ReactNode;
  chipIcon?: string;
  chipTone?: string;
  right?: ReactNode;
}) {
  useTopBarActions(right ?? null, [right]);
  return null;
}
