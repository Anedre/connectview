import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Link2 } from "lucide-react";
import {
  DAY_LABELS,
  DAY_LABELS_LONG,
  formatRelative,
  isHourActive,
  isScheduleEmpty,
  isWithinSchedule,
  nextScheduleChange,
  scheduleFromWindow,
  weeklyScheduleHours,
  zonedNow,
  type WeeklySchedule,
} from "@/lib/callWindow";
import "@/styles/call-window.css";

interface Props {
  /** Horario a mostrar. Puede venir de Connect o de la ventana manual. */
  schedule: WeeklySchedule;
  /**
   * Si viene, los días son editables haciendo click en su etiqueta. Solo tiene
   * sentido con un horario manual: los de Connect se editan en Connect.
   */
  onDaysChange?: (days: number[]) => void;
  /** ISO del arranque programado. Se pinta en la grilla si cae dentro de 7 días. */
  scheduledStartAt?: string | null;
  compact?: boolean;
}

/** Etiquetas de la escala horaria: cada 3 h para que no se amontonen. */
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];

/** Días con al menos una franja, para pintar la etiqueta como activa. */
function activeDays(schedule: WeeklySchedule): Set<number> {
  return new Set(schedule.intervals.map((iv) => iv.day));
}

/** "09:00–13:00, 15:00–18:00" — las franjas de un día, para el tooltip. */
function describeDay(schedule: WeeklySchedule, day: number): string {
  const franjas = schedule.intervals
    .filter((iv) => iv.day === day)
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .map((iv) => `${fmt(iv.startMinutes)}–${fmt(iv.endMinutes)}`);
  return franjas.length ? franjas.join(", ") : "sin atención";
}

