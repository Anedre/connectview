import { useEffect, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramOptional } from "@/context/ProgramContext";

/**
 * useLeadTaxonomyId — resuelve la taxonomía de etapas a usar para tipificar un
 * lead 1:1 (una llamada / conversación / grabación), leyendo a qué programa(s)
 * pertenece ese lead (manage-leads ?phone= → programIds). Prioridad:
 *   1. El programa ACTIVO del switcher, si el lead pertenece a él (respeta el
 *      contexto en el que trabaja el agente).
 *   2. El primer programa del lead que tenga taxonomía propia.
 *   3. Fallback: la taxonomía del switcher (o la default si no hay).
 * `undefined` ⇒ `useTaxonomy` cae a la default global (sin regresión).
 */
export function useLeadTaxonomyId(phone: string | null): string | undefined {
  const { programs } = usePrograms();
  const activeProgram = useProgramOptional()?.activeProgram;
  const [leadProgramIds, setLeadProgramIds] = useState<string[]>([]);

  useEffect(() => {
    if (!phone) {
      setLeadProgramIds([]);
      return;
    }
    const ep = getApiEndpoints();
    if (!ep?.manageLeads) return;
    const ctrl = new AbortController();
    fetch(`${ep.manageLeads}?phone=${encodeURIComponent(phone)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => {
        const lead = (j.leads || [])[0];
        setLeadProgramIds(Array.isArray(lead?.programIds) ? (lead.programIds as string[]) : []);
      })
      .catch(() => {
        /* sin lead / sin red → cae al fallback */
      });
    return () => ctrl.abort();
  }, [phone]);

  // 1. Switcher, si el lead pertenece a ese programa.
  if (activeProgram?.programId && leadProgramIds.includes(activeProgram.programId)) {
    return activeProgram.taxonomyId;
  }
  // 2. Primer programa del lead con taxonomía propia.
  for (const pid of leadProgramIds) {
    const t = programs.find((p) => p.programId === pid)?.taxonomyId;
    if (t) return t;
  }
  // 3. Fallback: taxonomía del switcher (o la default global).
  return activeProgram?.taxonomyId;
}
