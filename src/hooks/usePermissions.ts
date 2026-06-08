import { useEffect, useState, useCallback } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useRoles } from "@/hooks/useRoles";
import type { UserRole } from "@/types/auth";

/**
 * usePermissions / useCan — granular RBAC (roadmap #28). Loads the
 * capability→minRole matrix from manage-permissions and exposes can(cap),
 * which checks the signed-in user's role (via useRoles.isAtLeast). Admins
 * edit the matrix in Configuración → Permisos, no deploy needed.
 *
 * The matrix is cached module-wide so repeated useCan() calls don't refetch.
 */
type Matrix = Record<string, UserRole>;

let cached: Matrix | null = null;
let inflight: Promise<Matrix> | null = null;

async function fetchMatrix(force = false): Promise<Matrix> {
  if (cached && !force) return cached;
  if (inflight && !force) return inflight;
  const ep = getApiEndpoints();
  if (!ep?.managePermissions) return {};
  inflight = authedFetch(ep.managePermissions)
    .then((r) => r.json())
    .then((d) => {
      cached = (d?.matrix || {}) as Matrix;
      return cached;
    })
    .catch(() => ({} as Matrix))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function usePermissions() {
  const { isAtLeast } = useRoles();
  const [matrix, setMatrix] = useState<Matrix>(cached || {});
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let on = true;
    fetchMatrix().then((m) => {
      if (on) {
        setMatrix(m);
        setLoading(false);
      }
    });
    return () => {
      on = false;
    };
  }, []);

  // can(cap): allowed if no rule (open) OR user meets the capability's minRole.
  const can = useCallback(
    (cap: string): boolean => {
      const min = matrix[cap];
      if (!min) return true; // uncapped capability → allowed
      return isAtLeast(min);
    },
    [matrix, isAtLeast]
  );

  const refresh = useCallback(async () => {
    const m = await fetchMatrix(true);
    setMatrix(m);
    return m;
  }, []);

  return { matrix, can, loading, refresh };
}

/** Convenience: just the can() check for a single capability. */
export function useCan(capability: string): boolean {
  const { can } = usePermissions();
  return can(capability);
}
