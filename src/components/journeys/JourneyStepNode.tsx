import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Users } from "lucide-react";
import { JOURNEY_KINDS, JOURNEY_ICONS, type JourneyParams } from "@/lib/journeyFlow";
import type { JourneyNodeKind } from "@/hooks/useJourneys";
import { branchColor } from "@/components/bots/PlusEdge";
import { useJourneyBuilder } from "@/components/journeys/journeyBuilderCtx";

/**
 * JourneyStepNode — el nodo único del lienzo de Journeys (espejo de StepNode de
 * Bots, reutilizando su CSS .fb-node*). Lee su kind de `data.kind` y se pinta
 * desde JOURNEY_KINDS: riel de acento + chip de ícono, resumen, badge de embudo
 * (leads AQUÍ) y una salida por outlet. Las ramas (Sí/No · A/B) salen como filas
 * de conector rotuladas a la derecha; una salida lineal única va al centro-derecha.
 */
type JData = { kind: JourneyNodeKind; params?: JourneyParams };

/** Resalta los {{tokens}} como chips (mismo look que Bots). */
function renderWithVars(text: string): React.ReactNode {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return parts.map((p, i) =>
    /^\{\{[^}]+\}\}$/.test(p) ? (
      <span key={i} className="fb-var">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

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
  const hasTarget = d.kind !== "entry";

  // Ramas rotuladas → filas de conector. Una salida "out" sin label → centro-derecha.
  const asRows = outlets.length > 0 && (outlets.length > 1 || Boolean(outlets[0].label));
  const bottomOut = outlets.length === 1 && !outlets[0].label ? outlets[0] : null;

  const rootStyle: React.CSSProperties | undefined = selected
    ? {
        borderColor: accent,
        boxShadow: `0 0 0 2px ${accent}40, 0 12px 26px -14px rgba(0,0,0,0.45)`,
      }
    : hasIssue
      ? { borderColor: "#EF444488", boxShadow: "0 0 0 1px #EF444433" }
      : undefined;

  return (
    <div
      className={`fb-node ${selected ? "fb-node--sel" : ""} ${hasIssue ? "fb-node--issue" : ""}`}
      style={rootStyle}
    >
      {hasTarget && (
        <Handle
          type="target"
          position={Position.Left}
          style={{
            width: 12,
            height: 12,
            background: "transparent",
            border: "none",
            left: 0,
            top: "50%",
          }}
        />
      )}

      <div className="fb-node__clip">
        <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, ${accent}88)` }} />
        <div className="fb-node__head">
          <span className="fb-node__icon" style={{ background: `${accent}1a`, color: accent }}>
            <Icon size={14} strokeWidth={2.2} />
          </span>
          <span className="fb-node__label">{def.label}</span>
          {hasIssue && (
            <span
              className="fb-node__issue"
              title={nodeIssues.join("\n")}
              aria-label={nodeIssues.join(". ")}
            >
              <AlertTriangle size={12} strokeWidth={2.4} />
            </span>
          )}
          {stepNo !== undefined && <span className="fb-node__no">{stepNo}</span>}
        </div>
      </div>

      <div className="fb-node__body">
        <div className="fb-node__summary">
          {summary ? (
            renderWithVars(summary)
          ) : (
            <span style={{ color: "var(--text-3)", fontStyle: "italic" }}>Sin configurar…</span>
          )}
        </div>

        {/* Embudo: cuántos leads están AHORA en esta estación. */}
        {count > 0 && (
          <div className="jfb-count" title={`${count} lead${count === 1 ? "" : "s"} aquí ahora`}>
            <Users size={11} strokeWidth={2.2} /> {count} {count === 1 ? "lead" : "leads"}
          </div>
        )}
      </div>

      {/* Ramas rotuladas como filas de conector (Sí/No · A/B). */}
      {asRows && (
        <div className="fb-node__outlets">
          {outlets.map((o) => (
            <div key={o.id} className="fb-node__outlet">
              <span className="fb-node__outlet-dot" style={{ background: branchColor(o.id) }} />
              <span className="fb-node__outlet-label" title={o.label}>
                {o.label}
              </span>
              <Handle
                type="source"
                id={o.id}
                position={Position.Right}
                className="fb-out-branch"
                title="Clic para agregar un paso en este camino · o arrastra"
                onClick={(e) => {
                  e.stopPropagation();
                  builder?.addFromOutlet(id, o.id, e.clientX, e.clientY);
                }}
                style={{ ["--out-accent" as string]: branchColor(o.id) }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Salida lineal única → handle centro-derecha (flujo L→R). */}
      {bottomOut && (
        <Handle
          type="source"
          id={bottomOut.id}
          position={Position.Right}
          className="fb-out"
          title="Clic para agregar el siguiente paso · o arrastra para conectar"
          onClick={(e) => {
            e.stopPropagation();
            builder?.addFromOutlet(id, bottomOut.id, e.clientX, e.clientY);
          }}
          style={{ ["--out-accent" as string]: accent }}
        />
      )}
    </div>
  );
}

export const JourneyStepNode = memo(JourneyStepNodeImpl);

// nodeTypes co-ubicado (patrón react-flow); export no-componente intencional.
// eslint-disable-next-line react-refresh/only-export-components
export const journeyNodeTypes = { jstep: JourneyStepNode };
