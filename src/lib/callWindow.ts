/**
 * Ventana de atención de una campaña — fuente ÚNICA en el frontend.
 *
 * Antes esta lógica estaba copiada dentro de CampaignDetailPage y arrastraba el
 * bug de medianoche que el backend ya había corregido (`hour12:false` en en-US
 * resuelve a hourCycle "h24", donde 00:xx se formatea como "24"). Cualquier
 * pantalla que necesite saber si una campaña puede marcar AHORA debe importar
 * de acá.
 *
 * ESPEJO de `amplify/functions/_shared/callWindow.ts`. Si cambias las reglas
 * (cruce de medianoche, semántica de 24h, días permitidos) cambia los dos, o el
 * banner del front dirá una cosa y el dialer hará otra.
 */

export interface CallWindow {
  timezone?: string;
  windowStartHour?: number;
  windowEndHour?: number;
  /** number[] o el JSON string que guarda DynamoDB. 0=Dom … 6=Sáb. */
  windowDaysOfWeek?: number[] | string | null;
}

export const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;
export const DAY_LABELS_LONG = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

export const DEFAULT_WINDOW: Required<Omit<CallWindow, "windowDaysOfWeek">> & {
  windowDaysOfWeek: number[];
} = {
  timezone: "America/Lima",
  windowStartHour: 9,
  windowEndHour: 18,
  windowDaysOfWeek: [1, 2, 3, 4, 5],
};

/** Acepta number[], JSON string o null. Nunca lanza: cae al default L-V. */
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
  return [...DEFAULT_WINDOW.windowDaysOfWeek];
}

/** Hora de inicio normalizada a 0-23. */
function startHour(w: CallWindow): number {
  const n = Number(w.windowStartHour ?? DEFAULT_WINDOW.windowStartHour);
  return Number.isFinite(n) ? Math.min(23, Math.max(0, Math.trunc(n))) : 9;
}

/**
 * Hora de fin normalizada a 0-24. El 24 es legal y significa medianoche del día
 * siguiente: es lo que escribe el botón "Discar ahora (24h)" del detalle.
 */
function endHour(w: CallWindow): number {
  const n = Number(w.windowEndHour ?? DEFAULT_WINDOW.windowEndHour);
  return Number.isFinite(n) ? Math.min(24, Math.max(0, Math.trunc(n))) : 18;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function zonedFormat(timezone: string): Intl.DateTimeFormat {
  const cached = fmtCache.get(timezone);
  if (cached) return cached;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    // h23 y no `hour12:false`: en-US con hour12:false resuelve a h24 y las
    // 00:xx salen como "24", que rompe toda comparación con la hora de fin.
    hourCycle: "h23",
    weekday: "short",
  });
  fmtCache.set(timezone, fmt);
  return fmt;
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

export interface ZonedNow {
  hour: number;
  minute: number;
  weekday: number;
}

/** Hora local del huso de la campaña. `weekday` -1 si el runtime no la resuelve. */
export function zonedNow(timezone: string, at: Date = new Date()): ZonedNow {
  try {
    const parts = zonedFormat(timezone || DEFAULT_WINDOW.timezone).formatToParts(at);
    const rawHour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    return {
      // Cinturón por si el runtime ignora hourCycle y devuelve 24 igual.
      hour: rawHour === 24 ? 0 : rawHour,
      minute: parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10),
      weekday: WEEKDAY_MAP[parts.find((p) => p.type === "weekday")?.value || ""] ?? -1,
    };
  } catch {
    return { hour: -1, minute: 0, weekday: -1 };
  }
}

// ── Horario semanal como intervalos ─────────────────────────────────────────
//
// El modelo real es una lista de franjas, no una sola ventana diaria: el Hours
// of Operation de Amazon Connect admite VARIAS franjas por día (mañana y tarde,
// con corte de almuerzo en medio), y la ventana simple `start/end/días` es un
// caso particular de eso. Todo se evalúa contra esta representación.

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

/** Franja sin día: se usa dentro de las excepciones por fecha. */
export interface TimeRange {
  startMinutes: number;
  endMinutes: number;
}

