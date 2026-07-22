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

// ── Horario semanal como intervalos ─────────────────────────────────────────
//
// El modelo real es una lista de franjas, no una sola ventana diaria: el Hours
// of Operation de Amazon Connect admite VARIAS franjas por día (mañana y tarde,
// con corte de almuerzo en medio), y la ventana simple `start/end/días` es un
// caso particular de eso. Todo se evalúa contra esta representación; la ventana
// legacy se convierte con `scheduleFromWindow`.

export interface ScheduleInterval {
  /** Día en que la franja ABRE. 0=Dom … 6=Sáb. */
  day: number;
  /** Minutos desde medianoche, 0-1439. */
  startMinutes: number;
  /**
   * Minutos desde medianoche. Si es MENOR que `startMinutes`, la franja cruza
   * medianoche y termina al día siguiente. Si es IGUAL, dura 24 horas.
   */
  endMinutes: number;
}

export interface WeeklySchedule {
  timezone: string;
  intervals: ScheduleInterval[];
  /** De dónde salió: el Hours of Operation de Connect o la ventana manual. */
  source: "connect" | "manual";
  /** Solo con source "connect": identidad del horario en Connect. */
  hoursOfOperationId?: string;
  hoursOfOperationName?: string;
}

/** Días de Connect → índice 0-6. Connect los manda en inglés y en mayúsculas. */
const CONNECT_DAY_INDEX: Record<string, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

/** Forma que devuelve `DescribeHoursOfOperation` (solo lo que usamos). */
export interface ConnectHoursConfigEntry {
  Day?: string;
  StartTime?: { Hours?: number; Minutes?: number };
  EndTime?: { Hours?: number; Minutes?: number };
}

/**
 * Hours of Operation de Amazon Connect → horario semanal.
 *
 * Ojo con la convención de Connect para "todo el día": la consola suele grabar
 * 00:00–23:59, no 00:00–00:00. Se respeta tal cual (queda un minuto muerto a las
 * 23:59), porque inventar un redondeo haría que ARIA marque fuera del horario
 * que el cliente ve en su propia consola.
 */
export function scheduleFromConnectHours(
  config: ConnectHoursConfigEntry[] | undefined,
  timezone: string,
  meta: { id?: string; name?: string } = {},
): WeeklySchedule {
  const intervals: ScheduleInterval[] = [];
  for (const entry of config || []) {
    const day = CONNECT_DAY_INDEX[String(entry?.Day || "").toUpperCase()];
    if (day === undefined) continue;
    const startMinutes = clampMinutes(entry?.StartTime);
    const endMinutes = clampMinutes(entry?.EndTime);
    if (startMinutes === null || endMinutes === null) continue;
    intervals.push({ day, startMinutes, endMinutes });
  }
  return {
    timezone: timezone || DEFAULT_TZ,
    intervals,
    source: "connect",
    hoursOfOperationId: meta.id,
    hoursOfOperationName: meta.name,
  };
}

function clampMinutes(slice: { Hours?: number; Minutes?: number } | undefined): number | null {
  if (!slice) return null;
  const h = Number(slice.Hours ?? 0);
  const m = Number(slice.Minutes ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return Math.min(1440, Math.max(0, Math.trunc(h) * 60 + Math.trunc(m)));
}

/**
 * Ventana simple (start/end/días) → horario semanal equivalente.
 *
 * Con inicio == fin, la ventana manual significa "el día natural completo" (es
 * lo que espera quien escribe 9 y 9: sin restricción horaria ese día), no "24
 * horas contadas desde las 9". Por eso se emite como 00:00–24:00 y no como
 * start→start, que es la regla que sí aplica a los intervalos de Connect.
 */
export function scheduleFromWindow(w: CallWindow): WeeklySchedule {
  const days = parseDays(w.windowDaysOfWeek);
  const start = startHour(w) * 60;
  const end = endHour(w) * 60;
  const [startMinutes, endMinutes] = start === end ? [0, 1440] : [start, end];
  return {
    timezone: w.timezone || DEFAULT_TZ,
    intervals: days.map((day) => ({ day, startMinutes, endMinutes })),
    source: "manual",
  };
}

/** ¿La franja cubre ese (día, minuto)? Resuelve el cruce de medianoche. */
function intervalCovers(iv: ScheduleInterval, weekday: number, minutes: number): boolean {
  const prevDay = (weekday + 6) % 7;
  if (iv.endMinutes > iv.startMinutes) {
    // Franja normal, termina el mismo día.
    return weekday === iv.day && minutes >= iv.startMinutes && minutes < iv.endMinutes;
  }
  if (iv.endMinutes === iv.startMinutes) {
    // 24 horas contadas desde la hora de apertura.
    return (
      (weekday === iv.day && minutes >= iv.startMinutes) ||
      (prevDay === iv.day && minutes < iv.startMinutes)
    );
  }
  // Cruza medianoche: la cola pertenece al día en que la franja ABRIÓ.
  return (
    (weekday === iv.day && minutes >= iv.startMinutes) ||
    (prevDay === iv.day && minutes < iv.endMinutes)
  );
}

/** ¿Algún intervalo cubre ese (día, minuto)? */
export function isMinuteActive(
  schedule: WeeklySchedule,
  weekday: number,
  minutes: number,
): boolean {
  return schedule.intervals.some((iv) => intervalCovers(iv, weekday, minutes));
}

/**
 * ¿La CELDA de una hora está activa? Basta con que la franja solape algún minuto
 * de esa hora — un horario que abre 9:30 pinta la celda de las 9 como activa.
 */
export function isHourActive(schedule: WeeklySchedule, weekday: number, hour: number): boolean {
  const base = hour * 60;
  for (let m = base; m < base + 60; m++) {
    if (isMinuteActive(schedule, weekday, m)) return true;
  }
  return false;
}

/** Posición actual dentro de la semana, en el huso del horario. */
function zonedWeekPosition(
  timezone: string,
  at: Date,
): { weekday: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || DEFAULT_TZ,
      hour: "2-digit",
      minute: "2-digit",
      // h23 y no `hour12:false`: en-US con hour12:false resuelve a h24 y las
      // 00:xx salen como "24" → toda campaña quedaba fuera de ventana entre
      // 00:00 y 00:59.
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(at);
    const rawHour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const hour = rawHour === 24 ? 0 : rawHour; // cinturón por si ignora h23
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
    const weekday = WEEKDAY_MAP[parts.find((p) => p.type === "weekday")?.value || ""] ?? -1;
    if (weekday < 0) return null;
    return { weekday, minutes: hour * 60 + minute };
  } catch {
    return null;
  }
}

