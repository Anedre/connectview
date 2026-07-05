import type { CSSProperties, ReactNode } from "react";

/**
 * ShinyText — texto con un destello que barre de lado a lado (React Bits, MIT).
 * El efecto vive en CSS (`.fx-shine` en motion.css); este componente solo fija
 * la velocidad y el color base vía CSS vars. Para textos que YA tienen su
 * propio gradiente (p. ej. `.vox-auth__title-grad`) usar la clase
 * `fx-gradient-x` directamente en vez de este componente.
 */
export function ShinyText({
  children,
  speed = 3,
  baseColor,
  className = "",
}: {
  children: ReactNode;
  /** segundos por barrido */
  speed?: number;
  /** color del texto (default: var(--text-2)) */
  baseColor?: string;
  className?: string;
}) {
  return (
    <span
      className={`fx-shine ${className}`.trim()}
      style={
        {
          "--fx-shine-speed": `${speed}s`,
          ...(baseColor ? { "--fx-shine-base": baseColor } : null),
        } as CSSProperties
      }
    >
      {children}
    </span>
  );
}
