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
import { ConnectClient, DescribeHoursOfOperationCommand } from "@aws-sdk/client-connect";
import { scheduleFromConnectHours, type WeeklySchedule } from "./callWindow";

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

/** Solo para tests: vacía la caché entre casos. */
export function __clearScheduleCache(): void {
  cache.clear();
}
