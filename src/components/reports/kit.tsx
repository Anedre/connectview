import type { ReactNode } from "react";
import { Num } from "@/components/aria";

/**
 * kit — primitivas premium COMPARTIDAS de Reportes. Antes cada sub-reporte
 * reinventaba su tarjeta KPI (6 estilos distintos: radios 8/12/13, tamaños
 * 20/24/26px) y su barra horizontal a mano ("label + track + fill"). Esto las
 * unifica en un solo lenguaje: KPIs con glow + count-up, barras con gradiente y
 * animación de entrada, y un embudo real. Todo en tokens ARIA (dark-mode-safe).
 */

/** Tarjeta KPI premium: acento a la izquierda + glow sutil, valor con count-up. */
export function Kpi({
  icon,
  color = "var(--accent)",
  label,
  value,
  sub,
}: {
  icon?: ReactNode;
  color?: string;
  label: string;
  /** Número → count-up automático; string/nodo → se muestra tal cual. */
  value: number | string | ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div
      className="rep-kpi"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 13,
        border: "1px solid var(--border-1)",
        borderLeft: `3px solid ${color}`,
        background: `linear-gradient(135deg, color-mix(in srgb, ${color} 7%, var(--bg-1)) 0%, var(--bg-1) 60%)`,
        padding: "13px 15px",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -30,
          right: -20,
          width: 90,
          height: 90,
          borderRadius: "50%",
          background: `radial-gradient(circle, color-mix(in srgb, ${color} 14%, transparent), transparent 70%)`,
          pointerEvents: "none",
        }}
      />
      <div className="row gap6" style={{ alignItems: "center", marginBottom: 7 }}>
        {icon && (
          <span
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 22,
              height: 22,
              borderRadius: 7,
              background: `color-mix(in srgb, ${color} 16%, transparent)`,
              color,
              flex: "0 0 auto",
            }}
          >
            {icon}
          </span>
        )}
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
      </div>
      <div
        style={{
          fontSize: 25,
          fontWeight: 820,
          lineHeight: 1.05,
          color: "var(--text-1)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-.01em",
        }}
      >
        {typeof value === "number" ? <Num value={value} /> : value}
      </div>
      {sub != null && (
        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>
      )}
    </div>
  );
}

/** Grid responsivo de KPIs (auto-fit). */
export function KpiRow({ children, min = 150 }: { children: ReactNode; min?: number }) {
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12 }}
    >
      {children}
    </div>
  );
}

/**
 * Fila de barra horizontal premium: label + track + fill con gradiente + valor.
 * `max` normaliza el ancho; `pct` (0..1) opcional para una etiqueta de porcentaje.
 */
export function BarRow({
  label,
  value,
  max,
  color = "var(--accent)",
  valueLabel,
  hint,
}: {
  label: ReactNode;
  value: number;
  max: number;
  color?: string;
  /** Texto a la derecha (default: el valor). */
  valueLabel?: ReactNode;
  /** Texto secundario pequeño bajo el label. */
  hint?: ReactNode;
}) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "5px 0" }}>
      <div style={{ width: 130, flex: "0 0 auto", minWidth: 0 }}>
        <div
          className="trunc"
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}
          title={typeof label === "string" ? label : undefined}
        >
          {label}
        </div>
        {hint != null && (
          <div className="dim" style={{ fontSize: 10.5, marginTop: 1 }}>
            {hint}
          </div>
        )}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          height: 9,
          borderRadius: 99,
          background: "var(--bg-2)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${w}%`,
            height: "100%",
            borderRadius: 99,
            background: `linear-gradient(90deg, color-mix(in srgb, ${color} 65%, transparent), ${color})`,
            transition: "width .5s cubic-bezier(.22,1,.36,1)",
          }}
        />
      </div>
      <div
        style={{
          width: 62,
          flex: "0 0 auto",
          textAlign: "right",
          fontSize: 12.5,
          fontWeight: 700,
          color: "var(--text-1)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {valueLabel ?? value}
      </div>
    </div>
  );
}

/** Lista de barras horizontales (reemplaza los MiniBars locales de los reportes). */
export function BarList({
  rows,
  color = "var(--accent)",
  max,
}: {
  rows: Array<{
    label: string;
    value: number;
    color?: string;
    hint?: ReactNode;
    valueLabel?: ReactNode;
  }>;
  color?: string;
  max?: number;
}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {rows.map((r, i) => (
        <BarRow
          key={i}
          label={r.label}
          value={r.value}
          max={m}
          color={r.color || color}
          hint={r.hint}
          valueLabel={r.valueLabel}
        />
      ))}
    </div>
  );
}

export interface FunnelStage {
  label: string;
  value: number;
  color?: string;
}

/**
 * Barras por etapa con ancho proporcional al MÁXIMO. La etiqueta derecha:
 *  - con `total` → el % del TOTAL (distribución; para etapas NO secuenciales como
 *    el pipeline de leads, donde cada lead está en UNA etapa y "retención vs
 *    anterior" daría valores absurdos como 2200%).
 *  - sin `total` → el % de retención vs la etapa anterior (embudo secuencial real).
 */
export function Funnel({
  stages,
  accent = "var(--green)",
  total,
}: {
  stages: FunnelStage[];
  accent?: string;
  /** Total de la población → la etiqueta derecha muestra el % del total. */
  total?: number;
}) {
  const top = stages.length ? Math.max(...stages.map((s) => s.value), 1) : 1;
  const useShare = total != null && total > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {stages.map((s, i) => {
        const w = Math.max(4, Math.round((s.value / top) * 100));
        const prev = i > 0 ? stages[i - 1].value : null;
        const rightPct = useShare
          ? Math.round((s.value / total!) * 100)
          : prev && prev > 0
            ? Math.round((s.value / prev) * 100)
            : null;
        const color = s.color || accent;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 128,
                flex: "0 0 auto",
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--text-1)",
              }}
              className="trunc"
              title={s.label}
            >
              {s.label}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  width: `${w}%`,
                  minWidth: 40,
                  height: 26,
                  borderRadius: 8,
                  background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 70%, transparent))`,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 10,
                  color: "#fff",
                  fontSize: 12.5,
                  fontWeight: 750,
                  fontVariantNumeric: "tabular-nums",
                  transition: "width .5s cubic-bezier(.22,1,.36,1)",
                }}
              >
                {s.value}
              </div>
            </div>
            <div
              style={{
                width: 48,
                flex: "0 0 auto",
                textAlign: "right",
                fontSize: 11,
                color: "var(--text-3)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {rightPct != null ? `${rightPct}%` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
