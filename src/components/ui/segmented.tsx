import * as React from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Icono opcional a la izquierda del label. */
  icon?: React.ReactNode;
  /** Acento puntual del segmento activo (color por tipo/rama). Default: var(--accent). */
  color?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  /** Ocupa todo el ancho (segmentos flex:1). */
  block?: boolean;
  "aria-label"?: string;
}

/**
 * SegmentedControl — selector de pocas opciones (2-4) que reemplaza a los
 * `<select>` nativos cuando las opciones son pocas y se benefician de verse todas.
 * El segmento activo lleva un acento PUNTUAL (`color` por opción) sobre superficie
 * limpia — encaja con la dirección minimalista + color-por-flujo de los builders.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  block = false,
  ...aria
}: SegmentedControlProps<T>) {
  const pad = size === "sm" ? "5px 9px" : "7px 12px";
  const fontSize = size === "sm" ? 11.5 : 12.5;
  return (
    <div
      role="radiogroup"
      style={{
        display: block ? "flex" : "inline-flex",
        width: block ? "100%" : undefined,
        padding: 3,
        gap: 2,
        background: "var(--bg-3)",
        border: "1px solid var(--border-1)",
        borderRadius: 10,
      }}
      {...aria}
    >
      {options.map((o) => {
        const active = o.value === value;
        const accent = o.color || "var(--accent)";
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onValueChange(o.value)}
            style={{
              flex: block ? 1 : undefined,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: pad,
              borderRadius: 7,
              border: "none",
              background: active ? "var(--bg-1)" : "transparent",
              color: active ? accent : "var(--text-2)",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              fontWeight: active ? 700 : 600,
              fontSize,
              lineHeight: 1,
              whiteSpace: "nowrap",
              cursor: "pointer",
              transition: "color .14s ease, background .14s ease, box-shadow .14s ease",
            }}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
