import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/aria";

/**
 * DateRangePicker — selector de rango de fechas con dos meses lado a lado +
 * presets rápidos (hoy, ayer, últimos 7/14/30, este mes, mes pasado), estilo
 * "calendario personalizado" de los competidores. Devuelve el rango elegido al
 * aplicar. Los días futuros quedan deshabilitados (los reportes son históricos).
 */

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
const fmtShort = (d: Date) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

/** 42 celdas (6 semanas, lunes primero) para el mes year/month. */
function monthCells(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7; // Lu=0
  const out: Date[] = [];
  for (let i = 0; i < 42; i++) out.push(new Date(year, month, 1 - firstWeekday + i));
  return out;
}

/** Rangos preset relativos a hoy. */
function presets(): { id: string; label: string; range: () => DateRange }[] {
  const now = new Date();
  const mk = (start: Date, end: Date, label: string): DateRange => ({
    start: startOfDay(start),
    end: endOfDay(end),
    label,
  });
  return [
    { id: "today", label: "Hoy", range: () => mk(now, now, "Hoy") },
    {
      id: "yesterday",
      label: "Ayer",
      range: () => {
        const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        return mk(y, y, "Ayer");
      },
    },
    {
      id: "7d",
      label: "Últimos 7 días",
      range: () =>
        mk(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6), now, "Últimos 7 días"),
    },
    {
      id: "14d",
      label: "Últimos 14 días",
      range: () =>
        mk(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13), now, "Últimos 14 días"),
    },
    {
      id: "30d",
      label: "Últimos 30 días",
      range: () =>
        mk(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29), now, "Últimos 30 días"),
    },
    {
      id: "month",
      label: "Este mes",
      range: () => mk(new Date(now.getFullYear(), now.getMonth(), 1), now, "Este mes"),
    },
    {
      id: "prevmonth",
      label: "Mes pasado",
      range: () => {
        const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const e = new Date(now.getFullYear(), now.getMonth(), 0);
        return mk(s, e, "Mes pasado");
      },
    },
  ];
}

