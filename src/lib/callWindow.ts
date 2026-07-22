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

/**
 * ¿La celda (día, hora) cae dentro de la ventana?
 *
 * Los días marcan el día en que la ventana ABRE. Con una ventana nocturna
 * 22→06 activa los lunes, el tramo 00:00-06:00 del martes pertenece a la
 * sesión que abrió el lunes, y el martes por sí solo no habilita nada.
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

/** ¿La campaña puede marcar en este instante? Permisivo si la tz es inválida. */
export function isWithinWindow(w: CallWindow, at: Date = new Date()): boolean {
  const { hour, weekday } = zonedNow(w.timezone || DEFAULT_WINDOW.timezone, at);
  if (weekday < 0 || hour < 0) return true; // no se pudo determinar → no bloquear
  return isSlotActive(w, weekday, hour);
}

/** ¿La ventana está configurada de forma que nunca abre? (ningún día marcado) */
export function isWindowEmpty(w: CallWindow): boolean {
  return parseDays(w.windowDaysOfWeek).length === 0;
}

/** Horas activas por semana — para el resumen "45 h/semana". */
export function weeklyActiveHours(w: CallWindow): number {
  let total = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) if (isSlotActive(w, d, h)) total++;
  }
  return total;
}

export interface WindowChange {
  /** Instante exacto del próximo cambio de estado. */
  at: Date;
  /** true = la ventana abre en ese instante; false = cierra. */
  opens: boolean;
}

/**
 * Próximo borde de la ventana, buscando hora a hora hasta 8 días adelante.
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
