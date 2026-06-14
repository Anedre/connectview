/**
 * Sparkline — mini gráfico de área+línea para las tarjetas de métricas (tendencia
 * por semana). Portado del design system de ARIA (Claude Design). Sin ejes ni
 * etiquetas: solo la forma de la tendencia.
 */
export function Sparkline({
  data, color = "var(--accent-cyan)", height = 26, fill = true,
}: { data: number[]; color?: string; height?: number; fill?: boolean }) {
  if (!data || data.length === 0) return null;
  const w = 100, h = height;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const span = max - min || 1;
  const pts = data.map((v, i) => [
    data.length === 1 ? w / 2 : (i / (data.length - 1)) * w,
    h - 2 - ((v - min) / span) * (h - 4),
  ] as const);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = line + ` L${w} ${h} L0 ${h} Z`;
  const gid = "spk" + color.replace(/[^a-z0-9]/gi, "") + Math.round(h);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block" }} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.22" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