function MonthGrid({
  year,
  month,
  selStart,
  selEnd,
  hover,
  onPick,
  onHover,
}: {
  year: number;
  month: number;
  selStart: Date | null;
  selEnd: Date | null;
  hover: Date | null;
  onPick: (d: Date) => void;
  onHover: (d: Date | null) => void;
}) {
  const today = startOfDay(new Date());
  const cells = monthCells(year, month);
  // Rango efectivo para pintar (usa hover mientras se elige el fin).
  const rEnd = selEnd || (selStart && hover ? hover : null);
  const lo = selStart && rEnd ? (selStart < rEnd ? selStart : rEnd) : selStart;
  const hi = selStart && rEnd ? (selStart < rEnd ? rEnd : selStart) : selStart;

  return (
    <div style={{ flex: "0 0 auto" }}>
      <div
        style={{
          textAlign: "center",
          fontSize: 12.5,
          fontWeight: 700,
          marginBottom: 8,
          textTransform: "capitalize",
        }}
      >
        {MONTHS[month]} {year}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 30px)", gap: 2 }}>
        {WEEKDAYS.map((w, i) => (
          <div
            key={i}
            style={{
              textAlign: "center",
              fontSize: 10,
              color: "var(--text-3)",
              fontWeight: 600,
              paddingBottom: 2,
            }}
          >
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const future = d > today;
          const disabled = future || !inMonth;
          const isStart = selStart && sameDay(d, selStart);
          const isEnd = selEnd && sameDay(d, selEnd);
          const inRange = lo && hi && d >= startOfDay(lo) && d <= startOfDay(hi);
          const isEndpoint = isStart || isEnd;
          const isToday = sameDay(d, today);
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onMouseEnter={() => !disabled && onHover(d)}
              onClick={() => !disabled && onPick(d)}
              style={{
                height: 30,
                borderRadius: 7,
                border: "none",
                cursor: disabled ? "default" : "pointer",
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
                fontWeight: isEndpoint ? 700 : 500,
                color: disabled
                  ? "var(--border-2)"
                  : isEndpoint
                    ? "#fff"
                    : inRange
                      ? "var(--accent)"
                      : "var(--text-1)",
                background: isEndpoint
                  ? "var(--accent)"
                  : inRange
                    ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                    : "transparent",
                boxShadow: isToday && !isEndpoint ? "inset 0 0 0 1px var(--border-2)" : "none",
                opacity: !inMonth ? 0 : 1,
                pointerEvents: !inMonth ? "none" : undefined,
              }}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => addMonths(value.end, -1));
  const [selStart, setSelStart] = useState<Date | null>(value.start);
  const [selEnd, setSelEnd] = useState<Date | null>(value.end);
  const [hover, setHover] = useState<Date | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Al abrir, sincroniza la selección con el valor actual (en el handler, sin efecto).
  const openPicker = () => {
    setSelStart(value.start);
    setSelEnd(value.end);
    setView(addMonths(value.end, -1));
    setHover(null);
    setOpen(true);
  };

  const presetList = useMemo(() => presets(), []);
  const activePresetId = presetList.find((p) => p.range().label === value.label)?.id;

  const pick = (d: Date) => {
    if (!selStart || (selStart && selEnd)) {
      setSelStart(d);
      setSelEnd(null);
    } else {
      // segundo clic → ordena el rango
      if (d < selStart) {
        setSelEnd(selStart);
        setSelStart(d);
      } else {
        setSelEnd(d);
      }
    }
  };

  const applyPreset = (p: (typeof presetList)[number]) => {
    onChange(p.range());
    setOpen(false);
  };

  const applyCustom = () => {
    if (!selStart) return;
    const s = startOfDay(selStart);
    const e = endOfDay(selEnd || selStart);
    onChange({ start: s, end: e, label: `${fmtShort(s)} – ${fmtShort(e)}` });
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: "0 0 auto" }}>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => (open ? setOpen(false) : openPicker())}
        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
      >
        <Icon name="calendar" size={14} />
        {value.label}
        <Icon name="chevD" size={13} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              zIndex: 61,
              background: "var(--bg-1)",
              border: "1px solid var(--border-2)",
              borderRadius: 14,
              boxShadow: "var(--shadow-pop, 0 20px 50px -12px rgba(0,0,0,0.3))",
              display: "flex",
              overflow: "hidden",
            }}
          >
            {/* Presets */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: 10,
                borderRight: "1px solid var(--border-1)",
                background: "var(--bg-2)",
                minWidth: 148,
              }}
            >
              {presetList.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  style={{
                    textAlign: "left",
                    padding: "7px 10px",
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12.5,
                    fontWeight: activePresetId === p.id ? 700 : 500,
                    color: activePresetId === p.id ? "var(--accent)" : "var(--text-2)",
                    background:
                      activePresetId === p.id
                        ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                        : "transparent",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Calendarios */}
            <div style={{ padding: 14 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setView(addMonths(view, -1))}
                  aria-label="Mes anterior"
                  style={navBtn}
                >
                  <Icon name="chevL" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setView(addMonths(view, 1))}
                  aria-label="Mes siguiente"
                  style={navBtn}
                >
                  <Icon name="chevR" size={16} />
                </button>
              </div>
              <div style={{ display: "flex", gap: 22 }} onMouseLeave={() => setHover(null)}>
                <MonthGrid
                  year={view.getFullYear()}
                  month={view.getMonth()}
                  selStart={selStart}
                  selEnd={selEnd}
                  hover={hover}
                  onPick={pick}
                  onHover={setHover}
                />
                <MonthGrid
                  year={addMonths(view, 1).getFullYear()}
                  month={addMonths(view, 1).getMonth()}
                  selStart={selStart}
                  selEnd={selEnd}
                  hover={hover}
                  onPick={pick}
                  onHover={setHover}
                />
              </div>

              {/* Footer: rango elegido + aplicar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px solid var(--border-1)",
                }}
              >
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--text-2)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {selStart ? fmtShort(selStart) : "—"}{" "}
                  <span style={{ color: "var(--text-3)" }}>→</span>{" "}
                  {selEnd ? fmtShort(selEnd) : selStart ? "…" : "—"}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn btn--sm" onClick={() => setOpen(false)}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--primary"
                    onClick={applyCustom}
                    disabled={!selStart}
                  >
                    Aplicar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  border: "1px solid var(--border-1)",
  borderRadius: 8,
  background: "var(--bg-1)",
  cursor: "pointer",
  color: "var(--text-2)",
};
