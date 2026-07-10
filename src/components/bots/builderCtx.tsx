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
   * Abre el selector de bloques para agregar un paso YA conectado desde la
   * salida (nodeId, handleId). El paso nuevo se coloca a la derecha del origen.
   * screenX/Y = dónde posicionar el menú. Alimenta el botón "+" de la salida.
   */
  connectFromHandle: (nodeId: string, handleId: string, screenX: number, screenY: number) => void;
}

export const BuilderCtx = createContext<BuilderActions | null>(null);
export const useBuilder = () => useContext(BuilderCtx);
