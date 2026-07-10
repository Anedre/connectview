export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  /** Acento del estado "on". Default: var(--accent). Úsalo para el color por flujo. */
  accent?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

/**
 * Switch — toggle accesible del design system ARIA. Faltaba un primitivo de toggle
 * en todo el repo (los builders usaban `<select>` "Sí/No" o checkboxes pelados).
 * Controlado, con tokens (`var(--accent)`/`--bg-3`/`--border-2`) y pulgar animado.
 * Respeta `prefers-reduced-motion` vía la transición corta (sin translate agresivo).
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  accent = "var(--accent)",
  ...aria
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        width: 38,
        height: 22,
        flex: "0 0 auto",
        borderRadius: 999,
        border: "1px solid",
        borderColor: checked ? "transparent" : "var(--border-2)",
        background: checked ? accent : "var(--bg-3)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        padding: 0,
        transition: "background .16s ease, border-color .16s ease",
      }}
      {...aria}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "50%",
          left: checked ? 18 : 3,
          width: 15,
          height: 15,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
          transform: "translateY(-50%)",
          transition: "left .18s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      />
    </button>
  );
}
