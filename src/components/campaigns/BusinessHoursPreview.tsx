import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import {
  DAY_LABELS,
  DAY_LABELS_LONG,
  describeWindow,
  formatRelative,
  isSlotActive,
  isWindowEmpty,
  isWithinWindow,
  nextWindowChange,
  weeklyActiveHours,
  zonedNow,
  type CallWindow,
} from "@/lib/callWindow";
import "@/styles/call-window.css";

interface Props {
  timezone: string;
  windowStartHour: number;
  windowEndHour: number;
  windowDaysOfWeek: number[];
  /** Si viene, los días son editables haciendo click en la etiqueta del día. */
  onDaysChange?: (days: number[]) => void;
  /** ISO del arranque programado. Se pinta en la grilla si cae dentro de 7 días. */
  scheduledStartAt?: string | null;
  compact?: boolean;
}

/** Etiquetas de la escala horaria: cada 3 h para que no se amontonen. */
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];

/**
 * Visualizador del horario de atención de una campaña.
 *
 * Muestra la semana completa (7 días × 24 h), en qué franjas el dialer puede
 * marcar, dónde cae "ahora" en el huso de la campaña y cuánto falta para el
 * próximo cambio de estado. La lógica de ventana sale entera de
 * `@/lib/callWindow` — no reimplementar acá.
 */
export function BusinessHoursPreview({
  timezone,
  windowStartHour,
  windowEndHour,
  windowDaysOfWeek,
  onDaysChange,
  scheduledStartAt,
  compact = false,
}: Props) {
  // Reloj propio: la ventana se evalúa contra el minuto en curso, así que hay
  // que re-renderizar solo. 30 s alcanza para que el borde de hora se note.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const win: CallWindow = useMemo(
    () => ({ timezone, windowStartHour, windowEndHour, windowDaysOfWeek }),
    [timezone, windowStartHour, windowEndHour, windowDaysOfWeek],
  );

  const empty = isWindowEmpty(win);
  const open = !empty && isWithinWindow(win, now);
  const change = useMemo(() => nextWindowChange(win, now), [win, now]);
  const local = zonedNow(timezone, now);
  const hours = weeklyActiveHours(win);

  // Celda que ocupa el arranque programado, solo si cae dentro de la semana
  // visible (más allá de eso la grilla genérica engañaría más de lo que ayuda).
  const scheduledSlot = useMemo(() => {
    if (!scheduledStartAt) return null;
    const ts = Date.parse(scheduledStartAt);
    if (Number.isNaN(ts)) return null;
    const diff = ts - now.getTime();
    if (diff < 0 || diff > 7 * 24 * 3600 * 1000) return null;
    const z = zonedNow(timezone, new Date(ts));
    if (z.weekday < 0) return null;
    return { weekday: z.weekday, hour: z.hour };
  }, [scheduledStartAt, timezone, now]);

  const state = empty ? "empty" : open ? "open" : "closed";
  const toggleDay = (day: number) => {
    if (!onDaysChange) return;
    const set = new Set(windowDaysOfWeek);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    onDaysChange([...set].sort((a, b) => a - b));
  };

  return (
    <div className="cw-root" data-state={state} data-compact={compact}>
      <div className="cw-head">
        <span className="cw-dot" aria-hidden="true" />
        <span className="cw-status">
          {empty
            ? "Sin días de atención"
            : open
              ? "Dentro del horario de atención"
              : "Fuera del horario de atención"}
        </span>
        <span className="cw-next">
          {local.hour >= 0 && (
            <span className="cw-clock">
              {String(local.hour).padStart(2, "0")}:{String(local.minute).padStart(2, "0")} ·{" "}
              {timezone.split("/")[1]?.replace(/_/g, " ") || timezone}
            </span>
          )}
          {change && (
            <>
              <br />
              {change.opens ? "Abre " : "Cierra "}
              {formatRelative(change.at, now)}
            </>
          )}
        </span>
      </div>

      <div className="cw-grid">
        <div className="cw-scale" aria-hidden="true">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h}>{HOUR_TICKS.includes(h) ? h : ""}</span>
          ))}
        </div>

        {DAY_LABELS.map((label, day) => {
          const dayOn = windowDaysOfWeek.includes(day);
          return (
            <div className="cw-row" key={day}>
              {onDaysChange ? (
                <button
                  type="button"
                  className="cw-day"
                  data-clickable="true"
                  data-on={dayOn}
                  onClick={() => toggleDay(day)}
                  aria-pressed={dayOn}
                  title={`${dayOn ? "Quitar" : "Agregar"} ${DAY_LABELS_LONG[day]}`}
                >
                  {label}
                </button>
              ) : (
                <span className="cw-day" data-on={dayOn}>
                  {label}
                </span>
              )}
              {Array.from({ length: 24 }, (_, hour) => {
                const active = isSlotActive(win, day, hour);
                const isNow = local.weekday === day && local.hour === hour;
                const isScheduled = scheduledSlot?.weekday === day && scheduledSlot?.hour === hour;
                return (
                  <div
                    key={hour}
                    className="cw-cell"
                    data-active={active}
                    data-now={isNow || undefined}
                    data-scheduled={isScheduled || undefined}
                    title={`${DAY_LABELS_LONG[day]} ${String(hour).padStart(2, "0")}:00 — ${
                      active ? "atiende" : "no atiende"
                    }${isScheduled ? " · inicio programado" : ""}`}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {empty ? (
        <div className="cw-warn">
          <AlertTriangle size={13} style={{ flex: "0 0 auto", marginTop: 1 }} />
          <span>
            No hay ningún día marcado, así que la campaña <strong>nunca va a marcar</strong>.
            {onDaysChange ? " Elige al menos un día haciendo click en su etiqueta." : ""}
          </span>
        </div>
      ) : windowStartHour > windowEndHour ? (
        <div className="cw-warn">
          <Clock size={13} style={{ flex: "0 0 auto", marginTop: 1 }} />
          <span>
            Horario nocturno: la ventana cruza medianoche. El tramo después de las 00:00 pertenece
            al día en que abrió.
          </span>
        </div>
      ) : null}

      <div className="cw-foot">
        <span className="cw-summary">{describeWindow(win)}</span>
        <span>{hours} h/semana</span>
        <span className="cw-legend">
          <span className="cw-swatch" data-kind="active" /> Atiende
        </span>
        <span className="cw-legend">
          <span className="cw-swatch" data-kind="off" /> Cerrado
        </span>
        {scheduledSlot && (
          <span className="cw-legend">
            <span className="cw-swatch" data-kind="scheduled" /> Inicio programado
          </span>
        )}
      </div>
    </div>
  );
}

export default BusinessHoursPreview;
