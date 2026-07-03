/* ============================================================
   ARIA · Cockpit primitives  ·  Wave / Senti / Net
   Portados de aria-agent.jsx. Se comparten entre el MODO DEMO y
   el rediseño en-llamada REAL. Usan clases CSS ya existentes
   (.wave .smeter .netbars) — no agregan CSS.
   ============================================================ */
import { CY_STEP, WAVE_BARS } from "./constants";

/** Barras de audio del CallBar.
 *  - `levels` (0..1 por barra) → ondas REALES: la altura sigue el volumen del
 *    micrófono del agente en vivo (sube al hablar/gritar).
 *  - sin `levels` → animación decorativa por CSS (`on`=hay audio, si no 45%). */
export function Wave({ on, levels }: { on: boolean; levels?: number[] }) {
  const lv = levels && levels.length > 0 ? levels : null;
  return (
    <div className="wave" aria-hidden="true">
      {WAVE_BARS.map((_, i) => {
        const level = lv ? lv[i] ?? 0 : null;
        return (
          <i
            key={i}
            style={{
              height: level != null ? `${Math.round(14 + level * 86)}%` : on ? undefined : "45%",
              animation: level != null ? "none" : undefined,
              animationDelay: i * 0.06 + "s",
              background: i % CY_STEP === 0 ? "var(--cyan)" : "var(--accent)",
              transition: level != null ? "height .09s ease-out" : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

/** Barras de señal HD (estáticas). */
export function Net() {
  const bars = [6, 9, 12, 15];
  return (
    <div className="netbars" aria-hidden="true">
      {bars.map((h, i) => (
        <i
          key={i}
          style={{
            height: h,
            background:
              i < 3
                ? "var(--green)"
                : "color-mix(in srgb,var(--green) 30%,var(--bg-3))",
          }}
        />
      ))}
    </div>
  );
}

/** Medidor de sentiment en vivo. `val` en 0..100. */
export function Senti({ val }: { val: number }) {
  const clamped = Math.max(0, Math.min(100, val));
  return (
    <div className="smeter" aria-hidden="true">
      <i style={{ left: clamped + "%" }} />
    </div>
  );
}
