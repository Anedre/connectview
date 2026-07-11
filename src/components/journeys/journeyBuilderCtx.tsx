import { createContext, useContext } from "react";

/**
 * Acciones que el JourneyFlowBuilder expone a los nodos del lienzo
 * (JourneyStepNode) sin prop-drilling — espejo de `builderCtx` de Bots, con dos
 * extras propios de journeys: `updateParams` (los nodos guardan en `params`, no
 * en `data`) y `countOf` (el embudo de gente por estación).
 */
export interface JourneyBuilderActions {
  /** Parchea los params de un nodo (merge). */
  updateParams: (id: string, patch: Record<string, unknown>) => void;
  selectNode: (id: string) => void;
  /** Nº 1-based del paso entre los no-Entrada (badge numerado). */
  numberOf: (id: string) => number | undefined;
  /** Avisos de validación de ESTE nodo (mensajes). Vacío si está sano. */
  issuesOf: (id: string) => string[];
  /** Cuántos leads están AHORA en esta estación (embudo). 0 si ninguno. */
  countOf: (id: string) => number;
  /**
   * Click en una salida (conector) → abre el picker para agregar el siguiente
   * paso ya conectado a ese outlet. screenX/Y = dónde anclar el picker.
   */
  addFromOutlet: (nodeId: string, handleId: string, screenX: number, screenY: number) => void;
}

export const JourneyBuilderCtx = createContext<JourneyBuilderActions | null>(null);
export const useJourneyBuilder = () => useContext(JourneyBuilderCtx);
