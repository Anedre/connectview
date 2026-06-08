import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * useFeatureStatus — estado de las features de Amazon Connect del tenant
 * (Contact Lens, Customer Profiles, Amazon Q, grabaciones…) leído del mismo
 * health-check que alimenta el panel "Estado de la integración".
 *
 * Lo usan los avisos `<FeatureNotice>` que se muestran EN las secciones que
 * dependen de cada feature (Reportes → Contact Lens, Cliente 360° → Customer
 * Profiles, Copiloto → Amazon Q), para que el usuario vea ahí mismo si algo
 * está apagado y cómo activarlo.
 *
 * Cacheado en localStorage (TTL 10 min) + dedupe de la llamada en vuelo, así
 * que aunque varias secciones lo usen a la vez, el diagnóstico (que es pesado:
 * assume-role + varias APIs) corre una sola vez. El endpoint es admin-only; si
 * el usuario no es admin, falla silenciosamente y no se muestra ningún aviso
 * (preferimos no avisar a avisar de más).
 */
export type FeatureId =
  | "role" | "instance" | "contactLens" | "recordings" | "s3Recordings"
  | "customerProfiles" | "amazonQ" | "dataPlane";
export type CheckStatus = "ok" | "warn" | "error";
export interface FeatureCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  remediation?: string | null;
  link?: string | null;
}

const LS_KEY = "vox:featureStatus";
const TTL_MS = 10 * 60 * 1000;
let inflight: Promise<FeatureCheck[]> | null = null;

function readCache(): { checks: FeatureCheck[]; ts: number } | null {
  try {
    const j = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    return j && Array.isArray(j.checks) ? j : null;
  } catch {
    return null;
  }
}

async function fetchChecks(): Promise<FeatureCheck[]> {
  const ep = getApiEndpoints();
  if (!ep?.diagnoseConnection) return [];
  const r = await authedFetch(ep.diagnoseConnection, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json();
  const checks = Array.isArray(j.checks) ? (j.checks as FeatureCheck[]) : [];
  try { localStorage.setItem(LS_KEY, JSON.stringify({ checks, ts: Date.now() })); } catch { /* ignore */ }
  return checks;
}

export function useFeatureStatus(): { checks: FeatureCheck[]; loading: boolean } {
  const [checks, setChecks] = useState<FeatureCheck[]>(() => readCache()?.checks || []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const cached = readCache();
    if (cached && Date.now() - cached.ts < TTL_MS) {
      setChecks(cached.checks);
      return;
    }
    let alive = true;
    setLoading(true);
    if (!inflight) inflight = fetchChecks().finally(() => { inflight = null; });
    inflight
      .then((c) => { if (alive) setChecks(c); })
      .catch(() => { /* 403 (no admin) / error → mantenemos el cache si había */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return { checks, loading };
}

/** Estado de una feature puntual. "unknown" cuando no se pudo diagnosticar
 *  (p.ej. el usuario no es admin) → los avisos no se muestran en ese caso. */
export function useFeature(id: FeatureId): {
  status: CheckStatus | "unknown";
  check?: FeatureCheck;
} {
  const { checks } = useFeatureStatus();
  const check = checks.find((c) => c.id === id);
  return { status: check?.status ?? "unknown", check };
}
