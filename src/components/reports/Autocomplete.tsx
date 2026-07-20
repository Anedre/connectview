import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";

/**
 * Autocomplete — input de texto con sugerencias predictivas (typeahead). Al
 * escribir filtra las opciones que coinciden; al enfocar SIN texto muestra "lo
 * básico" (las primeras `basicCount`). Navegación con ↑/↓, Enter selecciona,
 * Esc cierra. Reutilizable: consulta teléfono/nombre (Pipeline) y username del
 * agente (Operación). El texto libre sigue siendo válido — seleccionar una
 * sugerencia solo autocompleta.
 */

export interface AutoOption {
  /** Valor que se setea al seleccionar (p.ej. el teléfono exacto o el username). */
  value: string;
  /** Texto principal de la fila. */
  label: string;
  /** Texto secundario, opcional (nombre del lead, nombre real del agente…). */
  sub?: string;
}

const norm = (s: string) => s.toLowerCase().trim();
const digits = (s: string) => s.replace(/\D+/g, "");

export function Autocomplete({
  label,
  value,
  onChange,
  options,
  placeholder,
  basicCount = 8,
  matchDigits = false,
  flex = "1 1 190px",
  height = 34,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: AutoOption[];
  placeholder?: string;
  /** Cuántas sugerencias "básicas" mostrar cuando el input está vacío. */
  basicCount?: number;
  /** Si además de label/sub, matchear por dígitos del value (teléfonos). */
  matchDigits?: boolean;
  flex?: string;
  /** Alto del input (px) — 34 en Pipeline, 38 en la barra de Operación. */
  height?: number;
  /** Enter sin sugerencia activa (p.ej. lanzar la búsqueda en Operación). */
  onEnter?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLLabelElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = norm(value);
    if (!q) return options.slice(0, basicCount);
    const qd = digits(value);
    const hit = (o: AutoOption) =>
      norm(o.label).includes(q) ||
      (o.sub ? norm(o.sub).includes(q) : false) ||
      (matchDigits && qd.length > 0 && digits(o.value).includes(qd));
    return options.filter(hit).slice(0, 10);
  }, [value, options, basicCount, matchDigits]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Mantener el ítem activo a la vista al navegar con teclado.
  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    const el = listRef.current.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (o: AutoOption) => {
    onChange(o.value);
    setOpen(false);
    setActive(-1);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && suggestions[active]) {
        e.preventDefault();
        pick(suggestions[active]);
      } else {
        setOpen(false);
        onEnter?.();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <label
      ref={wrapRef}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
        flex,
        position: "relative",
      }}
    >
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".04em",
          color: "var(--text-3)",
        }}
      >
        {label}
      </span>
      <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <MagnifyingGlass
          size={14}
          weight="bold"
          style={{ position: "absolute", left: 10, color: "var(--text-3)", pointerEvents: "none" }}
        />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          style={{
            height,
            width: "100%",
            borderRadius: 9,
            border: "1px solid var(--border-1)",
            background: "var(--bg-2)",
            color: "var(--text-1)",
            padding: "0 10px 0 30px",
            fontSize: 13,
            fontWeight: 600,
            outline: "none",
          }}
        />
      </span>

      {open && suggestions.length > 0 && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 40,
            maxHeight: 260,
            overflowY: "auto",
            background: "var(--bg-1)",
            border: "1px solid var(--border-2)",
            borderRadius: 11,
            boxShadow: "0 16px 40px rgba(4,10,20,.24)",
            padding: 5,
            animation: "aria-rise .16s cubic-bezier(.2,.7,.2,1)",
          }}
        >
          {!norm(value) && (
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".05em",
                color: "var(--text-3)",
                padding: "4px 9px 6px",
              }}
            >
              Sugerencias
            </div>
          )}
          {suggestions.map((o, i) => (
            <button
              key={`${o.value}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // no perder el foco antes del click
                pick(o);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: "7px 9px",
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                background:
                  i === active
                    ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                    : "transparent",
                color: "var(--text-1)",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{o.label}</span>
              {o.sub && (
                <span
                  className="trunc"
                  style={{ fontSize: 12, color: "var(--text-3)", minWidth: 0, textAlign: "right" }}
                >
                  {o.sub}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </label>
  );
}
