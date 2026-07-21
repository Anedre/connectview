import * as React from "react";

export interface StepperProps {
  value: number;
  onValueChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Sufijo pequeño junto al número (p.ej. "×", "/50"). */
  suffix?: React.ReactNode;
  /** Acento del número (default tinta). */
  accent?: string;
  size?: "sm" | "md";
  "aria-label"?: string;
}

/**
 * Stepper — control numérico con botones − / + y el valor al centro. Reemplaza a
 * los `<input type="range">` (sliders) cuando el valor es discreto y acotado: es
 * más preciso (un click = un paso), táctil y accesible. Acompaña a SegmentedControl
 * y RadioCards en el kit de controles del design system.
 */
export function Stepper({
  value,
  onValueChange,
  min = 0,
  max = 9999,
  step = 1,
  disabled,
  suffix,
  accent = "var(--text-1)",
  size = "md",
  ...aria
}: StepperProps) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const set = (n: number) => {
    if (!disabled) onValueChange(clamp(n));
  };
  const atMin = value <= min;
  const atMax = value >= max;
  const dim = size === "sm" ? 30 : 38;
  const numSize = size === "sm" ? 16 : 20;

  const btnStyle = (enabled: boolean): React.CSSProperties => ({
    width: dim,
    display: "grid",
    placeItems: "center",
    border: "none",
    background: "transparent",
    color: enabled ? "var(--text-2)" : "var(--text-3)",
    fontSize: numSize + 2,
    fontWeight: 600,
    lineHeight: 1,
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.4,
    transition: "background .14s ease, color .14s ease",
  });

  return (
    <div
      role="group"
      {...aria}
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        border: "1px solid var(--border-1)",
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--bg-2)",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <button
        type="button"
        aria-label="Disminuir"
        disabled={disabled || atMin}
        onClick={() => set(value - step)}
        className="tstep__btn"
        style={btnStyle(!disabled && !atMin)}
      >
        −
      </button>
      <div
        style={{
          minWidth: size === "sm" ? 44 : 58,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "center",
          gap: 3,
          padding: size === "sm" ? "5px 8px" : "7px 8px",
          borderLeft: "1px solid var(--border-1)",
          borderRight: "1px solid var(--border-1)",
          fontSize: numSize,
          fontWeight: 780,
          fontVariantNumeric: "tabular-nums",
          color: accent,
        }}
      >
        {value}
        {suffix != null && (
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500 }}>{suffix}</span>
        )}
      </div>
      <button
        type="button"
        aria-label="Aumentar"
        disabled={disabled || atMax}
        onClick={() => set(value + step)}
        className="tstep__btn"
        style={btnStyle(!disabled && !atMax)}
      >
        +
      </button>
    </div>
  );
}
