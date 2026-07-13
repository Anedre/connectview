import { useMemo, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import * as Icon from "@/components/vox/primitives";

interface Props {
  /** YYYY-MM-DD → message count, used to highlight days with activity. */
  daysWithActivity: Record<string, number>;
  /** Called with YYYY-MM-DD when the user picks a day. */
  onPick: (yyyyMmDd: string) => void;
}

const MONTHS_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const DOW_ES = ["L", "M", "M", "J", "V", "S", "D"];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Returns a YYYY-MM-DD string for the given (year, month0, day) tuple in
 * the local timezone. We deliberately don't go through Date.toISOString()
 * because that converts to UTC and shifts days for users east of GMT.
 */
function ymd(year: number, month0: number, day: number): string {
  return `${year}-${pad(month0 + 1)}-${pad(day)}`;
}

/**
 * Build the grid of cells for the given month, anchored on Monday. Each cell
 * is null for blank spaces or a day number 1..N. We pad to multiples of 7.
 */
function monthGrid(year: number, month0: number): Array<number | null> {
  const first = new Date(year, month0, 1);
  // 0 = Sunday in JS. Map to 0=Mon, 1=Tue, ..., 6=Sun.
  const dowMonStart = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const cells: Array<number | null> = [];
  for (let i = 0; i < dowMonStart; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function ThreadDatePicker({ daysWithActivity, onPick }: Props) {
  const today = new Date();
  const [view, setView] = useState({
    year: today.getFullYear(),
    month0: today.getMonth(),
  });
  const [open, setOpen] = useState(false);

  // Total messages across all activity — used to scale dot intensity per day.
  const maxPerDay = useMemo(() => {
    let m = 1;
    for (const c of Object.values(daysWithActivity)) {
      if (c > m) m = c;
    }
    return m;
  }, [daysWithActivity]);

  // Build a quick lookup for "any activity in this month" so we can hint the
  // user with a count in the header.
  const activityInMonth = useMemo(() => {
    let n = 0;
    const prefix = `${view.year}-${pad(view.month0 + 1)}`;
    for (const [k, c] of Object.entries(daysWithActivity)) {
      if (k.startsWith(prefix)) n += c;
    }
    return n;
  }, [daysWithActivity, view]);

  const cells = useMemo(() => monthGrid(view.year, view.month0), [view]);

  const goPrev = () => {
    setView((v) => {
      const m = v.month0 - 1;
      return m < 0 ? { year: v.year - 1, month0: 11 } : { year: v.year, month0: m };
    });
  };
  const goNext = () => {
    setView((v) => {
      const m = v.month0 + 1;
      return m > 11 ? { year: v.year + 1, month0: 0 } : { year: v.year, month0: m };
    });
  };

  // Jump straight to the most recent month with activity.
  const goLatest = () => {
    const days = Object.keys(daysWithActivity).sort();
    if (days.length === 0) return;
    const latest = days[days.length - 1];
    const [y, m] = latest.split("-").map(Number);
    setView({ year: y, month0: m - 1 });
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={(props) => (
          <button
            {...props}
            className="btn btn--ghost btn--sm"
            title="Saltar a fecha"
            aria-label="Calendario"
          >
            <Icon.Calendar size={13} />
            <span style={{ marginLeft: 6, fontSize: 12 }}>Calendario</span>
          </button>
        )}
      />
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} side="bottom" align="end">
          <Popover.Popup
            style={{
              background: "var(--bg-1)",
              border: "1px solid var(--border-1)",
              borderRadius: 10,
              padding: 12,
              width: 280,
              boxShadow: "0 8px 24px rgba(0,0,0,.18)",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <button
                onClick={goPrev}
                className="btn btn--ghost btn--sm btn--icon"
                aria-label="Mes anterior"
                style={{ fontSize: 14, lineHeight: 1 }}
              >
                ‹
              </button>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                {MONTHS_ES[view.month0]} {view.year}
                {activityInMonth > 0 && (
                  <span className="muted" style={{ marginLeft: 6, fontSize: 11, fontWeight: 400 }}>
                    · {activityInMonth} msj
                  </span>
                )}
              </div>
              <button
                onClick={goNext}
                className="btn btn--ghost btn--sm btn--icon"
                aria-label="Mes siguiente"
                style={{ fontSize: 14, lineHeight: 1 }}
              >
                ›
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 2,
                marginBottom: 4,
              }}
            >
              {DOW_ES.map((d, i) => (
                <div
                  key={i}
                  className="muted"
                  style={{
                    fontSize: 10,
                    textAlign: "center",
                    padding: "2px 0",
                  }}
                >
                  {d}
                </div>
              ))}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 2,
              }}
            >
              {cells.map((day, i) => {
                if (day == null) return <div key={i} />;
                const k = ymd(view.year, view.month0, day);
                const count = daysWithActivity[k] || 0;
                const hasActivity = count > 0;
                const isToday =
                  today.getFullYear() === view.year &&
                  today.getMonth() === view.month0 &&
                  today.getDate() === day;
                // Dot opacity scales 0.3 → 1 based on relative density.
                const opacity = hasActivity ? 0.3 + 0.7 * Math.min(1, count / maxPerDay) : 0;
                return (
                  <button
                    key={i}
                    onClick={() => {
                      if (hasActivity) {
                        onPick(k);
                        setOpen(false);
                      }
                    }}
                    disabled={!hasActivity}
                    title={
                      hasActivity ? `${count} mensaje${count === 1 ? "" : "s"}` : "Sin actividad"
                    }
                    style={{
                      position: "relative",
                      aspectRatio: "1",
                      borderRadius: 6,
                      border: isToday ? "1.5px solid var(--accent-amber)" : "1px solid transparent",
                      background: hasActivity ? "var(--bg-2)" : "transparent",
                      color: hasActivity ? "var(--text-1)" : "var(--text-3)",
                      fontSize: 11.5,
                      cursor: hasActivity ? "pointer" : "default",
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {day}
                    {hasActivity && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: 2,
                          left: "50%",
                          transform: "translateX(-50%)",
                          width: 4,
                          height: 4,
                          borderRadius: "50%",
                          background: "var(--accent-green)",
                          opacity,
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={goLatest}
              className="btn btn--ghost btn--sm"
              style={{ marginTop: 8, width: "100%", fontSize: 11.5 }}
            >
              Saltar a último mes con actividad
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
