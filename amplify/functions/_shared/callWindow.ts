/**
 * Ventana de atención de una campaña — fuente ÚNICA en el backend.
 *
 * ESPEJO de `src/lib/callWindow.ts`. Si cambias las reglas (cruce de medianoche,
 * semántica de 24h, qué día "posee" el tramo nocturno) cambia los dos archivos,
 * o el banner del front dirá una cosa y el dialer hará otra.
 *
 * 🔑 Los Lambdas bundlean este archivo: tras editarlo hay que redesplegar
 *    `campaign-dialer` (y cualquier otro que lo importe) con
 *    `node scripts/deploy-lambda.mjs campaign-dialer`.
 */

export interface CallWindow {
  timezone?: string;
  windowStartHour?: number | string;
  windowEndHour?: number | string;
  /** JSON string de number[] tal como lo guarda DynamoDB. 0=Dom … 6=Sáb. */
  windowDaysOfWeek?: string | number[] | null;
}

const DEFAULT_TZ = "America/Lima";
const DEFAULT_DAYS = [1, 2, 3, 4, 5];

export function parseDays(value: CallWindow["windowDaysOfWeek"]): number[] {
  if (Array.isArray(value)) return value.map(Number).filter((d) => d >= 0 && d <= 6);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(Number).filter((d) => d >= 0 && d <= 6);
    } catch {
      /* cae al default */
    }
  }
  return [...DEFAULT_DAYS];
}

function startHour(w: CallWindow): number {
  const n = Number(w.windowStartHour ?? 9);
  return Number.isFinite(n) ? Math.min(23, Math.max(0, Math.trunc(n))) : 9;
}

/** 0-24. El 24 significa medianoche del día siguiente (ventana 24h con start 0). */
function endHour(w: CallWindow): number {
  const n = Number(w.windowEndHour ?? 18);
  return Number.isFinite(n) ? Math.min(24, Math.max(0, Math.trunc(n))) : 18;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * ¿La celda (día, hora) cae dentro de la ventana?
 *
 * Los días marcan el día en que la ventana ABRE. Con una ventana nocturna
 * 22→06 activa los lunes, el tramo 00:00-06:00 del martes pertenece a la sesión
 * que abrió el lunes; el martes por sí solo no habilita nada.
 */
export function isSlotActive(w: CallWindow, weekday: number, hour: number): boolean {
  const days = parseDays(w.windowDaysOfWeek);
  const start = startHour(w);
  const end = endHour(w);
  if (start === end) return days.includes(weekday); // 24 horas ese día
  if (start < end) return days.includes(weekday) && hour >= start && hour < end;
  // Ventana nocturna: cruza medianoche.
  if (hour >= start) return days.includes(weekday);
  return hour < end && days.includes((weekday + 6) % 7);
}

/**
 * ¿Se puede marcar en este instante?
 *
 * FAIL-OPEN deliberado: si la timezone es inválida o el runtime no resuelve el
 * día, devolvemos true. Preferimos marcar de más a dejar una campaña muerta sin
 * que nadie se entere. La supresión (_shared/suppression.ts) es la que corta de
 * verdad por quiet hours y DNC.
 */
export function isWithinWindow(w: CallWindow, at: Date = new Date()): boolean {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: w.timezone || DEFAULT_TZ,
      hour: "2-digit",
      // h23 y no `hour12:false`: en-US con hour12:false resuelve a h24 y las
      // 00:xx salen como "24" → toda campaña quedaba fuera de ventana entre
      // 00:00 y 00:59.
      hourCycle: "h23",
      weekday: "short",
    });
    const parts = fmt.formatToParts(at);
    const rawHour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const hour = rawHour === 24 ? 0 : rawHour; // cinturón por si ignora h23
    const weekday = WEEKDAY_MAP[parts.find((p) => p.type === "weekday")?.value || ""] ?? -1;
    if (weekday < 0) return true; // no se pudo determinar → ser permisivo
    return isSlotActive(w, weekday, hour);
  } catch {
    return true;
  }
}

/** "Lun a Vie 09:00–18:00 (America/Lima)" — para logs y mensajes de error. */
export function describeWindow(w: CallWindow): string {
  const days = parseDays(w.windowDaysOfWeek).join(",");
  return `days=[${days}] ${startHour(w)}:00-${endHour(w)}:00 ${w.timezone || DEFAULT_TZ}`;
}

// ── Programación con fecha y hora ────────────────────────────────────────────

export interface ScheduleValidation {
  ok: boolean;
  /** ISO 8601 en UTC, normalizado. Solo presente cuando ok. */
  iso?: string;
  error?: string;
}

/** Margen de gracia: una fecha hasta 2 min en el pasado se acepta como "ya". */
const PAST_GRACE_MS = 2 * 60 * 1000;

/**
 * Valida y normaliza una fecha/hora de arranque programado.
 *
 * Acepta cualquier string que `Date.parse` entienda; el front manda ISO con
 * offset del huso de la campaña (ej. "2026-08-01T09:00:00-05:00") para que no
 * haya ambigüedad, y acá se normaliza a UTC — que es lo único que se guarda.
 */
export function validateScheduledAt(
  value: unknown,
  opts: { now?: Date; maxDaysAhead?: number } = {},
): ScheduleValidation {
  if (value === null || value === undefined || value === "") {
    return { ok: false, error: "scheduledStartAt vacío" };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "scheduledStartAt debe ser un string ISO 8601" };
  }
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    return { ok: false, error: `Fecha inválida: ${value}` };
  }
  const now = opts.now ?? new Date();
  if (ts < now.getTime() - PAST_GRACE_MS) {
    return { ok: false, error: "La fecha de inicio está en el pasado" };
  }
  const maxDays = opts.maxDaysAhead ?? 365;
  if (ts > now.getTime() + maxDays * 24 * 3600 * 1000) {
    return { ok: false, error: `La fecha de inicio no puede superar ${maxDays} días` };
  }
  return { ok: true, iso: new Date(ts).toISOString() };
}

/** ¿Ya llegó el momento programado? Tolera valores vacíos o corruptos (→ false). */
export function isScheduleDue(scheduledStartAt?: string | null, now: Date = new Date()): boolean {
  if (!scheduledStartAt) return false;
  const ts = Date.parse(scheduledStartAt);
  if (Number.isNaN(ts)) return false;
  return ts <= now.getTime();
}

/** ¿La campaña ya pasó su fecha de fin de vigencia? */
export function isScheduleExpired(scheduledEndAt?: string | null, now: Date = new Date()): boolean {
  if (!scheduledEndAt) return false;
  const ts = Date.parse(scheduledEndAt);
  if (Number.isNaN(ts)) return false;
  return ts <= now.getTime();
}
