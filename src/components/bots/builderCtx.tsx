import { createContext, useContext } from "react";

/**
 * Actions the FlowBuilder exposes to the custom nodes so they can edit
 * themselves inline (Kommo-style: "+ Botón de acción" on the node, etc.)
 * without prop-drilling. Provided by FlowBuilderInner, consumed by StepNode.
 */
export interface BuilderActions {
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  selectNode: (id: string) => void;
  /** 1-based step number among non-start nodes (the numbered badge). */
  numberOf: (id: string) => number | undefined;
  /**
   * Avisos de validación de ESTE nodo (los issues de validateBot cuyo nodeId
   * coincide). Vacío si el paso está sano. Alimenta el badge de alerta inline.
   */
  issuesOf: (id: string) => string[];
  /**
   * Click en una salida (bolita/conector) → abre el picker para agregar el
   * siguiente paso YA conectado a ese outlet. (screenX/Y = dónde anclar el
   * picker.) No usa el click del handle de react-flow (ver connectOnClick=false).
   */
  addFromOutlet: (nodeId: string, handleId: string, screenX: number, screenY: number) => void;
}

export const BuilderCtx = createContext<BuilderActions | null>(null);
export const useBuilder = () => useContext(BuilderCtx);
