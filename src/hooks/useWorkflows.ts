import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { useJourneys } from "@/hooks/useJourneys";
import type { AutomationRule } from "@/lib/automations";
import {
  classifyShape,
  fromJourney,
  fromRule,
  fromSplit,
  isSplitRule,
  journeyIdOf,
  ruleIdOf,
  splitEventWithWait,
  splitTargetJourneyId,
  toJourney,
  toRule,
  type Workflow,
  type WorkflowShape,
} from "@/lib/workflows";

/**
 * useWorkflows — la CAPA DE DATOS de la fachada "Flujos" (Fase 1). Lee las DOS
 * fuentes (reglas de `connectview-automation-rules` + journeys) y las mergea en
 * UNA lista de `Workflow`; al guardar, RUTEA al motor correcto según la forma
 * (regla / journey / split evento→journey) usando el mapeo puro de `lib/workflows`.
 *
 * No reescribe los motores: produce exactamente los formatos que ya consumen.
 * Toda la lógica de mapeo (el riesgo) vive —y está testeada— en `lib/workflows`;
 * aquí solo orquestamos la persistencia (endpoints existentes) y el split en 2
 * fases (guardar el journey para obtener su id → guardar la regla puente).
 */

async function saveRuleReq(url: string, rule: AutomationRule): Promise<AutomationRule> {
  const r = await authedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  const j = await r.json();
  if (!r.ok || !j.saved) throw new Error(j?.error || "no se pudo guardar la regla");
  return j.rule as AutomationRule;
}

async function deleteRuleReq(url: string, ruleId: string): Promise<void> {
  const r = await authedFetch(`${url}?ruleId=${encodeURIComponent(ruleId)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`no se pudo eliminar la regla (${r.status})`);
}

export interface UseWorkflows {
  workflows: Workflow[];
  /** Los journeys crudos del tenant (para el selector "Iniciar journey" del canvas). */
  journeys: ReturnType<typeof useJourneys>["journeys"];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Guarda ruteando por forma. Devuelve true si persistió en el motor correcto. */
  save: (w: Workflow) => Promise<boolean>;
  /** Elimina el/los registro(s) del workflow (regla y/o journey). */
  remove: (w: Workflow) => Promise<boolean>;
  /** Activa/pausa sin abrir el editor (re-guarda con enabled invertido). */
  toggle: (w: Workflow) => Promise<boolean>;
  /** La forma a la que iría el workflow (para badges/UX). */
  shapeOf: (w: Workflow) => WorkflowShape;
}

export function useWorkflows(): UseWorkflows {
  const journeysApi = useJourneys();
  const {
    journeys,
    save: saveJourney,
    remove: removeJourney,
    reload: reloadJourneys,
  } = journeysApi;
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    const url = getApiEndpoints()?.manageAutomations;
    if (!url) {
      setRulesLoading(false);
      return;
    }
    setRulesLoading(true);
    try {
      const r = await authedFetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "error");
      setRules(Array.isArray(j.rules) ? j.rules : []);
      setRulesError(null);
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : "No se pudieron cargar las reglas");
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const reload = useCallback(async () => {
    await Promise.all([loadRules(), reloadJourneys()]);
  }, [loadRules, reloadJourneys]);

  // ── Merge de las 2 fuentes → una lista de Workflow ──
  // Una regla-puente de split (start_journey marcado) + su journey destino se
  // re-ensamblan en UN solo workflow; ese journey no se lista aparte.
  const workflows = useMemo<Workflow[]>(() => {
    const consumed = new Set<string>();
    const jById = new Map(journeys.map((j) => [j.journeyId, j]));
    const out: Workflow[] = [];
    for (const r of rules) {
      if (isSplitRule(r)) {
        const jid = splitTargetJourneyId(r);
        const j = jid ? jById.get(jid) : undefined;
        if (j) {
          out.push(fromSplit(r, j));
          consumed.add(j.journeyId);
          continue;
        }
        // Journey destino ausente (borrado/otro tenant) → mostrar la regla sola.
      }
      out.push(fromRule(r));
    }
    for (const j of journeys) {
      if (consumed.has(j.journeyId)) continue;
      out.push(fromJourney(j));
    }
    return out;
  }, [rules, journeys]);

  // Al cambiar de forma en una edición (p.ej. agregar un wait a un reflejo), la
  // fuente vieja que ya no aplica se limpia para no dejar huérfanos ni duplicados.
  const cleanupOldSource = useCallback(
    async (w: Workflow, shape: WorkflowShape) => {
      const url = getApiEndpoints()?.manageAutomations;
      const oldRuleId = ruleIdOf(w.id);
      const oldJourneyId = journeyIdOf(w.id);
      const keepRule = shape === "reflex" || shape === "split";
      const keepJourney = shape === "journey" || shape === "split";
      if (oldRuleId && !keepRule && url) await deleteRuleReq(url, oldRuleId);
      if (oldJourneyId && !keepJourney) await removeJourney(oldJourneyId);
    },
    [removeJourney],
  );

  const save = useCallback(
    async (w: Workflow): Promise<boolean> => {
      const url = getApiEndpoints()?.manageAutomations;
      const shape = classifyShape(w);
      await cleanupOldSource(w, shape);
      if (shape === "reflex") {
        if (!url) throw new Error("Endpoint de automatizaciones no configurado");
        await saveRuleReq(url, toRule(w));
      } else if (shape === "journey") {
        const saved = await saveJourney(toJourney(w));
        if (!saved) throw new Error("No se pudo guardar el recorrido");
      } else {
        // split: guardar el journey primero (para su id), luego la regla puente.
        const { journey, buildRule } = splitEventWithWait(w);
        const savedJ = await saveJourney(journey);
        if (!savedJ?.journeyId) throw new Error("No se pudo guardar el recorrido del flujo");
        if (!url) throw new Error("Endpoint de automatizaciones no configurado");
        await saveRuleReq(url, buildRule(savedJ.journeyId));
      }
      await reload();
      return true;
    },
    [cleanupOldSource, saveJourney, reload],
  );

  const remove = useCallback(
    async (w: Workflow): Promise<boolean> => {
      const url = getApiEndpoints()?.manageAutomations;
      const rId = ruleIdOf(w.id);
      const jId = journeyIdOf(w.id);
      if (rId && url) await deleteRuleReq(url, rId);
      if (jId) await removeJourney(jId);
      await reload();
      return true;
    },
    [removeJourney, reload],
  );

  const toggle = useCallback(
    async (w: Workflow): Promise<boolean> => {
      const next: Workflow = {
        ...w,
        enabled: !w.enabled,
        // Para journeys/splits, reflejar el toggle en el status nativo también.
        status: w.status ? (w.enabled ? "paused" : "active") : undefined,
      };
      return save(next);
    },
    [save],
  );

  return {
    workflows,
    journeys,
    loading: rulesLoading || journeysApi.loading,
    error: rulesError || journeysApi.error,
    reload,
    save,
    remove,
    toggle,
    shapeOf: classifyShape,
  };
}
