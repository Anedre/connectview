import { useEffect, useState, useCallback } from "react";
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
 */
export function useTaxonomy(taxonomyId?: string) {
  const [docs, setDocs] = useState<TaxonomyDoc[]>([]);
  const [tree, setTree] = useState<DispositionStage[]>(() =>
    getDispositionTree()
  );
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(
    async (force = false) => {
      setLoading(true);
      if (force) invalidateTaxonomyCache();
      const list = await loadTaxonomies(force);
      setDocs(list);
      const picked = taxonomyId
        ? list.find((d) => d.taxonomyId === taxonomyId)
        : list.find((d) => d.isDefault) ?? list[0];
      if (picked?.stages?.length) setTree(picked.stages);
      setLoading(false);
    },
    [taxonomyId]
  );

  useEffect(() => {
    refetch(false);
  }, [refetch]);

  return { tree, docs, loading, refetch };
}
