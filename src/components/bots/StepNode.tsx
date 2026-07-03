import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Link2, PhoneCall, AlertTriangle } from "lucide-react";
import {
  NODE_KINDS,
  type NodeKind,
  type ButtonDef,
  type ButtonKind,
  type ListRow,
} from "@/lib/botFlow";
import { FLOW_ICONS } from "@/components/bots/icons";
import { useBuilder } from "@/components/bots/builderCtx";

/**
 * StepNode — the single custom react-flow node for every bot step (#16).
 * Reads its kind from `data.kind` and renders from the NODE_KINDS catalog:
 * an accent top-rail + icon chip header, a clamped summary body, action
 * chips / list preview, and one source handle per outlet. Branch outlets
 * (reply buttons, list rows, condition, webhook) render as labelled connector
 * rows on the right — Kommo/Typebot style — so flows read top-to-bottom and
 * branch cleanly. Handle ids are unchanged so saved edges keep connecting.
 */
type StepData = { kind: NodeKind } & Record<string, unknown>;

/** Resalta los {{tokens}} de variable como chips para que el flujo se lea solo. */
function renderWithVars(text: string): React.ReactNode {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return parts.map((p, i) =>
    /^\{\{[^}]+\}\}$/.test(p) ? (
      <span key={i} className="fb-var">{p}</span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

function StepNodeImpl({ id, data, selected }: NodeProps) {
  const d = data as StepData;
  const def = NODE_KINDS[d.kind];
  const builder = useBuilder();
  if (!def) return null;

  const Icon = FLOW_ICONS[def.icon] || FLOW_ICONS.message;
  const accent = def.accent;
  const stepNo = builder?.numberOf(id);
  // Avisos de validación de este paso → badge de alerta + borde teñido.
  const nodeIssues = builder?.issuesOf(id) ?? [];
  const hasIssue = nodeIssues.length > 0;

  const addButton = (type: ButtonKind) => {
    if (!builder) return;
    const cur = Array.isArray(d.buttons) ? (d.buttons as ButtonDef[]) : [];
    if (cur.length >= 3) return;
    const bid = Math.random().toString(36).slice(2, 7);
    builder.updateNodeData(id, { buttons: [...cur, { id: bid, label: "", type }] });
    builder.selectNode(id);
  };

  const pillStyle = (disabled: boolean): React.CSSProperties => ({
    fontSize: 10.5,
    fontWeight: 600,
    padding: "4px 9px",
    borderRadius: 999,
    border: `1px dashed ${accent}66`,
    background: `${accent}12`,
    color: accent,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1,
  });

  const outlets = def.outlets(d);
  const summary = def.summary(d);
  const hasTarget = d.kind !== "start";

  const allButtons = Array.isArray(d.buttons) ? (d.buttons as ButtonDef[]) : [];
  const actionButtons =
    d.kind === "message" ? allButtons.filter((b) => b.type === "url" || b.type === "phone") : [];
  const rows = d.kind === "list" && Array.isArray(d.rows) ? (d.rows as ListRow[]) : [];

  // Branchy outlets (labelled) → connector rows. A single unlabelled "out"
  // → a bottom-centre handle.
  const asRows = outlets.length > 0 && (outlets.length > 1 || Boolean(outlets[0].label));
  const bottomOut = outlets.length === 1 && !outlets[0].label ? outlets[0] : null;

  // El borde: seleccionado manda (acento); si no, un aviso lo tiñe de rojo sutil.
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
      {/* Accent top-rail — gives each step a colored identity */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, ${accent}88)` }} />

      {hasTarget && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ width: 10, height: 10, background: "var(--bg-1)", border: "2px solid var(--border-2)", left: -5, top: "50%" }}
        />
      )}

      {/* Header */}
      <div className="fb-node__head">
        <span className="fb-node__icon" style={{ background: `${accent}1a`, color: accent }}>
          <Icon size={14} strokeWidth={2.2} />
        </span>
        <span className="fb-node__label">{def.label}</span>
        {hasIssue && (
          <span className="fb-node__issue" title={nodeIssues.join("\n")} aria-label={nodeIssues.join(". ")}>
            <AlertTriangle size={12} strokeWidth={2.4} />
          </span>
        )}
        {stepNo !== undefined && <span className="fb-node__no">{stepNo}</span>}
      </div>

      {/* Body */}
      <div className="fb-node__body">
        <div className="fb-node__summary">
          {summary ? renderWithVars(summary) : <span style={{ color: "var(--text-3)", fontStyle: "italic" }}>Sin configurar…</span>}
        </div>

        {/* Action buttons (url / phone) — chips, no branch */}
        {actionButtons.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9 }}>
            {actionButtons.map((b) => (
              <span key={b.id} className="fb-node__chip">
                {b.type === "url" ? <Link2 size={10} /> : <PhoneCall size={10} />}
                {b.label || (b.type === "url" ? "Enlace" : "Llamar")}
              </span>
            ))}
          </div>
        )}

        {/* List rows preview */}
        {rows.length > 0 && (
          <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 3 }}>
            {rows.slice(0, 4).map((r) => (
              <div key={r.id} className="fb-node__listrow">
                <span style={{ color: accent }}>•</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.title || "Opción"}
                </span>
              </div>
            ))}
            {rows.length > 4 && (
              <div style={{ fontSize: 10, color: "var(--text-3)" }}>+{rows.length - 4} más…</div>
            )}
          </div>
        )}

        {/* Inline add-button affordances (Kommo-style) */}
        {d.kind === "message" && builder && (
          <div className="nodrag" style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <button
              className="nodrag"
              disabled={allButtons.length >= 3}
              onClick={(e) => { e.stopPropagation(); addButton("reply"); }}
              style={pillStyle(allButtons.length >= 3)}
            >
              + Botón
            </button>
            <button
              className="nodrag"
              disabled={allButtons.length >= 3}
              onClick={(e) => { e.stopPropagation(); addButton("url"); }}
              style={pillStyle(allButtons.length >= 3)}
            >
              + Enlace
            </button>
          </div>
        )}
      </div>

      {/* Branch outlets as connector rows */}
      {asRows && (
        <div className="fb-node__outlets">
          {outlets.map((o) => (
            <div key={o.id} className="fb-node__outlet">
              <span className="fb-node__outlet-dot" style={{ background: accent }} />
              <span className="fb-node__outlet-label" title={o.label}>{o.label}</span>
              <Handle
                type="source"
                id={o.id}
                position={Position.Right}
                style={{ width: 10, height: 10, background: accent, border: "2px solid var(--bg-1)", right: -5, top: "50%" }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Single unlabelled outlet → right-centre handle (flujo L→R) */}
      {bottomOut && (
        <Handle
          type="source"
          id={bottomOut.id}
          position={Position.Right}
          style={{ width: 10, height: 10, background: accent, border: "2px solid var(--bg-1)", right: -5, top: "50%" }}
        />
      )}
    </div>
  );
}

export const StepNode = memo(StepNodeImpl);

// nodeTypes is co-located with the node (standard react-flow pattern); the
// non-component export is intentional here.
// eslint-disable-next-line react-refresh/only-export-components
export const nodeTypes = { step: StepNode };
