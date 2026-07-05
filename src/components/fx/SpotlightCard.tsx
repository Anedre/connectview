import { useRef, type CSSProperties, type ReactNode } from "react";

/**
 * SpotlightCard — halo radial que sigue al puntero sobre una card
 * (React Bits, MIT). Es un wrapper: envuelve una `.card` existente (Stat,
 * etc.) sin tocarla; el glow es un overlay con pointer-events:none, así que
 * el contenido sigue siendo clickeable. CSS en motion.css (`.fx-spotlight`).
 */
export function SpotlightCard({
  children,
  color,
  radius = "var(--r-lg)",
  className = "",
  style,
}: {
  children: ReactNode;
  /** color del halo (default: acento al 13%) */
  color?: string;
  /** debe coincidir con el radio de la card interior */
  radius?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={`fx-spotlight ${className}`.trim()}
      style={
        {
          display: "grid",
          borderRadius: radius,
          ...(color ? { "--fx-spot-color": color } : null),
          ...style,
        } as CSSProperties
      }
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--fx-x", `${e.clientX - r.left}px`);
        el.style.setProperty("--fx-y", `${e.clientY - r.top}px`);
      }}
    >
      {children}
      <div aria-hidden className="fx-spotlight__glow" />
    </div>
  );
}