/**
 * ¿El horario está abierto en este instante?
 *
 * FAIL-OPEN deliberado si no se puede resolver el huso: preferimos marcar de más
 * a dejar una campaña muerta sin que nadie se entere. La supresión
 * (_shared/suppression.ts) es la que corta de verdad por quiet hours y DNC.
 *
 * Un horario SIN intervalos sí cierra: eso no es un fallo de resolución, es una
 * configuración que dice explícitamente "no se atiende nunca".
 */
export function isWithinSchedule(schedule: WeeklySchedule, at: Date = new Date()): boolean {
  const pos = zonedWeekPosition(schedule.timezone, at);
  if (!pos) return true;
  return isMinuteActive(schedule, pos.weekday, pos.minutes);
}

/**
 * ¿La celda (día, hora) cae dentro de la ventana?
 *
 * Los días marcan el día en que la ventana ABRE. Con una ventana nocturna
 * 22→06 activa los lunes, el tramo 00:00-06:00 del martes pertenece a la sesión
 * que abrió el lunes; el martes por sí solo no habilita nada.
 */
export function isSlotActive(w: CallWindow, weekday: number, hour: number): boolean {
  return isHourActive(scheduleFromWindow(w), weekday, hour);
}

/** ¿Se puede marcar en este instante, según la ventana simple? */
export function isWithinWindow(w: CallWindow, at: Date = new Date()): boolean {
  return isWithinSchedule(scheduleFromWindow(w), at);
}

/** "Lun a Vie 09:00–18:00 (America/Lima)" — para logs y mensajes de error. */
export function describeWindow(w: CallWindow): string {
  const days = parseDays(w.windowDaysOfWeek).join(",");
  return `days=[${days}] ${startHour(w)}:00-${endHour(w)}:00 ${w.timezone || DEFAULT_TZ}`;
}

/** Resumen compacto de un horario, para logs del dialer. */
export function describeSchedule(schedule: WeeklySchedule): string {
  const origen =
    schedule.source === "connect"
      ? `connect:${schedule.hoursOfOperationName || schedule.hoursOfOperationId || "?"}`
      : "manual";
  const franjas = schedule.intervals
    .slice()
    .sort((a, b) => a.day - b.day || a.startMinutes - b.startMinutes)
    .map((iv) => `${iv.day}:${fmtMin(iv.startMinutes)}-${fmtMin(iv.endMinutes)}`)
    .join(" ");
  return `${origen} [${franjas}] ${schedule.timezone}`;
}

function fmtMin(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Valida y normaliza un horario que llega de afuera (el respaldo que se guarda
 * junto al id del Hours of Operation).
 *
 * Se valida en serio en vez de confiar: el respaldo es lo que el dialer usa
 * cuando Connect no responde, así que un valor corrupto se traduce en llamadas
 * a horas indebidas. Ante cualquier duda devuelve null y el caller cae a la
 * ventana manual.
 */
export function parseScheduleSnapshot(raw: unknown): WeeklySchedule | null {
  if (!raw) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.timezone !== "string" || !o.timezone) return null;
  if (!Array.isArray(o.intervals)) return null;
  // Una semana no da para más franjas que horas: un valor mayor no es un
  // horario, es un intento de inflar el registro.
  if (o.intervals.length > 168) return null;
  const intervals: ScheduleInterval[] = [];
  for (const entry of o.intervals) {
    if (!entry || typeof entry !== "object") return null;
    const iv = entry as Record<string, unknown>;
    const day = Number(iv.day);
    const startMinutes = Number(iv.startMinutes);
    const endMinutes = Number(iv.endMinutes);
    if (!Number.isInteger(day) || day < 0 || day > 6) return null;
    if (!Number.isInteger(startMinutes) || startMinutes < 0 || startMinutes > 1440) return null;
    if (!Number.isInteger(endMinutes) || endMinutes < 0 || endMinutes > 1440) return null;
    intervals.push({ day, startMinutes, endMinutes });
  }
  return {
    timezone: o.timezone,
    intervals,
    source: "connect",
    hoursOfOperationId: typeof o.hoursOfOperationId === "string" ? o.hoursOfOperationId : undefined,
    hoursOfOperationName:
      typeof o.hoursOfOperationName === "string" ? o.hoursOfOperationName : undefined,
  };
}

/** Serializa un horario para guardarlo. */
export function serializeSchedule(schedule: WeeklySchedule): string {
  return JSON.stringify({
    timezone: schedule.timezone,
    intervals: schedule.intervals,
    hoursOfOperationId: schedule.hoursOfOperationId,
    hoursOfOperationName: schedule.hoursOfOperationName,
  });
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
