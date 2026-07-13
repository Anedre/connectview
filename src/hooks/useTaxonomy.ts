import { useEffect, useState, useCallback, useMemo } from "react";
import {
  loadTaxonomies,
  invalidateTaxonomyCache,
  getDispositionTree,
  type DispositionStage,
  type TaxonomyDoc,
} from "@/lib/dispositions";

/**
 * useTaxonomy — loads the unified disposition taxonomy from the
 * manage-taxonomy Lambda (DynamoDB-backed source of truth). Every channel's
 * wrap-up uses this, so all agents tipify against ONE tree.
 *
 * Returns the active tree (default taxonomy, or one picked by id), the full
 * list of taxonomies (for the admin editor), loading state, and a refetch.
 *
 * While loading (or on failure) `tree` is the static fallback from
 * getDispositionTree(), so the picker never renders empty.
 *
 * `tree` is DERIVED (useMemo) from `docs` + `taxonomyId`, NOT set imperatively:
 * antes `refetch` dependía de `taxonomyId` y disparaba dos fetches (uno con el
 * id `undefined` mientras el programa cargaba, otro con el id real); si el
 * primero —más lento por no tener caché— resolvía último, pisaba el árbol
 * correcto con la default (race). Derivarlo elimina esa condición de carrera.
 */
export function useTaxonomy(taxonomyId?: string) {
  const [docs, setDocs] = useState<TaxonomyDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // `refetch` solo (re)carga la lista de taxonomías — NO depende de taxonomyId,
  // así que hay UN solo fetch y ningún closure stale que pise el resultado.
  const refetch = useCallback(async (force = false) => {
    setLoading(true);
    if (force) invalidateTaxonomyCache();
    const list = await loadTaxonomies(force);
    setDocs(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch(false);
  }, [refetch]);

  const tree = useMemo<DispositionStage[]>(() => {
    const picked = taxonomyId
      ? docs.find((d) => d.taxonomyId === taxonomyId)
      : (docs.find((d) => d.isDefault) ?? docs[0]);
    return picked?.stages?.length ? picked.stages : getDispositionTree();
  }, [docs, taxonomyId]);

  return { tree, docs, loading, refetch };
}
