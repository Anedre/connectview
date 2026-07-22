import { useCallback, useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { scheduleFromConnectHours, type WeeklySchedule } from "@/lib/callWindow";

/** Un Hours of Operation de Amazon Connect, ya convertido a horario semanal. */
export interface HoursOfOperationOption {
  id: string;
  name: string;
  description: string;
  /** null cuando no se pudo leer su configuración (falta el permiso IAM). */
  schedule: WeeklySchedule | null;
  /** Nombre del error de AWS cuando `schedule` es null. */
  reason?: string;
}

interface RawHours {
  id: string;
  name: string;
  description?: string;
  timezone?: string;
  config?: Array<{
    Day?: string;
    StartTime?: { Hours?: number; Minutes?: number };
    EndTime?: { Hours?: number; Minutes?: number };
  }> | null;
  /** Horario efectivo por fecha (feriados ya aplicados por Connect). */
  overrides?: Record<string, Array<{ startMinutes: number; endMinutes: number }>> | null;
  reason?: string;
}

/**
 * Horarios de atención definidos en Amazon Connect.
 *
 * Es la misma lista que ve el administrador en la consola de Connect y que usan
 * sus colas. Se lee bajo demanda (`enabled`) porque implica un Describe por
 * horario y no todas las pantallas la necesitan.
 */
export function useHoursOfOperation(enabled = true) {
  const [options, setOptions] = useState<HoursOfOperationOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const ep = getApiEndpoints()?.listQueues;
    if (!ep) {
      setError("Amazon Connect no está configurado.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await authedFetch(`${ep}?hoursOfOperations=1`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const raw: RawHours[] = j.hoursOfOperations || [];
      setOptions(
        raw.map((h) => ({
          id: h.id,
          name: h.name,
          description: h.description || "",
          schedule: h.config
            ? {
                ...scheduleFromConnectHours(h.config, h.timezone || "America/Lima", {
                  id: h.id,
                  name: h.name,
                }),
                ...(h.overrides ? { overrides: h.overrides } : {}),
              }
            : null,
          reason: h.reason,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron leer los horarios");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  /**
   * true cuando Connect devolvió horarios pero ninguno trae su configuración.
   * Señal inequívoca de que al rol del tenant le falta
   * `connect:DescribeHoursOfOperation`, y la UI tiene que decirlo en vez de
   * mostrar una lista de horarios que no se pueden usar.
   */
  const missingPermission = options.length > 0 && options.every((o) => !o.schedule);

  return { options, loading, error, missingPermission, reload: load };
}