export interface WeeklySchedule {
  timezone: string;
  /** Patrón semanal. Es el que rige salvo que la fecha tenga excepción. */
  intervals: ScheduleInterval[];
  /** De dónde salió: el Hours of Operation de Connect o la ventana manual. */
  source: "connect" | "manual";
  /** Solo con source "connect": identidad del horario en Connect. */
  hoursOfOperationId?: string;
  hoursOfOperationName?: string;
  /**
   * Horario EFECTIVO por fecha (`"2026-07-28"` → franjas), tal como lo devuelve
   * `GetEffectiveHoursOfOperations`. Manda sobre el patrón semanal para las
   * fechas presentes, y es lo que hace que se respeten los **feriados** que el
   * cliente configura en Connect como overrides.
   *
   * Una fecha con lista VACÍA significa cerrado todo ese día — es exactamente
   * cómo se ve un feriado, y por eso no se puede tratar como "sin dato".
   */
  overrides?: Record<string, TimeRange[]>;
}

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

function clampMinutes(slice: { Hours?: number; Minutes?: number } | undefined): number | null {
  if (!slice) return null;
  const h = Number(slice.Hours ?? 0);
  const m = Number(slice.Minutes ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return Math.min(1440, Math.max(0, Math.trunc(h) * 60 + Math.trunc(m)));
}

/**
 * Hours of Operation de Amazon Connect → horario semanal.
 *
 * Ojo con la convención de Connect para "todo el día": la consola suele grabar
 * 00:00–23:59, no 00:00–00:00. Se respeta tal cual, porque inventar un redondeo
 * haría que ARIA marque fuera del horario que el cliente ve en su consola.
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
    timezone: timezone || DEFAULT_WINDOW.timezone,
    intervals,
    source: "connect",
    hoursOfOperationId: meta.id,
    hoursOfOperationName: meta.name,
  };
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
    timezone: w.timezone || DEFAULT_WINDOW.timezone,
    intervals: days.map((day) => ({ day, startMinutes, endMinutes })),
    source: "manual",
  };
}

/** ¿La franja cubre ese (día, minuto)? Resuelve el cruce de medianoche. */
function intervalCovers(iv: ScheduleInterval, weekday: number, minutes: number): boolean {
  const prevDay = (weekday + 6) % 7;
  if (iv.endMinutes > iv.startMinutes) {
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

/** "2026-07-28" + (-1) → "2026-07-27". Fechas puras, sin husos de por medio. */
export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Fecha local ISO en el huso indicado — la clave de los overrides. */
export function zonedDateKey(timezone: string, at: Date = new Date()): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || DEFAULT_WINDOW.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return null;
  }
}

/** ¿Alguna franja de esa lista cubre el minuto, contando desde el mismo día? */
function rangesCoverSameDay(ranges: TimeRange[], minutes: number): boolean {
  return ranges.some((r) =>
    r.endMinutes > r.startMinutes
      ? minutes >= r.startMinutes && minutes < r.endMinutes
      : minutes >= r.startMinutes,
  );
}

/** ¿Alguna franja de la víspera se estira hasta este minuto de la madrugada? */
function rangesCoverFromPrevDay(ranges: TimeRange[], minutes: number): boolean {
  return ranges.some(
    (r) =>
      (r.endMinutes < r.startMinutes && minutes < r.endMinutes) ||
      (r.endMinutes === r.startMinutes && minutes < r.startMinutes),
  );
}

/**
 * Igual que el anterior pero contra el patrón semanal, para cuando la víspera
 * quedó fuera del rango de fechas consultado.
 *
 * Solo mira la COLA nocturna: el día de hoy ya lo decidió su excepción, y
 * consultar el patrón entero acá haría que un feriado abriera igual.
 */
function weeklyCoversFromPrevDay(
  schedule: WeeklySchedule,
  weekday: number,
  minutes: number,
): boolean {
  const prevDay = (weekday + 6) % 7;
  return schedule.intervals.some(
    (iv) =>
      iv.day === prevDay &&
      ((iv.endMinutes < iv.startMinutes && minutes < iv.endMinutes) ||
        (iv.endMinutes === iv.startMinutes && minutes < iv.startMinutes)),
  );
}

/** ¿El horario está abierto en este instante? Permisivo si la tz es inválida. */
export function isWithinSchedule(schedule: WeeklySchedule, at: Date = new Date()): boolean {
  const { hour, minute, weekday } = zonedNow(schedule.timezone, at);
  if (weekday < 0 || hour < 0) return true; // no se pudo determinar → no bloquear
  const minutes = hour * 60 + minute;

  // Excepciones por fecha (feriados). Si la fecha de hoy tiene entrada, ES la
  // verdad de hoy: una lista vacía significa cerrado, no "sin dato". El patrón
  // semanal no se consulta para ese día.
  const date = zonedDateKey(schedule.timezone, at);
  const today = date ? schedule.overrides?.[date] : undefined;
  if (today && date) {
    if (rangesCoverSameDay(today, minutes)) return true;
    // Cola nocturna de la víspera. Si esa fecha quedó fuera del rango, se mira
    // SOLO la cola del patrón semanal: consultar el patrón entero acá haría que
    // un feriado abriera igual, que es lo que este bloque evita.
    const yesterday = schedule.overrides?.[shiftDateKey(date, -1)];
    if (yesterday) return rangesCoverFromPrevDay(yesterday, minutes);
    return weeklyCoversFromPrevDay(schedule, weekday, minutes);
  }

  return isMinuteActive(schedule, weekday, minutes);
}

export interface SpecialDate {
  /** "2026-07-28" */
  date: string;
  /** Franjas efectivas de ese día. Vacío = cerrado (feriado). */
  ranges: TimeRange[];
  closed: boolean;
}

/**
 * Fechas cuyo horario efectivo DIFIERE del patrón semanal — o sea, los feriados
 * y excepciones que el cliente configuró en Connect.
 *
 * `GetEffectiveHoursOfOperations` devuelve todas las fechas del rango, coincidan
 * o no con el patrón. Guardarlas todas hace la evaluación exacta, pero para
 * avisar en la interfaz solo interesan las que se salen de lo normal.
 */
export function specialDates(schedule: WeeklySchedule): SpecialDate[] {
  const out: SpecialDate[] = [];
  for (const [date, ranges] of Object.entries(schedule.overrides || {})) {
    const [y, m, d] = date.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const patron = schedule.intervals
      .filter((iv) => iv.day === weekday)
      .map((iv) => `${iv.startMinutes}-${iv.endMinutes}`)
      .sort()
      .join("|");
    const efectivo = ranges
      .map((r) => `${r.startMinutes}-${r.endMinutes}`)
      .sort()
      .join("|");
    if (patron !== efectivo) out.push({ date, ranges, closed: ranges.length === 0 });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * ¿La celda (día, hora) cae dentro de la ventana?
 *
 * Los días marcan el día en que la ventana ABRE. Con una ventana nocturna
 * 22→06 activa los lunes, el tramo 00:00-06:00 del martes pertenece a la
 * sesión que abrió el lunes, y el martes por sí solo no habilita nada.
 */
export function isSlotActive(w: CallWindow, weekday: number, hour: number): boolean {
  return isHourActive(scheduleFromWindow(w), weekday, hour);
}

/** ¿La campaña puede marcar en este instante? Permisivo si la tz es inválida. */
export function isWithinWindow(w: CallWindow, at: Date = new Date()): boolean {
  return isWithinSchedule(scheduleFromWindow(w), at);
}

/** ¿La ventana está configurada de forma que nunca abre? (ningún día marcado) */
export function isWindowEmpty(w: CallWindow): boolean {
  return parseDays(w.windowDaysOfWeek).length === 0;
}

/** Un horario sin franjas nunca abre — hay que avisarlo, no dejarlo mudo. */
export function isScheduleEmpty(schedule: WeeklySchedule): boolean {
  return schedule.intervals.length === 0;
}

/** Horas activas por semana — para el resumen "45 h/semana". */
export function weeklyActiveHours(w: CallWindow): number {
  return weeklyScheduleHours(scheduleFromWindow(w));
}

/** Horas activas por semana de un horario, contadas por minuto (soporta 9:30). */
export function weeklyScheduleHours(schedule: WeeklySchedule): number {
  let minutes = 0;
  for (let d = 0; d < 7; d++) {
    for (let m = 0; m < 1440; m++) if (isMinuteActive(schedule, d, m)) minutes++;
  }
  return Math.round((minutes / 60) * 10) / 10;
}

export interface WindowChange {
  /** Instante exacto del próximo cambio de estado. */
  at: Date;
  /** true = la ventana abre en ese instante; false = cierra. */
  opens: boolean;
}

/**
 * Próximo borde del horario, buscando minuto a minuto hasta 8 días adelante.
 *
 * Minuto y no hora porque un Hours of Operation de Connect puede abrir a las
 * 9:30, y redondear a la hora daría una cuenta regresiva que miente por 30 min.
 * En el peor caso real (viernes por la tarde hasta el lunes) son ~3800 pasos.
 */
export function nextScheduleChange(
  schedule: WeeklySchedule,
  from: Date = new Date(),
): WindowChange | null {
  if (isScheduleEmpty(schedule)) return null;
  const current = isWithinSchedule(schedule, from);
  // Primer borde de minuto estrictamente futuro.
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 8; i++) {
    if (isWithinSchedule(schedule, cursor) !== current) {
      return { at: new Date(cursor), opens: !current };
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

/**
 * Próximo borde de la ventana simple.
 * Devuelve null si el estado no cambia en toda la semana (ventana 24/7 o vacía).
 */
export function nextWindowChange(w: CallWindow, from: Date = new Date()): WindowChange | null {
  if (isWindowEmpty(w)) return null;
  const current = isWithinWindow(w, from);
  // Primer borde de hora estrictamente futuro.
  const cursor = new Date(from);
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(cursor.getHours() + 1);
  for (let i = 0; i < 24 * 8; i++) {
    if (isWithinWindow(w, cursor) !== current) {
      return { at: new Date(cursor), opens: !current };
    }
    cursor.setHours(cursor.getHours() + 1);
  }
  return null;
}

/** "9:00" a partir de 9. Acepta el 24 como "24:00". */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Agrupa días consecutivos: [1,2,3,4,5] → "Lun a Vie"; [1,3,5] → "Lun, Mié, Vie". */
export function formatDays(value: CallWindow["windowDaysOfWeek"]): string {
  const days = [...parseDays(value)].sort((a, b) => a - b);
  if (days.length === 0) return "Ningún día";
  if (days.length === 7) return "Todos los días";
  const runs: number[][] = [];
  for (const d of days) {
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

/** "Lun a Vie · 09:00–18:00" — resumen de una línea. */
export function describeWindow(w: CallWindow): string {
  const start = startHour(w);
  const end = endHour(w);
  const days = formatDays(w.windowDaysOfWeek);
  if (start === end) return `${days} · 24 horas`;
  return `${days} · ${formatHour(start)}–${formatHour(end)}${start > end ? " (+1 día)" : ""}`;
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

// ── Conversión de huso para los selectores de fecha/hora ─────────────────────

/**
 * Desfase de `timeZone` respecto de UTC, en ms, para ese instante concreto.
 * Se calcula formateando la fecha en el huso y volviéndola a leer como si fuera
 * UTC: la diferencia ES el offset, incluyendo horario de verano.
 */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - date.getTime();
}

/**
 * "2026-08-04" + "09:00" en `timeZone` → ISO UTC.
 *
 * El admin elige la hora en el huso de la campaña (las 9 de la mañana en Lima),
 * no en el del navegador. Sin esta conversión, un supervisor conectado desde
 * España programaría la campaña seis horas antes de lo que ve en pantalla.
 *
 * Itera dos veces porque el offset depende del instante que estamos calculando:
 * la primera pasada da una aproximación y la segunda la corrige si el ajuste
 * cruzó un cambio de horario de verano.
 */
export function zonedInputsToUtcIso(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): string | null {
  if (!dateStr || !timeStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  if (![y, m, d, hh, mm].every(Number.isFinite)) return null;
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  let ts = wall;
  for (let i = 0; i < 2; i++) {
    ts = wall - tzOffsetMs(new Date(ts), timeZone || DEFAULT_WINDOW.timezone);
  }
  const result = new Date(ts);
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}

/** Inverso de zonedInputsToUtcIso: ISO UTC → { date: "2026-08-04", time: "09:00" }. */
export function utcIsoToZonedInputs(
  iso: string | null | undefined,
  timeZone: string,
): { date: string; time: string } | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || DEFAULT_WINDOW.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** "lun 4 ago, 09:00" en el huso indicado — para banners y listas. */
export function formatInZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("es-PE", {
      timeZone: timeZone || DEFAULT_WINDOW.timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** "en 2 h 15 min" / "en 3 días". Para la cuenta regresiva del próximo borde. */
export function formatRelative(target: Date, from: Date = new Date()): string {
  const ms = target.getTime() - from.getTime();
  if (ms <= 0) return "ahora";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `en ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem ? `en ${hours} h ${rem} min` : `en ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "en 1 día" : `en ${days} días`;
}
