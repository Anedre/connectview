import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  LogIn,
  LogOut,
  Send,
  Clock,
  GitBranch,
  Zap,
  Plus,
  Save,
  Trash2,
  Network,
  Check,
  AlertTriangle,
  X,
} from "lucide-react";
import type { Journey, JourneyNode, JourneyNodeKind, JourneyStats } from "@/hooks/useJourneys";
import { useSegments, type FilterRule, type FilterOp } from "@/hooks/useSegments";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * JourneyBuilder — el editor visual del motor de Journeys (Fase 3 · 3B). Lienzo
 * react-flow (molde del FlowBuilder del Pilar 8) para que un no-técnico arme un
 * recorrido: Entrada → Enviar → Esperar → Ramificar → Acción → Fin. El CRUD ya
 * está folded en manage-leads (saveJourney/deleteJourney) y el AVANCE lo corre el
 * journey-runner (tick). Aquí solo se edita la definición (nodos + aristas +
 * entrada) y se persiste con `onSave`.
 */

// ── Catálogo de tipos de nodo (etiqueta, icono, color, conectores) ──────────
type Outlet = { id: string; label?: string };
interface KindDef {
  label: string;
  icon: typeof Send;
  accent: string;
  hasTarget: boolean; // ¿recibe conexión de entrada?
  outlets: Outlet[]; // salidas (0 = terminal)
}
const JOURNEY_KINDS: Record<JourneyNodeKind, KindDef> = {
  entry: {
    label: "Entrada",
    icon: LogIn,
    accent: "#16a34a",
    hasTarget: false,
    outlets: [{ id: "out" }],
  },
  send: {
    label: "Enviar",
    icon: Send,
    accent: "#2563eb",
    hasTarget: true,
    outlets: [{ id: "out" }],
  },
  wait: {
    label: "Esperar",
    icon: Clock,
    accent: "#d97706",
    hasTarget: true,
    outlets: [{ id: "out" }],
  },
  branch: {
    label: "Ramificar",
    icon: GitBranch,
    accent: "#7c3aed",
    hasTarget: true,
    outlets: [
      { id: "yes", label: "Sí" },
      { id: "no", label: "No" },
    ],
  },
  action: {
    label: "Acción",
    icon: Zap,
    accent: "#0891b2",
    hasTarget: true,
    outlets: [{ id: "out" }],
  },
  exit: { label: "Fin", icon: LogOut, accent: "#64748b", hasTarget: true, outlets: [] },
};
const PALETTE: JourneyNodeKind[] = ["send", "wait", "branch", "action", "exit"];

type NodeParams = Record<string, unknown>;

/** Resumen legible de un nodo según sus params — lo que se ve en el lienzo. */
function summaryOf(kind: JourneyNodeKind, p: NodeParams): string {
  switch (kind) {
    case "entry":
      return "Los leads entran acá";
    case "send": {
      const ch = p.channel === "email" ? "Email" : "WhatsApp";
      const t = String(p.templateName || p.subject || "");
      return t ? `${ch} · ${t}` : `${ch} · (sin plantilla)`;
    }
    case "wait": {
      if (Array.isArray(p.untilRule) && p.untilRule.length) return "Esperar hasta que se cumpla…";
      const d = Number(p.days ?? 0);
      return d > 0 ? `Esperar ${d} día${d === 1 ? "" : "s"}` : "Esperar (sin definir)";
    }
    case "branch": {
      const n = Array.isArray(p.rules) ? p.rules.length : 0;
      const m = p.match === "any" ? "cualquiera" : "todas";
      return n ? `${n} ${n === 1 ? "condición" : "condiciones"} · ${m}` : "Sin condiciones";
    }
    case "action": {
      if (p.type === "moveStage") return `Mover a etapa "${p.stageId || "?"}"`;
      if (p.type === "webhook") return "Llamar webhook";
      if (p.type === "enqueueDialer") return "Encolar al dialer";
      return "Acción (sin definir)";
    }
    case "exit":
      return "El lead sale del recorrido";
  }
}

