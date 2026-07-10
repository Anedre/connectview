import * as React from "react";

export interface TokenVariable {
  name: string;
  /** Etiqueta visible del chip. Default: `{{name}}`. */
  label?: string;
}
export interface TokenInputProps {
  value: string;
  onChange: (value: string) => void;
  variables: TokenVariable[];
  multiline?: boolean;
  placeholder?: string;
  rows?: number;
  /** Acento por flujo. Default: var(--accent). */
  accent?: string;
}

/**
 * TokenInput — input/textarea con chips que insertan `{{variables}}` EN EL CURSOR.
 * Unifica lo que hoy está disperso: Bots tiene `VarInsert`, Automatizaciones y
 * Journeys no tienen nada (se teclea `{{name}}` a mano). Reutilizable en los tres.
 */
export function TokenInput({
  value,
  onChange,
  variables,
  multiline = true,
  placeholder,
  rows = 3,
  accent = "var(--accent)",
}: TokenInputProps) {
  const ref = React.useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  const insert = (name: string) => {
    const token = `{{${name}}}`;
    const el = ref.current;
    if (!el) {
      onChange(value + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const commonStyle: React.CSSProperties = {
    width: "100%",
    fontSize: 12.5,
    padding: "8px 10px",
    borderRadius: 9,
    border: "1px solid var(--border-2)",
    background: "var(--bg-1)",
    color: "var(--text-1)",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {multiline ? (
        <textarea
          ref={(el) => {
            ref.current = el;
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          style={{ ...commonStyle, resize: "vertical", lineHeight: 1.5 }}
        />
      ) : (
        <input
          ref={(el) => {
            ref.current = el;
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={commonStyle}
        />
      )}
      {variables.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 10.5, color: "var(--text-3)", fontWeight: 600 }}>Insertar:</span>
          {variables.map((v) => (
            <button
              key={v.name}
              type="button"
              onClick={() => insert(v.name)}
              style={{
                padding: "3px 8px",
                borderRadius: 999,
                border: `1px solid color-mix(in srgb, ${accent} 30%, var(--border-1))`,
                background: `color-mix(in srgb, ${accent} 8%, transparent)`,
                color: accent,
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
              }}
            >
              {v.label || `{{${v.name}}}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
