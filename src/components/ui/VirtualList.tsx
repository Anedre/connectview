import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualListProps<T> {
  items: T[];
  /** Alto estimado de cada fila en px (puede variar; es solo la estimación). */
  rowHeight?: number;
  /** Alto del viewport scrolleable. */
  height?: number | string;
  renderRow: (item: T, index: number) => ReactNode;
  className?: string;
}

/**
 * VirtualList — lista virtualizada con @tanstack/react-virtual: solo monta en el
 * DOM las filas visibles (+ overscan), así una lista de miles de items scrollea
 * fluida. Reutilizable para grabaciones, contactos, leads, etc.
 */
export function VirtualList<T>({
  items,
  rowHeight = 44,
  height = 360,
  renderRow,
  className,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  return (
    <div
      ref={parentRef}
      className={className}
      style={{
        height,
        overflow: "auto",
        border: "1px solid var(--border-1)",
        borderRadius: 8,
        background: "var(--bg-1)",
      }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            data-index={vi.index}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: vi.size,
              transform: `translateY(${vi.start}px)`,
            }}
          >
            {renderRow(items[vi.index], vi.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
