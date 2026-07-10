import * as React from "react";

export interface RadioCardOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  /** Acento puntual de la tarjeta activa (color por tipo). Default: var(--accent). */
  color?: string;
}
export interface RadioCardsProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: RadioCardOption<T>[];
  columns?: number;
  "aria-label"?: string;
}

/**
 * RadioCards — selección de "tipo" como tarjetas (icono + label + descripción)
 * en vez de un `<select>`. Reemplaza los `<select>` de tipo de acción/trigger/paso
 * por el patrón visual que Automatizaciones ya usa bien en `.wf-pick`, ahora
 * reutilizable en los tres builders, con acento puntual por tipo.
 */
export function RadioCards<T extends string>({
  value,
  onValueChange,
  options,
  columns = 2,
  ...aria
}: RadioCardsProps<T>) {
  return (
    <div
      role="radiogroup"
      style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 8 }}
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
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "10px 12px",
              borderRadius: 11,
              cursor: "pointer",
              border: `1.5px solid ${active ? accent : "var(--border-1)"}`,
              background: active ? `color-mix(in srgb, ${accent} 8%, var(--bg-1))` : "var(--bg-1)",
              boxShadow: active
                ? `0 0 0 3px color-mix(in srgb, ${accent} 12%, transparent)`
                : "none",
              transition: "border-color .14s ease, box-shadow .14s ease, background .14s ease",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                color: active ? accent : "var(--text-1)",
                fontWeight: 700,
                fontSize: 12.5,
              }}
            >
              {o.icon}
              {o.label}
            </span>
            {o.description && (
              <span style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.35 }}>
                {o.description}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