function fmt(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Resumen de una línea: agrupa los días que comparten las mismas franjas. */
function describeSchedule(schedule: WeeklySchedule): string {
  if (isScheduleEmpty(schedule)) return "Sin días de atención";
  const porDia = new Map<string, number[]>();
  for (let d = 0; d < 7; d++) {
    const key = describeDay(schedule, d);
    if (key === "sin atención") continue;
    porDia.set(key, [...(porDia.get(key) || []), d]);
  }
  return [...porDia.entries()]
    .map(([franjas, dias]) => `${agruparDias(dias)} ${franjas}`)
    .join(" · ");
}

/** [1,2,3,4,5] → "Lun a Vie"; [1,3] → "Lun, Mié". */
function agruparDias(dias: number[]): string {
  if (dias.length === 7) return "Todos los días";
  const runs: number[][] = [];
  for (const d of [...dias].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && d === last[last.length - 1] + 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((run) =>
      run.length >= 3
        ? `${DAY_LABELS[run[0]]} a ${DAY_LABELS[run[run.length - 1]]}`
        : run.map((d) => DAY_LABELS[d]).join(", "),
    )
    .join(", ");
}

/**
 * Visualizador del horario de atención de una campaña.
 *
 * Muestra la semana completa (7 días × 24 h), en qué franjas el dialer puede
 * marcar, dónde cae "ahora" en el huso del horario y cuánto falta para el
 * próximo cambio. Soporta varias franjas por día, que es lo que hace falta para
 * representar un Hours of Operation de Connect con corte de almuerzo.
 *
 * La lógica sale entera de `@/lib/callWindow` — no reimplementar acá.
 */
export function BusinessHoursPreview({
  schedule,
  onDaysChange,
  scheduledStartAt,
  compact = false,
}: Props) {
  // Reloj propio: el horario se evalúa contra el minuto en curso, así que hay
  // que re-renderizar solo. 30 s alcanza para que el borde se note.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const empty = isScheduleEmpty(schedule);
  const open = !empty && isWithinSchedule(schedule, now);
  const change = useMemo(() => nextScheduleChange(schedule, now), [schedule, now]);
  const local = zonedNow(schedule.timezone, now);
  const hours = useMemo(() => weeklyScheduleHours(schedule), [schedule]);
  const dias = useMemo(() => activeDays(schedule), [schedule]);
  const fromConnect = schedule.source === "connect";
  // Una franja que cruza medianoche merece explicación: su cola cae en el día
  // siguiente y eso confunde al leer la grilla.
  const cruzaMedianoche = schedule.intervals.some((iv) => iv.endMinutes < iv.startMinutes);

  // Celda que ocupa el arranque programado, solo si cae dentro de la semana
  // visible (más allá de eso la grilla genérica engañaría más de lo que ayuda).
  const scheduledSlot = useMemo(() => {
    if (!scheduledStartAt) return null;
    const ts = Date.parse(scheduledStartAt);
    if (Number.isNaN(ts)) return null;
    const diff = ts - now.getTime();
    if (diff < 0 || diff > 7 * 24 * 3600 * 1000) return null;
    const z = zonedNow(schedule.timezone, new Date(ts));
    if (z.weekday < 0) return null;
    return { weekday: z.weekday, hour: z.hour };
  }, [scheduledStartAt, schedule.timezone, now]);

  const state = empty ? "empty" : open ? "open" : "closed";
  const toggleDay = (day: number) => {
    if (!onDaysChange) return;
    const set = new Set(dias);
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
              {schedule.timezone.split("/")[1]?.replace(/_/g, " ") || schedule.timezone}
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
          const dayOn = dias.has(day);
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
                <span className="cw-day" data-on={dayOn} title={describeDay(schedule, day)}>
                  {label}
                </span>
              )}
              {Array.from({ length: 24 }, (_, hour) => {
                const active = isHourActive(schedule, day, hour);
                const isNow = local.weekday === day && local.hour === hour;
                const isScheduled = scheduledSlot?.weekday === day && scheduledSlot?.hour === hour;
                return (
                  <div
                    key={hour}
                    className="cw-cell"
                    data-active={active}
                    data-now={isNow || undefined}
                    data-scheduled={isScheduled || undefined}
                    title={`${DAY_LABELS_LONG[day]} · ${describeDay(schedule, day)}${
                      isScheduled ? " · inicio programado" : ""
                    }`}
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
            No hay ninguna franja de atención, así que la campaña <strong>nunca va a marcar</strong>
            .
            {fromConnect
              ? " Revisa el horario en Amazon Connect."
              : onDaysChange
                ? " Elige al menos un día haciendo click en su etiqueta."
                : ""}
          </span>
        </div>
      ) : cruzaMedianoche ? (
        <div className="cw-warn">
          <Clock size={13} style={{ flex: "0 0 auto", marginTop: 1 }} />
          <span>
            Horario nocturno: alguna franja cruza medianoche. El tramo después de las 00:00
            pertenece al día en que abrió.
          </span>
        </div>
      ) : null}

      <div className="cw-foot">
        <span className="cw-summary">{describeSchedule(schedule)}</span>
        <span>{hours} h/semana</span>
        {fromConnect ? (
          <span className="cw-legend" title="Definido en Amazon Connect, no en ARIA">
            <Link2 size={10} /> {schedule.hoursOfOperationName || "Amazon Connect"}
          </span>
        ) : (
          <>
            <span className="cw-legend">
              <span className="cw-swatch" data-kind="active" /> Atiende
            </span>
            <span className="cw-legend">
              <span className="cw-swatch" data-kind="off" /> Cerrado
            </span>
          </>
        )}
        {scheduledSlot && (
          <span className="cw-legend">
            <span className="cw-swatch" data-kind="scheduled" /> Inicio programado
          </span>
        )}
      </div>
    </div>
  );
}

/** Atajo para las pantallas que todavía manejan la ventana manual. */
export function windowSchedule(
  timezone: string,
  windowStartHour: number,
  windowEndHour: number,
  windowDaysOfWeek: number[],
): WeeklySchedule {
  return scheduleFromWindow({ timezone, windowStartHour, windowEndHour, windowDaysOfWeek });
}

export default BusinessHoursPreview;
