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
}

export const BuilderCtx = createContext<BuilderActions | null>(null);
export const useBuilder = () => useContext(BuilderCtx);
