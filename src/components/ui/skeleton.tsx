import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Skeleton — bloque shimmer con forma del contenido final, para estados de
 * carga (reemplaza los "Cargando…" en texto plano repartidos por la app).
 * Se apoya en la clase `.skel` (animación `skel-shimmer`, tokenizada) de
 * `src/index.css`. Respeta `prefers-reduced-motion`. Ref: sistema de estados.
 */
function Skeleton({
  className,
  width,
  height,
  radius,
  circle,
  text,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  /** Círculo (avatar). Ignora `radius`. */
  circle?: boolean;
  /** Variante de línea de texto (radio menor, alto por defecto ~0.8em). */
  text?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn("skel", text && "skel--text", className)}
      style={{
        width,
        height: height ?? (text ? "0.8em" : undefined),
        borderRadius: circle ? "50%" : radius,
        ...(circle ? { aspectRatio: "1 / 1" } : null),
        ...style,
      }}
      {...props}
    />
  );
}

/** Varias líneas de texto; la última sale más corta (más natural). */
function SkeletonText({
  lines = 3,
  className,
  style,
}: {
  lines?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cn("col", className)} style={{ gap: 8, ...style }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} text height={11} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}

/** Fila tipo lista: avatar + dos líneas. Para Inbox, Leads, colas, equipos. */
function SkeletonRow({ style }: { style?: React.CSSProperties }) {
  return (
    <div className="row" style={{ gap: 12, alignItems: "center", padding: "12px 14px", ...style }}>
      <Skeleton circle width={38} />
      <div className="col" style={{ gap: 7, flex: 1, minWidth: 0 }}>
        <Skeleton text height={12} width="55%" />
        <Skeleton text height={10} width="85%" />
      </div>
    </div>
  );
}

/** Lista de N filas skeleton (con separadores tenues). */
function SkeletonList({ rows = 6, style }: { rows?: number; style?: React.CSSProperties }) {
  return (
    <div aria-hidden aria-busy="true" style={style}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow
          key={i}
          style={i > 0 ? { borderTop: "1px solid var(--border-1)" } : undefined}
        />
      ))}
    </div>
  );
}

/** Tarjeta skeleton: barra de título + bloque de cuerpo. Para dashboards. */
function SkeletonCard({
  lines = 3,
  className,
  style,
}: {
  lines?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      aria-busy="true"
      className={className}
      style={{
        padding: 16,
        borderRadius: "var(--radius-4, 12px)",
        border: "1px solid var(--border-1)",
        background: "var(--bg-1)",
        ...style,
      }}
    >
      <Skeleton width="42%" height={13} style={{ marginBottom: 14 }} />
      <SkeletonText lines={lines} />
    </div>
  );
}

export { Skeleton, SkeletonText, SkeletonRow, SkeletonList, SkeletonCard };
