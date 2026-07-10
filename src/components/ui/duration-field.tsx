import { SegmentedControl } from "./segmented";

export interface DurationUnitOption {
  value: string;
  label: string;
}
export interface DurationPreset {
  label: string;
  amount: number;
  unit: string;
}
export interface DurationFieldProps {
  amount: number;
  unit: string;
  onChange: (next: { amount: number; unit: string }) => void;
  units: DurationUnitOption[];
  presets?: DurationPreset[];
  min?: number;
  max?: number;
  /** Acento por flujo. Default: var(--accent). */
  accent?: string;
}

/**
 * DurationField — un solo control para "esperar/delay": cantidad + unidad
 * (segmented) + chips de preset. Reemplaza los 3 controles sueltos (number,
 * `<select>` de unidad y chips) que hoy repiten Bots, Journeys y Automatizaciones.
 */
export function DurationField({
  amount,
  unit,
  onChange,
  units,
  presets,
  min = 1,
  max = 999,
  accent = "var(--accent)",
}: DurationFieldProps) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n) || min));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="number"
          min={min}
          max={max}
          value={amount}
          onChange={(e) => onChange({ amount: clamp(Number(e.target.value)), unit })}
          aria-label="Cantidad"
          style={{
            width: 72,
            fontSize: 13,
            padding: "7px 9px",
            borderRadius: 9,
            border: "1px solid var(--border-2)",
            background: "var(--bg-1)",
            color: "var(--text-1)",
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
            boxSizing: "border-box",
          }}
        />
        <SegmentedControl
          value={unit}
          onValueChange={(u) => onChange({ amount, unit: u })}
          options={units.map((u) => ({ value: u.value, label: u.label, color: accent }))}
          size="sm"
        />
      </div>
      {presets && presets.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {presets.map((p) => {
            const active = p.amount === amount && p.unit === unit;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange({ amount: p.amount, unit: p.unit })}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: `1px solid ${active ? accent : "var(--border-1)"}`,
                  background: active
                    ? `color-mix(in srgb, ${accent} 12%, transparent)`
                    : "var(--bg-1)",
                  color: active ? accent : "var(--text-2)",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
