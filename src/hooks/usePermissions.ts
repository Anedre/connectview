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
let cachedAt = 0;
let inflight: Promise<Matrix> | null = null;
// La matriz que edita un admin debe llegar a los agentes con la pestaña abierta.
// Con un TTL corto + refetch al enfocar (ver usePermissions) se refresca sola,
// sin exigir recarga completa ni re-login.
const TTL_MS = 60_000;

async function fetchMatrix(force = false): Promise<Matrix> {
  const fresh = !!cached && Date.now() - cachedAt < TTL_MS;
  if (fresh && !force) return cached as Matrix;
  // Un fetch YA en vuelo es tan fresco como uno nuevo — reusarlo también con
  // force dedupea el focus/poll de las N instancias montadas del hook (sin esto,
  // cada listener de focus disparaba su propio fetch en paralelo).
  if (inflight) return inflight;
  const ep = getApiEndpoints();
  if (!ep?.managePermissions) return cached || {};
  inflight = authedFetch(ep.managePermissions)
    .then((r) => r.json())
    .then((d) => {
      cached = (d?.matrix || {}) as Matrix;
      cachedAt = Date.now();
      return cached;
    })
    // En error CONSERVAMOS la última matriz buena (antes devolvía {} → el sidebar
    // caía al minRole restrictivo y ocultaba secciones ante un hipo de red).
    .catch(() => cached || ({} as Matrix))
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
    const load = (force = false) =>
      fetchMatrix(force).then((m) => {
        if (on) {
          setMatrix(m);
          setLoading(false);
        }
      });
    load();
    // Refresco sin recargar: poll suave + al volver a la pestaña, para que el
    // cambio que hace un admin en la matriz llegue a los agentes ya logueados.
    const iv = window.setInterval(() => load(true), 90_000);
    const onFocus = () => load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      on = false;
      window.clearInterval(iv);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // can(cap): allowed if no rule (open) OR user meets the capability's minRole.
  const can = useCallback(
    (cap: string): boolean => {
      const min = matrix[cap];
      if (!min) return true; // uncapped capability → allowed
      return isAtLeast(min);
    },
    [matrix, isAtLeast],
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
