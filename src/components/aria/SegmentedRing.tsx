import type { ReactNode } from "react";

/**
 * SegmentedRing — anillo (dona) SVG con segmentos de puntas redondeadas y una
 * pequeña separación entre ellos, estilo "premium" (como el resumen de envíos de
 * los competidores). A diferencia del `Donut` de conic-gradient (bordes duros),
 * este usa arcos `stroke` con `linecap:round` → se ve suave y moderno.
 *
 * Uso: <SegmentedRing segments={[{value, color}]} center={<…>} />
 */
export interface RingSeg {
  value: number;
  color: string;
  label?: string;
}

export function SegmentedRing({
  segments,
  size = 168,
  thickness = 16,
  gapDeg = 4,
  track = "var(--bg-3)",
  center,
}: {
  segments: RingSeg[];
  size?: number;
  thickness?: number;
  /** Separación entre segmentos, en grados. */
  gapDeg?: number;
  track?: string;
  center?: ReactNode;
}) {
  const pos = segments.filter((s) => s.value > 0);
  const total = pos.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const C = 2 * Math.PI * r;
  const gap = (gapDeg / 360) * C;
  const single = pos.length === 1;

  // Longitud de cada arco y su offset acumulado (suma de los anteriores), sin
  // mutar variables durante el render.
  const lens = pos.map((s) => (s.value / total) * C);
  const offsets = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  const arcs = pos.map((s, i) => {
    // Con una sola porción, anillo lleno (sin muesca del gap).
    const dash = single ? C : Math.max(0.001, lens[i] - gap);
    return (
      <circle
        key={i}
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={s.color}
        strokeWidth={thickness}
        strokeLinecap={single ? "butt" : "round"}
        strokeDasharray={`${dash} ${Math.max(0, C - dash)}`}
        strokeDashoffset={-offsets[i]}
        transform={`rotate(-90 ${c} ${c})`}
      />
    );
  });

  return (
    <div style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke={track} strokeWidth={thickness} />
        {arcs}
      </svg>
      {center != null && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            padding: thickness,
          }}
        >
          {center}
        </div>
      )}
    </div>
  );
}
