import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  useReactFlow,
  type EdgeProps,
  type Node,
} from "@xyflow/react";
import { Plus, X } from "lucide-react";
import { NODE_KINDS, type NodeKind } from "@/lib/botFlow";

// Constantes/util de color co-ubicadas con el edge (comparten dominio con él).
// El export no-componente es intencional aquí — mismo patrón que nodeTypes en StepNode.
/* eslint-disable react-refresh/only-export-components */
/** Pizarra/slate por defecto (coincide con edgeDefaults en FlowBuilder). */
export const EDGE_COLOR = "#64748B";

/**
 * Color de la conexión según la RAMA de la que sale (su sourceHandle/outlet):
 * caminos "buenos" en verde, "malos" en rojo, derivación a humano en iris,
 * A/B en gold; el resto (botones `b:`, filas `r:`, `out`) mantienen el cyan.
 * Así el flujo se lee de un vistazo sin abrir cada nodo. Sin match → cyan.
 */
export function branchColor(handleId: string | null | undefined): string {
  if (!handleId) return EDGE_COLOR;
  switch (handleId) {
    case "true":
    case "open":
    case "booked":
    case "resolved":
    case "ok":
      return "#10B981"; // verde — camino resuelto/positivo
    case "false":
    case "closed":
    case "failed":
    case "error":
      return "#EF4444"; // coral/rojo — camino fallido/negativo
    case "handoff":
      return "#8B5CF6"; // iris — derivar a humano
    case "a":
    case "b":
      return "#F59E0B"; // gold — variantes A/B
    default:
      return EDGE_COLOR; // botones (b:…), filas (r:…), "out" → cyan
  }
}
/* eslint-enable react-refresh/only-export-components */

/**
 * PlusEdge — the smoothstep connector, upgraded:
 *  • a mid-edge "+" button (revealed on hover) that opens the NodePicker to
 *    INSERT a node between source and target ("add node on edge" pattern);
 *  • a readable branch label (Sí/No, Resuelto/Derivar, a button's text…) derived
 *    from the source node's outlet that matches this edge's sourceHandle.
 * Keeps the same stroke/marker as edgeDefaults so nothing looks different at rest.
 *
 * The "+" click is wired back to FlowBuilder through `data.onInsert`, which
 * receives the edge id and the screen point to anchor the picker.
 */
export interface PlusEdgeData {
  /** Opens the picker anchored at (screenX,screenY) to insert on this edge. */
  onInsert?: (edgeId: string, screenX: number, screenY: number) => void;
  /** Removes this edge (× button, revealed on hover). */
  onDelete?: (edgeId: string) => void;
  [key: string]: unknown;
}

/** Label for a branch edge: the source node's outlet whose id === sourceHandle. */
function branchLabel(
  node: Node | undefined,
  sourceHandleId: string | null | undefined,
): string | null {
  if (!node || !sourceHandleId) return null;
  const kind = (node.data as { kind?: NodeKind }).kind;
  if (!kind) return null;
  const def = NODE_KINDS[kind];
  if (!def) return null;
  const outlets = def.outlets(node.data as Record<string, unknown>);
  // Only meaningful when the node actually branches (>1 outlet or a labelled one).
  if (outlets.length <= 1) return null;
  const outlet = outlets.find((o) => o.id === sourceHandleId);
  const label = outlet?.label?.trim();
  return label ? label : null;
}

export function PlusEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  source,
  sourceHandleId,
  data,
}: EdgeProps) {
  const { getNode } = useReactFlow();
  const [hover, setHover] = useState(false);

  // React Flow deja aire entre el punto de conexión y el borde VISIBLE del nodo:
  // ~18px del lado ORIGEN (el conector .fb-out florece AFUERA del nodo) y ~8px del
  // DESTINO (+ el marcador acorta el path). Extendemos cada extremo HACIA su nodo
  // para que la línea SALGA y LLEGUE pegada. En coords de flujo (constante al zoom).
  const SRC_NUB = 18;
  const TGT_NUB = 8;
  const adjSourceX =
    sourcePosition === Position.Right
      ? sourceX - SRC_NUB
      : sourcePosition === Position.Left
        ? sourceX + SRC_NUB
        : sourceX;
  const adjTargetX =
    targetPosition === Position.Left
      ? targetX + TGT_NUB
      : targetPosition === Position.Right
        ? targetX - TGT_NUB
        : targetX;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: adjSourceX,
    sourceY,
    sourcePosition,
    targetX: adjTargetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  const label = branchLabel(getNode(source), sourceHandleId);
  const onInsert = (data as PlusEdgeData | undefined)?.onInsert;
  const onDelete = (data as PlusEdgeData | undefined)?.onDelete;

  // Color por rama: tiñe el trazo y la etiqueta. La flecha (markerEnd) ya llega
  // pintada del color correcto porque FlowBuilder inyecta el marker por-edge en
  // `rfEdges` (react-flow genera un <marker> por color). El `style.stroke` que
  // manda el padre (p. ej. seleccionado) tiene prioridad sobre el color de rama.
  const strokeColor =
    style?.stroke && style.stroke !== EDGE_COLOR
      ? String(style.stroke)
      : branchColor(sourceHandleId);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth: hover ? 2.5 : (style?.strokeWidth ?? 2),
        }}
      />
      {/* Wide transparent hit-area so hovering anywhere near the edge reveals the "+". */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        style={{ cursor: "pointer" }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      <EdgeLabelRenderer>
        {/* Branch label (Sí / No / button text…) sitting just above the midpoint. */}
        {label && (
          <div
            className="fb-edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 15}px)`,
              borderColor: `${strokeColor}80`,
              color: strokeColor,
            }}
          >
            {label}
          </div>
        )}
        {/* Al pasar el mouse por la conexión: insertar un paso (+) o borrarla (×). */}
        <button
          type="button"
          className={`fb-edge-plus ${hover ? "fb-edge-plus--on" : ""}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX - (onDelete ? 13 : 0)}px, ${labelY}px)`,
          }}
          title="Insertar un paso aquí"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={(e) => {
            e.stopPropagation();
            onInsert?.(id, e.clientX, e.clientY);
          }}
        >
          <Plus size={13} strokeWidth={2.6} />
        </button>
        {onDelete && (
          <button
            type="button"
            className={`fb-edge-del ${hover ? "fb-edge-del--on" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX + 13}px, ${labelY}px)` }}
            title="Borrar esta conexión"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(id);
            }}
          >
            <X size={12} strokeWidth={2.8} />
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
