/**
 * Lectura del Hours of Operation de Amazon Connect, cacheada.
 *
 * El horario de atención de una campaña puede venir de dos lados:
 *   1. Un Hours of Operation de Connect (`hoursOfOperationId`) — la fuente de
 *      verdad del cliente, la misma que usan sus colas.
 *   2. La ventana manual de la campaña (windowStartHour/EndHour/DaysOfWeek) —
 *      el modelo viejo, que sigue funcionando para las campañas existentes.
 *
 * 🔑 Los Lambdas bundlean este archivo: tras editarlo hay que redesplegar
 *    `campaign-dialer` con `node scripts/deploy-lambda.mjs campaign-dialer`.
 */
import {
  ConnectClient,
  DescribeHoursOfOperationCommand,
  GetEffectiveHoursOfOperationsCommand,
} from "@aws-sdk/client-connect";
import {
  scheduleFromConnectHours,
  shiftDateKey,
  type TimeRange,
  type WeeklySchedule,
} from "./callWindow";

// parseScheduleSnapshot / serializeSchedule viven en `callWindow.ts` porque son
// lógica pura y tienen que existir idénticas en el front (src/lib/callWindow.ts).
// Acá se re-exportan para que los callers no tengan que importar de dos lados.
export { parseScheduleSnapshot, serializeSchedule } from "./callWindow";

/**
 * TTL corto a propósito: si el cliente corrige su horario en la consola de
 * Connect, la campaña debe respetarlo en minutos, no en la próxima hora. El
 * dialer corre cada minuto, así que 5 min = una lectura cada 5 ticks.
 */
const TTL_OK_MS = 5 * 60 * 1000;
/** El fallo se cachea mucho menos, para no quedar ciegos si fue transitorio. */
const TTL_FAIL_MS = 30 * 1000;

interface CacheEntry {
  schedule: WeeklySchedule | null;
  exp: number;
}
const cache = new Map<string, CacheEntry>();

/**
 * Lee un Hours of Operation y lo convierte a horario semanal.
 *
 * Devuelve null cuando no se pudo leer — típicamente porque al rol del tenant
 * le falta `connect:DescribeHoursOfOperation` (se agregó al template después de
 * provisionar los primeros clientes). El caller decide qué hacer con eso; acá
 * NO se inventa un horario, porque un horario inventado haría marcar fuera de
 * hora, que es justo lo que este módulo existe para evitar.
 */
export async function fetchConnectSchedule(
  connect: ConnectClient,
  instanceId: string,
  hoursOfOperationId: string,
): Promise<WeeklySchedule | null> {
  if (!instanceId || !hoursOfOperationId) return null;
  const key = `${instanceId}#${hoursOfOperationId}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.schedule;

  try {
    const res = await connect.send(
      new DescribeHoursOfOperationCommand({
        InstanceId: instanceId,
        HoursOfOperationId: hoursOfOperationId,
      }),
    );
    const hoo = res.HoursOfOperation;
    if (!hoo) {
      cache.set(key, { schedule: null, exp: Date.now() + TTL_FAIL_MS });
      return null;
    }
    const schedule = scheduleFromConnectHours(hoo.Config, hoo.TimeZone || "", {
      id: hoursOfOperationId,
      name: hoo.Name,
    });
    cache.set(key, { schedule, exp: Date.now() + TTL_OK_MS });
    return schedule;
  } catch (err) {
    const reason = err instanceof Error ? err.name : String(err);
    console.warn(`[connectHours] no se pudo leer ${hoursOfOperationId}: ${reason}`);
    cache.set(key, { schedule: null, exp: Date.now() + TTL_FAIL_MS });
    return null;
  }
}

/**
 * Cuántos días de horario efectivo se piden por delante. Ocho cubren la semana
 * que muestra el visualizador y el cálculo del próximo borde, que mira 8 días.
 */
const EFFECTIVE_DAYS_AHEAD = 8;

/**
 * Enriquece un horario con su calendario EFECTIVO — el que aplica los overrides
 * que el cliente configura en Connect para feriados y días especiales.
 *
 * Sin esto, una campaña trataría el 28 de julio como un martes cualquiera y
 * llamaría en Fiestas Patrias.
 *
 * El rango arranca AYER, no hoy: una franja nocturna del día anterior puede
 * estirarse hasta la madrugada de hoy, y sin esa fecha en el mapa no habría
 * contra qué evaluar ese tramo.
 *
 * Si falla, devuelve el horario tal cual: se pierde el respeto a los feriados,
 * pero el patrón semanal sigue vigente. Nunca lanza.
 */
export async function withEffectiveHours(
  connect: ConnectClient,
  instanceId: string,
  schedule: WeeklySchedule,
  now: Date = new Date(),
): Promise<WeeklySchedule> {
  if (!schedule.hoursOfOperationId || !instanceId) return schedule;
  const today = zonedDateKey(schedule.timezone, now);
  if (!today) return schedule;
  const fromDate = shiftDateKey(today, -1);
  const toDate = shiftDateKey(today, EFFECTIVE_DAYS_AHEAD);

  const key = `${instanceId}#${schedule.hoursOfOperationId}#${fromDate}`;
  const hit = effectiveCache.get(key);
  if (hit && hit.exp > Date.now()) {
    return hit.overrides ? { ...schedule, overrides: hit.overrides } : schedule;
  }

  try {
    const res = await connect.send(
      new GetEffectiveHoursOfOperationsCommand({
        InstanceId: instanceId,
        HoursOfOperationId: schedule.hoursOfOperationId,
        FromDate: fromDate,
        ToDate: toDate,
      }),
    );
    const overrides: Record<string, TimeRange[]> = {};
    for (const day of res.EffectiveHoursOfOperationList || []) {
      if (!day?.Date) continue;
      overrides[day.Date] = (day.OperationalHours || []).map((h) => ({
        startMinutes: (h.Start?.Hours ?? 0) * 60 + (h.Start?.Minutes ?? 0),
        endMinutes: (h.End?.Hours ?? 0) * 60 + (h.End?.Minutes ?? 0),
      }));
    }
    effectiveCache.set(key, { overrides, exp: Date.now() + TTL_OK_MS });
    return { ...schedule, overrides };
  } catch (err) {
    const reason = err instanceof Error ? err.name : String(err);
    // Lo más probable: al rol del tenant le falta
    // `connect:GetEffectiveHoursOfOperations`. Se cachea el fallo un rato corto
    // para no repetir la llamada en cada tick.
    console.warn(
      `[connectHours] sin horario efectivo para ${schedule.hoursOfOperationId} (${reason}) — se usa el patrón semanal`,
    );
    effectiveCache.set(key, { overrides: null, exp: Date.now() + TTL_FAIL_MS });
    return schedule;
  }
}

interface EffectiveCacheEntry {
  overrides: Record<string, TimeRange[]> | null;
  exp: number;
}
const effectiveCache = new Map<string, EffectiveCacheEntry>();

/** Fecha local ISO en el huso indicado — la clave de los overrides. */
function zonedDateKey(timezone: string, at: Date): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return null;
  }
}

/** Solo para tests: vacía las cachés entre casos. */
export function __clearScheduleCache(): void {
  cache.clear();
  effectiveCache.clear();
}
