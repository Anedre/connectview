import { motion, useReducedMotion } from "framer-motion";

/**
 * BlurText — revelado palabra por palabra (blur + rise) para títulos hero.
 * Adaptación de React Bits (MIT) al stack de ARIA: usa framer-motion (ya
 * instalado) y respeta prefers-reduced-motion (texto plano, sin animación).
 */
export function BlurText({
  text,
  delay = 0,
  stagger = 0.055,
  className,
}: {
  text: string;
  /** segundos antes de la primera palabra */
  delay?: number;
  /** segundos entre palabras */
  stagger?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <span className={className}>{text}</span>;
  const words = text.split(" ");
  return (
    <span className={className} style={{ display: "inline-block" }}>
      {words.map((w, i) => (
        <motion.span
          key={`${w}-${i}`}
          initial={{ opacity: 0, filter: "blur(7px)", y: 8 }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          transition={{ duration: 0.45, delay: delay + i * stagger, ease: [0.2, 0.7, 0.2, 1] }}
          style={{ display: "inline-block", whiteSpace: "pre" }}
        >
          {w + (i < words.length - 1 ? " " : "")}
        </motion.span>
      ))}
    </span>
  );
}
