import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * useCatalogs — capa de datos compartida para los Catálogos (listas de
 * referencia: precios, programas, motivos…). Trae todos los catálogos del tenant
 * (manage-catalog) y los cachea en memoria. Es el cimiento de la Fase 2 de
 * consumo: hoy lo usa la pestaña Catálogos del Copilot global; mañana, el Agente
 * IA o un dropdown de Leads lo reutilizan sin re-fetchear. Ver el editor en
 * `components/admin/CatalogEditor.tsx`.
 */
export interface CatalogDoc {
  catalogId: string;
  name: string;
  columns: string[];
  rows: string[][];
}

let cache: CatalogDoc[] | null = null;
let inflight: Promise<CatalogDoc[]> | null = null;

/** Fetch compartido con caché + dedup en vuelo. `force` salta el caché. */
export async function fetchCatalogs(force = false): Promise<CatalogDoc[]> {
  if (cache && !force) return cache;
  if (inflight && !force) return inflight;
  const url = getApiEndpoints()?.manageCatalog;
  if (!url) return [];
  const p = (async () => {
    try {
      const r = await authedFetch(url);
      const d = await r.json();
      const list: CatalogDoc[] = Array.isArray(d.catalogs) ? d.catalogs : [];
      cache = list;
      return list;
    } catch {
      return cache ?? [];
    } finally {
      inflight = null;
    }
  })();
  inflight = p;
  return p;
}

/** Invalida el caché (tras editar un catálogo en Configuración). */
export function invalidateCatalogs() {
  cache = null;
}

export function useCatalogs() {
  const [catalogs, setCatalogs] = useState<CatalogDoc[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let alive = true;
    fetchCatalogs()
      .then((c) => { if (alive) setCatalogs(c); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return { catalogs, loading };
}
