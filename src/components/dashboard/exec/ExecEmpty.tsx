import { type LucideIcon } from "lucide-react";

/**
 * ExecEmpty — estado vacío premium para los paneles del dashboard ejecutivo
 * cuando un período no tiene datos (0 contactos / leads / campañas…). En lugar
 * de un gráfico en cero (anillo gris + "0", barras planas, listas vacías),
 * muestra un arte sobrio + copy que explica QUÉ aparecerá ahí.
 *
 * - `variant="ring"` dibuja un donut "fantasma" (segmentos tenues) → reemplaza
 *   los donuts manteniendo su silueta, así no se ve roto sino "a la espera".
 * - `variant="plain"` usa un ícono en chip soft → para barras, listas, embudo,
 *   heatmap y demás.
 */
export function ExecEmpty({
  icon: Icon,
  title,
  sub,
  variant = "plain",
  minHeight = 150,
}: {
  icon: LucideIcon;
  title: string;
  sub?: string;
  variant?: "ring" | "plain";
  minHeight?: number;
}) {
  return (
    <div className="exec-empty" style={{ minHeight }}>
      <div className={`exec-empty__art exec-empty__art--${variant}`}>
        {variant === "ring" && <span className="exec-empty__ring" aria-hidden />}
        <Icon className="exec-empty__icon" strokeWidth={1.6} />
      </div>
      <div className="exec-empty__copy">
        <div className="exec-empty__title">{title}</div>
        {sub && <div className="exec-empty__sub">{sub}</div>}
      </div>
    </div>
  );
}
