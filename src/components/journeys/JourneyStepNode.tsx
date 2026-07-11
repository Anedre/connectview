import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Users, GripVertical } from "lucide-react";
import { JOURNEY_KINDS, JOURNEY_ICONS, type JourneyParams } from "@/lib/journeyFlow";
import type { JourneyNodeKind } from "@/hooks/useJourneys";
import { branchColor } from "@/components/bots/PlusEdge";
import { useJourneyBuilder } from "@/components/journeys/journeyBuilderCtx";

/**
 * JourneyStepNode — el nodo del lienzo de Journeys con la identidad de AWS Step
 * Functions Workflow Studio (a propósito DISTINTO de Bots): flujo VERTICAL
 * (arriba→abajo), tarjetas-estado compactas con grip + tile de ícono + "tipo"
 * (gris) sobre "nombre" (resumen), y handles arriba (entrada) / abajo (salidas).
 * La Entrada y el Fin son PASTILLAS crema ("Inicio"/"Fin"). Clases `.sfn-*`.
 */
type JData = { kind: JourneyNodeKind; params?: JourneyParams };

function JourneyStepNodeImpl({ id, data, selected }: NodeProps) {
  const d = data as JData;
  const def = JOURNEY_KINDS[d.kind];
  const builder = useJourneyBuilder();
  if (!def) return null;

  const Icon = JOURNEY_ICONS[def.icon] || JOURNEY_ICONS.action;
  const accent = def.accent;
  const params = (d.params as JourneyParams) || {};
  const stepNo = builder?.numberOf(id);
  const nodeIssues = builder?.issuesOf(id) ?? [];
  const hasIssue = nodeIssues.length > 0;
  const count = builder?.countOf(id) ?? 0;
  const outlets = def.outlets(params);
  const summary = def.summary(params);

  // ── Pastillas Inicio / Fin (entry / exit) — como el Start/End de Step Functions ──
  if (d.kind === "entry" || d.kind === "exit") {
    const isStart = d.kind === "entry";
    return (
      <div
        className={`sfn-pill ${isStart ? "sfn-pill--start" : "sfn-pill--end"} ${
          selected ? "sfn-pill--sel" : ""
        }`}
      >
        {!isStart && <Handle type="target" position={Position.Top} className="sfn-h sfn-h--top" />}
        <span className="sfn-pill__label">{isStart ? "Inicio" : "Fin"}</span>
        {count > 0 && <span className="sfn-pill__count">{count}</span>}
        {isStart && (
          <Handle
            type="source"
            id="out"
            position={Position.Bottom}
            className="sfn-h sfn-h--bot"
            title="Clic para agregar el primer paso · o arrastra"
            onClick={(e) => {
              e.stopPropagation();
              builder?.addFromOutlet(id, "out", e.clientX, e.clientY);
            }}
          />
        )}
      </div>
    );
  }

  const branchy = outlets.length > 1;

  return (
    <div
      className={`sfn-node ${selected ? "sfn-node--sel" : ""} ${hasIssue ? "sfn-node--issue" : ""}`}
      style={{ ["--_c" as string]: accent }}
    >
      <Handle type="target" position={Position.Top} className="sfn-h sfn-h--top" />

      <span className="sfn-node__grip" aria-hidden>
        <GripVertical size={15} />
      </span>
      <span className="sfn-node__icon" style={{ background: `${accent}1a`, color: accent }}>
        <Icon size={17} strokeWidth={2} />
      </span>
      <span className="sfn-node__text">
        <span className="sfn-node__type">
          {def.label}
          {hasIssue && (
            <span className="sfn-node__warn" title={nodeIssues.join("\n")}>
              <AlertTriangle size={11} strokeWidth={2.6} />
            </span>
          )}
        </span>
        <span className="sfn-node__name">{summary || "Sin configurar…"}</span>
      </span>
      {count > 0 && (
        <span
          className="sfn-node__count"
          title={`${count} lead${count === 1 ? "" : "s"} aquí ahora`}
        >
          <Users size={10} strokeWidth={2.4} /> {count}
        </span>
      )}
      {stepNo !== undefined && <span className="sfn-node__no">{stepNo}</span>}

      {/* Salidas ABAJO: 1 al centro (lineal) o 2 (ramas Sí/No · A/B). */}
      {branchy ? (
        outlets.map((o, i) => (
          <Handle
            key={o.id}
            type="source"
            id={o.id}
            position={Position.Bottom}
            className="sfn-h sfn-h--bot sfn-h--branch"
            title={`${o.label} — clic para agregar un paso en este camino · o arrastra`}
            style={{
              left: `${((i + 1) * 100) / (outlets.length + 1)}%`,
              ["--_c" as string]: branchColor(o.id),
            }}
            onClick={(e) => {
              e.stopPropagation();
              builder?.addFromOutlet(id, o.id, e.clientX, e.clientY);
            }}
          />
        ))
      ) : (
        <Handle
          type="source"
          id={outlets[0]?.id || "out"}
          position={Position.Bottom}
          className="sfn-h sfn-h--bot"
          title="Clic para agregar el siguiente paso · o arrastra para conectar"
          onClick={(e) => {
            e.stopPropagation();
            builder?.addFromOutlet(id, outlets[0]?.id || "out", e.clientX, e.clientY);
          }}
        />
      )}
    </div>
  );
}

export const JourneyStepNode = memo(JourneyStepNodeImpl);

// nodeTypes co-ubicado (patrón react-flow); export no-componente intencional.
// eslint-disable-next-line react-refresh/only-export-components
export const journeyNodeTypes = { jstep: JourneyStepNode };
