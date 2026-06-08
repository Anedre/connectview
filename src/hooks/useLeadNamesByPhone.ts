import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";

/**
 * useLeadNamesByPhone — mapa { teléfono → nombre del lead } desde la tabla de
 * Leads (manage-leads). Es la fuente AUTORITATIVA de nombres (el lead siempre
 * se guarda con su nombre), a diferencia de Customer Profiles que puede no
 * tener nombre o traer basura ("Lead sin empresa"). Una sola llamada, cacheada
 * a nivel de sesión. Úsalo para mostrar nombres en vez de números sueltos.
 */
let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

export function useLeadNamesByPhone(): Record<string, string> {
  // Seed lazy desde el caché de sesión (sin setState síncrono en el effect).
  const [map, setMap] = useState<Record<string, string>>(() => cache || {});

  useEffect(() => {
    if (cache) return; // ya seedeado por el lazy init
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    if (!inflight) {
      inflight = fetch(ep.manageLeads)
        .then((r) => r.json())
        .then((j) => {
          const m: Record<string, string> = {};
          for (const l of j.leads || []) {
            const name = typeof l?.name === "string" ? l.name.trim() : "";
            if (l?.phone && name) m[l.phone] = name;
          }
          cache = m;
          return m;
        })
        .catch(() => ({}));
    }
    let cancelled = false;
    inflight.then((m) => {
      if (!cancelled) setMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return map;
}