// ── Nodo custom del lienzo ──────────────────────────────────────────────────
type JData = { kind: JourneyNodeKind; params: NodeParams; count?: number };
function JourneyFlowNodeImpl({ data, selected }: NodeProps) {
  const d = data as JData;
  const def = JOURNEY_KINDS[d.kind];
  if (!def) return null;
  const Icon = def.icon;
  const accent = def.accent;
  const branchy = def.outlets.length > 1 || Boolean(def.outlets[0]?.label);
  const single = def.outlets.length === 1 && !def.outlets[0].label ? def.outlets[0] : null;
  const count = Number(d.count || 0); // leads que descansan en este nodo (embudo 3C)

  return (
    <div
      style={{
        minWidth: 210,
        maxWidth: 260,
        background: "var(--bg-2)",
        border: `1px solid ${selected ? accent : "var(--border-2)"}`,
        borderRadius: 12,
        boxShadow: selected
          ? `0 0 0 2px ${accent}40, 0 12px 26px -14px rgba(0,0,0,0.45)`
          : "0 6px 18px -12px rgba(0,0,0,0.35)",
        overflow: "hidden",
      }}
    >
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, ${accent}88)` }} />
      {def.hasTarget && (
        <Handle
          type="target"
          position={Position.Left}
          style={{
            width: 10,
            height: 10,
            background: "var(--bg-1)",
            border: "2px solid var(--border-2)",
            left: -5,
          }}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px 4px" }}>
        <span
          style={{
            display: "inline-flex",
            width: 24,
            height: 24,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 7,
            background: `${accent}1a`,
            color: accent,
          }}
        >
          <Icon size={14} strokeWidth={2.2} />
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text-1)" }}>{def.label}</span>
        {count > 0 && (
          <span
            title={`${count} lead${count === 1 ? "" : "s"} en este paso`}
            style={{
              marginLeft: "auto",
              minWidth: 20,
              padding: "1px 7px",
              borderRadius: 999,
              background: accent,
              color: "#fff",
              fontSize: 11,
              fontWeight: 800,
            }}
          >
            {count}
          </span>
        )}
      </div>
      <div
        style={{ padding: "0 11px 11px", fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.35 }}
      >
        {summaryOf(d.kind, d.params)}
      </div>

      {branchy && (
        <div style={{ borderTop: "1px solid var(--border-1)" }}>
          {def.outlets.map((o) => (
            <div
              key={o.id}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 6,
                padding: "6px 16px 6px 11px",
                fontSize: 11,
                fontWeight: 700,
                color: accent,
              }}
            >
              {o.label}
              <Handle
                type="source"
                id={o.id}
                position={Position.Right}
                style={{
                  width: 10,
                  height: 10,
                  background: accent,
                  border: "2px solid var(--bg-1)",
                  right: -5,
                  position: "absolute",
                  top: "50%",
                }}
              />
            </div>
          ))}
        </div>
      )}
      {single && (
        <Handle
          type="source"
          id={single.id}
          position={Position.Right}
          style={{
            width: 10,
            height: 10,
            background: accent,
            border: "2px solid var(--bg-1)",
            right: -5,
          }}
        />
      )}
    </div>
  );
}
const JourneyFlowNode = JourneyFlowNodeImpl;
const nodeTypes = { journey: JourneyFlowNode };

const EDGE_COLOR = "#7c8db5";
const edgeDefaults = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR, width: 16, height: 16 },
  style: { stroke: EDGE_COLOR, strokeWidth: 1.6 },
};

const COL_GAP = 300;
const ROW_GAP = 130;
const rid = () => Math.random().toString(36).slice(2, 9);

/** Auto-layout L→R: profundidad por BFS desde la Entrada, columnas apiladas. */
function layoutLR(nodes: Node[], edges: Edge[]): Node[] {
  const entry = nodes.find((n) => (n.data as JData).kind === "entry");
  const depth = new Map<string, number>();
  if (entry) {
    const queue: Array<{ id: string; d: number }> = [{ id: entry.id, d: 0 }];
    while (queue.length) {
      const { id, d } = queue.shift()!;
      if (depth.has(id) && depth.get(id)! >= d) continue;
      depth.set(id, Math.max(depth.get(id) ?? 0, d));
      edges.filter((e) => e.source === id).forEach((e) => queue.push({ id: e.target, d: d + 1 }));
    }
  }
  nodes.forEach((n, i) => {
    if (!depth.has(n.id)) depth.set(n.id, i);
  });
  const cols = new Map<number, string[]>();
  nodes.forEach((n) => {
    const d = depth.get(n.id) ?? 0;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d)!.push(n.id);
  });
  const pos = new Map<string, { x: number; y: number }>();
  [...cols.keys()]
    .sort((a, b) => a - b)
    .forEach((d) => {
      const ids = cols.get(d)!;
      ids.forEach((id, i) => {
        pos.set(id, { x: d * COL_GAP, y: i * ROW_GAP - ((ids.length - 1) * ROW_GAP) / 2 });
      });
    });
  return nodes.map((n) => ({ ...n, position: pos.get(n.id) || n.position }));
}

function toRFNodes(j: Journey): Node[] {
  return j.nodes.map((n) => ({
    id: n.id,
    type: "journey",
    position: n.position || { x: 0, y: 0 },
    data: { kind: n.kind, params: (n.params as NodeParams) || {} },
  }));
}
function toRFEdges(j: Journey): Edge[] {
  return j.edges.map((e, i) => ({
    id: `e${i}:${e.from}->${e.to}:${e.on || "out"}`,
    source: e.from,
    target: e.to,
    sourceHandle: e.on || "out",
    ...edgeDefaults,
  }));
}

/** Avisos de validación (no bloquean, guían). */
function validateJourney(
  nodes: Node[],
  edges: Edge[],
): Array<{ message: string; nodeId?: string }> {
  const out: Array<{ message: string; nodeId?: string }> = [];
  const entries = nodes.filter((n) => (n.data as JData).kind === "entry");
  if (entries.length === 0) out.push({ message: "Falta el nodo de Entrada." });
  if (entries.length > 1) out.push({ message: "Hay más de una Entrada — dejá solo una." });
  const entry = entries[0];
  if (entry && !edges.some((e) => e.source === entry.id))
    out.push({ message: "La Entrada no está conectada a ningún paso.", nodeId: entry.id });
  if (!nodes.some((n) => (n.data as JData).kind === "exit"))
    out.push({ message: "Agregá un nodo de Fin para cerrar el recorrido." });
  for (const n of nodes) {
    const d = n.data as JData;
    if (d.kind === "branch") {
      const outs = edges.filter((e) => e.source === n.id).map((e) => e.sourceHandle);
      if (!outs.includes("yes") || !outs.includes("no"))
        out.push({
          message: `La rama "${summaryOf("branch", d.params)}" necesita salida Sí y No.`,
          nodeId: n.id,
        });
    }
    if (d.kind === "send" && !d.params.templateName && !d.params.subject)
      out.push({ message: "Un paso Enviar no tiene plantilla/asunto.", nodeId: n.id });
    if (
      d.kind !== "entry" &&
      JOURNEY_KINDS[d.kind].hasTarget &&
      !edges.some((e) => e.target === n.id)
    )
      out.push({
        message: `Paso "${JOURNEY_KINDS[d.kind].label}" suelto (sin entrada).`,
        nodeId: n.id,
      });
  }
  return out;
}

// ── Wrapper con provider ────────────────────────────────────────────────────
export function JourneyBuilder(props: {
  initial: Journey;
  onSave?: (j: Journey) => void | Promise<void>;
  saving?: boolean;
  onBack?: () => void;
}) {
  return (
    <ReactFlowProvider>
      <JourneyBuilderInner {...props} />
    </ReactFlowProvider>
  );
}

function JourneyBuilderInner({
  initial,
  onSave,
  saving,
  onBack,
}: {
  initial: Journey;
  onSave?: (j: Journey) => void | Promise<void>;
  saving?: boolean;
  onBack?: () => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    layoutLR(toRFNodes(initial), toRFEdges(initial)),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toRFEdges(initial));
  const [name, setName] = useState(initial.name);
  const [status, setStatus] = useState<Journey["status"]>(initial.status);
  const [entry, setEntry] = useState(initial.entry || { manual: true });
  const [reenroll, setReenroll] = useState(!!initial.reenroll);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [stats, setStats] = useState<JourneyStats | null>(null);

  // Recargar al cambiar de journey.
  useEffect(() => {
    setNodes(layoutLR(toRFNodes(initial), toRFEdges(initial)));
    setEdges(toRFEdges(initial));
    setName(initial.name);
    setStatus(initial.status);
    setEntry(initial.entry || { manual: true });
    setReenroll(!!initial.reenroll);
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.journeyId]);

  // Observabilidad (3C): trae el embudo del journey guardado y pinta el conteo
  // de leads en cada nodo (data.count) + el timeline en el inspector.
  useEffect(() => {
    const url = getApiEndpoints()?.manageLeads;
    if (!url || !initial.journeyId) {
      setStats(null);
      return;
    }
    authedFetch(`${url}?journeyStats=${encodeURIComponent(initial.journeyId)}`)
      .then((r) => r.json())
      .then((j) => setStats((j?.stats as JourneyStats) || null))
      .catch(() => setStats(null));
  }, [initial.journeyId]);

  // Inyecta el conteo por nodo en data.count cuando llegan las stats.
  useEffect(() => {
    const byNode = stats?.byNode || {};
    setNodes((nds) =>
      nds.map((n) => ({ ...n, data: { ...(n.data as JData), count: byNode[n.id] || 0 } })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, ...edgeDefaults }, eds)),
    [setEdges],
  );

  const addNode = useCallback(
    (kind: JourneyNodeKind) => {
      const sel = selectedId ? nodes.find((n) => n.id === selectedId) : null;
      let pos: { x: number; y: number };
      if (sel) {
        pos = { x: sel.position.x + COL_GAP, y: sel.position.y };
      } else {
        const rect = wrapperRef.current?.getBoundingClientRect();
        pos = rect
          ? screenToFlowPosition({ x: rect.x + rect.width / 2 - 105, y: rect.y + rect.height / 3 })
          : { x: 120, y: 120 };
      }
      const id = rid();
      setNodes((nds) => [
        ...nds,
        { id, type: "journey", position: pos, data: { kind, params: {} } },
      ]);
      // Autoconecta desde el primer conector libre del nodo seleccionado.
      if (sel) {
        const def = JOURNEY_KINDS[(sel.data as JData).kind];
        const firstOutlet = def.outlets.find(
          (o) => !edges.some((e) => e.source === sel.id && e.sourceHandle === o.id),
        );
        if (firstOutlet) {
          setEdges((eds) =>
            addEdge(
              {
                source: sel.id,
                sourceHandle: firstOutlet.id,
                target: id,
                targetHandle: null,
                ...edgeDefaults,
              },
              eds,
            ),
          );
        }
      }
      setSelectedId(id);
    },
    [screenToFlowPosition, setNodes, setEdges, selectedId, nodes, edges],
  );

  const updateNodeParams = useCallback(
    (id: string, patch: NodeParams) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? {
                ...n,
                data: { ...(n.data as JData), params: { ...(n.data as JData).params, ...patch } },
              }
            : n,
        ),
      );
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedId(null);
    },
    [setNodes, setEdges],
  );

  const arrange = useCallback(() => {
    setNodes((nds) => layoutLR(nds, edges));
    window.setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 60);
  }, [setNodes, edges, fitView]);

  const issues = useMemo(() => validateJourney(nodes, edges), [nodes, edges]);
  const selectedNode = nodes.find((n) => n.id === selectedId) || null;

  const currentJourney = useMemo<Journey>(
    () => ({
      journeyId: initial.journeyId,
      name,
      status,
      entry,
      reenroll,
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: (n.data as JData).kind,
        params: (n.data as JData).params,
        position: n.position,
      })) as JourneyNode[],
      edges: edges.map((e) => ({
        from: e.source,
        to: e.target,
        on: e.sourceHandle === "yes" ? "yes" : e.sourceHandle === "no" ? "no" : undefined,
      })),
      goal: initial.goal,
    }),
    [initial.journeyId, initial.goal, name, status, entry, reenroll, nodes, edges],
  );

  const goToIssue = useCallback(
    (nodeId?: string) => {
      if (!nodeId) return;
      setSelectedId(nodeId);
      window.setTimeout(
        () => fitView({ nodes: [{ id: nodeId }], duration: 400, maxZoom: 1.2, padding: 0.6 }),
        30,
      );
    },
    [fitView],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      <div className="fb-bar">
        {onBack && (
          <button onClick={onBack} title="Volver a mis journeys" className="fb-bar__back">
            ←
          </button>
        )}
        <span className="fb-bar__icon">
          <Network size={16} />
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del journey"
          className="fb-bar__name"
        />
        <div className={`fb-status fb-status--${status}`}>
          <span className="fb-status__dot" />
          <select value={status} onChange={(e) => setStatus(e.target.value as Journey["status"])}>
            <option value="draft">Borrador</option>
            <option value="active">Activo</option>
            <option value="paused">Pausado</option>
          </select>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {stats && stats.total > 0 && (
            <span
              className="fb-chip"
              title={`${stats.byStatus.active || 0} activos · ${stats.byStatus.done || 0} completados`}
            >
              {stats.total} inscrito{stats.total === 1 ? "" : "s"}
            </span>
          )}
          <button
            onClick={() => setShowIssues((s) => !s)}
            title="Validación del recorrido"
            className={`fb-chip ${issues.length ? "fb-chip--warn" : "fb-chip--ok"}`}
          >
            {issues.length ? <AlertTriangle size={13} /> : <Check size={13} />}
            {issues.length ? `${issues.length} aviso${issues.length > 1 ? "s" : ""}` : "Sin avisos"}
          </button>
          <button
            onClick={arrange}
            title="Ordenar automáticamente (izq → der)"
            className="btn btn--sm"
          >
            <Network size={13} /> Ordenar
          </button>
          <button
            onClick={() => onSave?.(currentJourney)}
            disabled={saving}
            className="btn btn--primary btn--sm"
          >
            <Save size={13} /> {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {showIssues && issues.length > 0 && (
        <div className="fb-issues">
          {issues.map((i, idx) => (
            <button
              key={idx}
              className="fb-issue"
              onClick={() => goToIssue(i.nodeId)}
              disabled={!i.nodeId}
              title={i.nodeId ? "Ir al paso" : undefined}
            >
              <AlertTriangle size={12} />
              <span className="fb-issue__msg">{i.message}</span>
              {i.nodeId && <span className="fb-issue__go">Ver paso →</span>}
            </button>
          ))}
        </div>
      )}

      {/* Body: paleta | lienzo | inspector */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <JourneyPalette onAdd={addNode} />
        <div ref={wrapperRef} style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <div style={{ position: "absolute", inset: 0 }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, n) => setSelectedId(n.id)}
              onPaneClick={() => setSelectedId(null)}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={edgeDefaults}
              fitView
              proOptions={{ hideAttribution: true }}
              style={{ background: "var(--bg-1)" }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1}
                color="var(--border-1)"
              />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(n) => JOURNEY_KINDS[(n.data as JData).kind]?.accent || "#888"}
                nodeStrokeWidth={2}
                maskColor="rgba(10,16,28,0.6)"
              />
            </ReactFlow>
          </div>
        </div>
        <JourneyInspector
          node={selectedNode}
          entry={entry}
          reenroll={reenroll}
          stats={stats}
          onEntry={setEntry}
          onReenroll={setReenroll}
          onParams={updateNodeParams}
          onDelete={deleteNode}
        />
      </div>
    </div>
  );
}

// ── Paleta izquierda ────────────────────────────────────────────────────────
function JourneyPalette({ onAdd }: { onAdd: (k: JourneyNodeKind) => void }) {
  return (
    <div
      style={{
        width: 168,
        borderRight: "1px solid var(--border-1)",
        background: "var(--bg-2)",
        padding: 12,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          marginBottom: 10,
        }}
      >
        Agregar paso
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {PALETTE.map((k) => {
          const def = JOURNEY_KINDS[k];
          const Icon = def.icon;
          return (
            <button
              key={k}
              onClick={() => onAdd(k)}
              title={`Agregar "${def.label}"`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "9px 10px",
                borderRadius: 9,
                border: "1px solid var(--border-2)",
                background: "var(--bg-1)",
                color: "var(--text-1)",
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: 700,
                textAlign: "left",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  width: 22,
                  height: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 6,
                  background: `${def.accent}1a`,
                  color: def.accent,
                }}
              >
                <Icon size={13} strokeWidth={2.2} />
              </span>
              {def.label}
              <Plus size={12} style={{ marginLeft: "auto", color: "var(--text-3)" }} />
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 14, fontSize: 10.5, color: "var(--text-3)", lineHeight: 1.5 }}>
        Tip: seleccioná un paso y agregá el siguiente — se conecta solo. O tirá una línea entre los
        puntos de conexión.
      </div>
    </div>
  );
}

// ── Inspector derecho ───────────────────────────────────────────────────────
const OP_LABELS: Record<FilterOp, string> = {
  eq: "es igual a",
  neq: "no es igual a",
  contains: "contiene",
  gte: "mayor o igual",
  lte: "menor o igual",
  in: "está en (lista)",
  exists: "tiene valor",
  notexists: "no tiene valor",
};
const LEAD_FIELDS = [
  "score",
  "grade",
  "stageId",
  "source",
  "email",
  "company",
  "montoEstimado",
  "utmSource",
];

function RuleRows({
  rules,
  onChange,
}: {
  rules: FilterRule[];
  onChange: (r: FilterRule[]) => void;
}) {
  const set = (i: number, patch: Partial<FilterRule>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <datalist id="jb-fields">
        {LEAD_FIELDS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      {rules.map((r, i) => {
        const noVal = r.op === "exists" || r.op === "notexists";
        return (
          <div key={i} style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <input
              list="jb-fields"
              value={r.field}
              onChange={(e) => set(i, { field: e.target.value })}
              placeholder="campo"
              style={jbInput(88)}
            />
            <select
              value={r.op}
              onChange={(e) => set(i, { op: e.target.value as FilterOp })}
              style={jbInput(96)}
            >
              {(Object.keys(OP_LABELS) as FilterOp[]).map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </select>
            {!noVal && (
              <input
                value={String(r.value ?? "")}
                onChange={(e) => set(i, { value: e.target.value })}
                placeholder="valor"
                style={jbInput(72)}
              />
            )}
            <button
              onClick={() => onChange(rules.filter((_, idx) => idx !== i))}
              title="Quitar"
              style={{
                ...jbInput(26),
                color: "var(--danger, #e5484d)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        onClick={() => onChange([...rules, { field: "score", op: "gte", value: "70" }])}
        className="btn btn--sm"
        style={{ alignSelf: "flex-start" }}
      >
        <Plus size={12} /> Condición
      </button>
    </div>
  );
}

function jbInput(width?: number): React.CSSProperties {
  return {
    width,
    flex: width ? undefined : 1,
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 7,
    border: "1px solid var(--border-2)",
    background: "var(--bg-1)",
    color: "var(--text-1)",
  };
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)" }}>{label}</span>
      {children}
    </label>
  );
}

function JourneyInspector({
  node,
  entry,
  reenroll,
  stats,
  onEntry,
  onReenroll,
  onParams,
  onDelete,
}: {
  node: Node | null;
  entry: NonNullable<Journey["entry"]>;
  reenroll: boolean;
  stats: JourneyStats | null;
  onEntry: (e: NonNullable<Journey["entry"]>) => void;
  onReenroll: (b: boolean) => void;
  onParams: (id: string, patch: NodeParams) => void;
  onDelete: (id: string) => void;
}) {
  const { segments } = useSegments();
  const [templates, setTemplates] = useState<Array<{ name: string }>>([]);
  useEffect(() => {
    const ep = getApiEndpoints();
    if (!ep?.listWhatsAppTemplates) return;
    fetch(ep.listWhatsAppTemplates)
      .then((r) => r.json())
      .then((j) => setTemplates(Array.isArray(j.templates) ? j.templates : []))
      .catch(() => {});
  }, []);

  const wrap: React.CSSProperties = {
    width: 288,
    borderLeft: "1px solid var(--border-1)",
    background: "var(--bg-2)",
    padding: 14,
    overflowY: "auto",
  };

  if (!node) {
    return (
      <div style={wrap}>
        <div style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.5 }}>
          Seleccioná un paso del lienzo para editarlo. Empezá por la <strong>Entrada</strong> para
          definir cómo entran los leads.
        </div>
        {stats && stats.total > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-1)", marginBottom: 8 }}>
              Actividad · {stats.total} inscrito{stats.total === 1 ? "" : "s"}
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              <span
                className="fb-chip"
                style={{ background: "var(--accent-green-soft)", color: "var(--accent-green)" }}
              >
                {stats.byStatus.active || 0} activos
              </span>
              <span className="fb-chip">{stats.byStatus.done || 0} completados</span>
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text-3)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
                marginBottom: 6,
              }}
            >
              Timeline reciente
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {stats.recent.slice(0, 12).map((r, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11.5,
                    color: "var(--text-2)",
                    lineHeight: 1.4,
                    borderLeft: "2px solid var(--border-2)",
                    paddingLeft: 8,
                  }}
                >
                  <div style={{ fontWeight: 700, color: "var(--text-1)" }}>
                    {r.note || `en ${r.node}`}
                  </div>
                  <div style={{ color: "var(--text-3)" }}>
                    {r.leadId.slice(0, 12)} ·{" "}
                    {r.at
                      ? new Date(r.at).toLocaleString("es-PE", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const d = node.data as JData;
  const def = JOURNEY_KINDS[d.kind];
  const p = d.params;
  const set = (patch: NodeParams) => onParams(node.id, patch);

  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span
          style={{
            display: "inline-flex",
            width: 26,
            height: 26,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 7,
            background: `${def.accent}1a`,
            color: def.accent,
          }}
        >
          <def.icon size={15} strokeWidth={2.2} />
        </span>
        <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text-1)" }}>{def.label}</span>
        {d.kind !== "entry" && (
          <button
            onClick={() => onDelete(node.id)}
            title="Eliminar paso"
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: "var(--text-3)",
              cursor: "pointer",
            }}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {d.kind === "entry" && (
          <>
            <Field label="Cómo entran los leads">
              <select
                value={entry.segmentId ? "segment" : entry.trigger || "manual"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "manual") onEntry({ manual: true });
                  else if (v === "segment")
                    onEntry({ segmentId: segments[0]?.segmentId, manual: false });
                  else onEntry({ trigger: v, manual: false });
                }}
                style={jbInput()}
              >
                <option value="manual">Manual (los inscribís vos)</option>
                <option value="new_lead">Al crearse un lead nuevo</option>
                <option value="form_submit">Al enviar un formulario</option>
                <option value="stage_change">Al cambiar de etapa</option>
                <option value="segment">Cuando entra a un segmento</option>
              </select>
            </Field>
            {(entry.segmentId !== undefined || entry.trigger) && (
              <Field label="Segmento (filtro de entrada, opcional)">
                <select
                  value={entry.segmentId || ""}
                  onChange={(e) => onEntry({ ...entry, segmentId: e.target.value || undefined })}
                  style={jbInput()}
                >
                  <option value="">— Sin filtro —</option>
                  {segments.map((s) => (
                    <option key={s.segmentId} value={s.segmentId}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12.5,
                color: "var(--text-2)",
              }}
            >
              <input
                type="checkbox"
                checked={reenroll}
                onChange={(e) => onReenroll(e.target.checked)}
              />
              Permitir re-inscripción (volver a entrar si ya pasó)
            </label>
            <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
              La entrada automática por disparador/segmento se activa en el tick del runner (Fase
              3C). La inscripción manual ya funciona desde Leads.
            </div>
          </>
        )}

        {d.kind === "send" && (
          <>
            <Field label="Canal">
              <select
                value={String(p.channel || "whatsapp")}
                onChange={(e) => set({ channel: e.target.value })}
                style={jbInput()}
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
              </select>
            </Field>
            {p.channel === "email" ? (
              <>
                <Field label="Asunto">
                  <input
                    value={String(p.subject || "")}
                    onChange={(e) => set({ subject: e.target.value })}
                    placeholder="Asunto del correo"
                    style={jbInput()}
                  />
                </Field>
                <Field label="Cuerpo">
                  <textarea
                    value={String(p.body || "")}
                    onChange={(e) => set({ body: e.target.value })}
                    rows={4}
                    placeholder="Texto del correo…"
                    style={{ ...jbInput(), resize: "vertical", fontFamily: "inherit" }}
                  />
                </Field>
              </>
            ) : (
              <Field label="Plantilla de WhatsApp">
                <input
                  list="jb-templates"
                  value={String(p.templateName || "")}
                  onChange={(e) => set({ templateName: e.target.value })}
                  placeholder="nombre_de_la_plantilla"
                  style={jbInput()}
                />
                <datalist id="jb-templates">
                  {templates.map((t) => (
                    <option key={t.name} value={t.name} />
                  ))}
                </datalist>
              </Field>
            )}
            <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
              El envío pasa por el gate de supresión (no le manda a un DNC). El wiring del envío
              real se completa en 3C.
            </div>
          </>
        )}

        {d.kind === "wait" && (
          <>
            <Field label="Tipo de espera">
              <select
                value={Array.isArray(p.untilRule) ? "until" : "days"}
                onChange={(e) =>
                  set(
                    e.target.value === "until"
                      ? { untilRule: [{ field: "grade", op: "eq", value: "A" }], days: undefined }
                      : { days: 1, untilRule: undefined },
                  )
                }
                style={jbInput()}
              >
                <option value="days">Días fijos</option>
                <option value="until">Hasta que se cumpla una condición</option>
              </select>
            </Field>
            {Array.isArray(p.untilRule) ? (
              <Field label="Esperar hasta que (todas)">
                <RuleRows
                  rules={p.untilRule as FilterRule[]}
                  onChange={(r) => set({ untilRule: r })}
                />
              </Field>
            ) : (
              <Field label="Días a esperar">
                <input
                  type="number"
                  min={0}
                  value={Number(p.days ?? 1)}
                  onChange={(e) => set({ days: Math.max(0, Number(e.target.value)) })}
                  style={jbInput(90)}
                />
              </Field>
            )}
          </>
        )}

        {d.kind === "branch" && (
          <>
            <Field label="Coincidir">
              <select
                value={String(p.match || "all")}
                onChange={(e) => set({ match: e.target.value })}
                style={jbInput()}
              >
                <option value="all">Todas las condiciones (Y)</option>
                <option value="any">Cualquier condición (O)</option>
              </select>
            </Field>
            <Field label="Condiciones">
              <RuleRows
                rules={(p.rules as FilterRule[]) || []}
                onChange={(r) => set({ rules: r })}
              />
            </Field>
            <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
              <strong>Sí</strong> = el lead cumple · <strong>No</strong> = no cumple. Conectá cada
              salida a su paso.
            </div>
          </>
        )}

        {d.kind === "action" && (
          <>
            <Field label="Tipo de acción">
              <select
                value={String(p.type || "moveStage")}
                onChange={(e) => set({ type: e.target.value })}
                style={jbInput()}
              >
                <option value="moveStage">Mover a etapa</option>
                <option value="webhook">Llamar webhook</option>
                <option value="enqueueDialer">Encolar al dialer</option>
              </select>
            </Field>
            {p.type === "webhook" ? (
              <Field label="URL del webhook">
                <input
                  value={String(p.url || "")}
                  onChange={(e) => set({ url: e.target.value })}
                  placeholder="https://…"
                  style={jbInput()}
                />
              </Field>
            ) : p.type === "enqueueDialer" ? (
              <Field label="Campaña (id, opcional)">
                <input
                  value={String(p.campaignId || "")}
                  onChange={(e) => set({ campaignId: e.target.value })}
                  placeholder="id de campaña"
                  style={jbInput()}
                />
              </Field>
            ) : (
              <Field label="Etapa destino (stageId)">
                <input
                  value={String(p.stageId || "")}
                  onChange={(e) => set({ stageId: e.target.value })}
                  placeholder='p.ej. "won"'
                  style={jbInput()}
                />
              </Field>
            )}
          </>
        )}

        {d.kind === "exit" && (
          <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
            Fin del recorrido. Al llegar acá, el lead sale del journey (enrollment «done»).
          </div>
        )}
      </div>
    </div>
  );
}
