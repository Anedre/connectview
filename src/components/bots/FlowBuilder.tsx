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
  MarkerType,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Save, Trash2, AlertTriangle, Check, Play, Bot as BotIcon, Search, Network, Braces, HelpCircle, X, GripVertical } from "lucide-react";
import {
  NODE_KINDS,
  PALETTE_GROUPS,
  makeNode,
  validateBot,
  type Bot,
  type BotNode,
  type NodeKind,
  type FieldDef,
  type ButtonDef,
  type ButtonKind,
  type ListRow,
} from "@/lib/botFlow";
import { StepNode } from "@/components/bots/StepNode";
import { FLOW_ICONS } from "@/components/bots/icons";
import { BuilderCtx } from "@/components/bots/builderCtx";
import { BotTester } from "@/components/bots/BotTester";
import { NodePreview, ConditionPreview, DelayPresets, StartPreview, AiPersonaPresets, BusinessHoursPreview, ABSplitPreview, WebhookTester, HandoffPreview } from "@/components/bots/NodePreview";
import { getApiEndpoints } from "@/lib/api";
import { WaTemplateConfigurator, type WaTemplate } from "@/components/whatsapp/WaTemplateConfigurator";

/**
 * FlowBuilder — the visual chat-flow editor (roadmap #16). A react-flow canvas
 * with a node palette (left), an inspector (right) generated from the
 * NODE_KINDS field catalog, a minimap and live validation. Edits stay in
 * local state; the parent supplies `initial` and an `onSave(bot)` callback so
 * the same builder powers both the real page and the gate-free demo.
 */
const nodeTypes = { step: StepNode };

const EDGE_COLOR = "#22B8D9";
const edgeDefaults = {
  type: "smoothstep",
  animated: false,
  style: { stroke: EDGE_COLOR, strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR, width: 18, height: 18 },
};

/**
 * Auto-layout izquierda→derecha. BFS desde el nodo de inicio: la profundidad de
 * cada nodo = su columna (x), y dentro de la columna se apilan centrados (y).
 * Los nodos no alcanzados van a la última columna. Sin dependencias (dagre/elk).
 */
const COL_GAP = 300;
const ROW_GAP = 175;
function layoutLR(nodes: Node[], edges: Edge[]): Node[] {
  const outgoing = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  nodes.forEach((n) => { outgoing.set(n.id, []); indeg.set(n.id, 0); });
  edges.forEach((e) => {
    if (outgoing.has(e.source) && indeg.has(e.target)) {
      outgoing.get(e.source)!.push(e.target);
      indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
    }
  });
  const depth = new Map<string, number>();
  const queue: string[] = [];
  const start = nodes.find((n) => (n.data as { kind?: string }).kind === "start");
  if (start) { depth.set(start.id, 0); queue.push(start.id); }
  nodes.forEach((n) => {
    if (!depth.has(n.id) && (indeg.get(n.id) || 0) === 0) { depth.set(n.id, 0); queue.push(n.id); }
  });
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    const d = depth.get(id)!;
    for (const t of outgoing.get(id) || []) {
      if (!depth.has(t)) { depth.set(t, d + 1); queue.push(t); }
    }
  }
  const maxD = depth.size ? Math.max(...depth.values()) : 0;
  nodes.forEach((n) => { if (!depth.has(n.id)) depth.set(n.id, maxD + 1); });
  const cols = new Map<number, string[]>();
  nodes.forEach((n) => {
    const d = depth.get(n.id)!;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d)!.push(n.id);
  });
  const pos = new Map<string, { x: number; y: number }>();
  [...cols.keys()].sort((a, b) => a - b).forEach((d) => {
    const ids = cols.get(d)!;
    ids.forEach((id, i) => {
      pos.set(id, { x: d * COL_GAP, y: i * ROW_GAP - ((ids.length - 1) * ROW_GAP) / 2 });
    });
  });
  return nodes.map((n) => ({ ...n, position: pos.get(n.id) || n.position }));
}

/**
 * Conectar-al-soltar: si el punto donde se suelta un paso cae cerca de la
 * salida de otro nodo (a su derecha y a la altura adecuada, para respetar el
 * flujo L→R) y esa salida está libre, devuelve {source, sourceHandle} para
 * autoconectar. Heurística por posición — usa las medidas reales si existen.
 */
const NODE_W_APPROX = 246;
function findDropConnection(
  p: { x: number; y: number },
  nodes: Node[],
  edges: Edge[]
): { source: string; sourceHandle: string } | null {
  let best: { source: string; sourceHandle: string } | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    const kind = (n.data as { kind?: NodeKind }).kind;
    if (!kind) continue;
    const outlets = NODE_KINDS[kind]?.outlets(n.data as Record<string, unknown>) || [];
    const free = outlets.find(
      (o) => !edges.some((e) => e.source === n.id && e.sourceHandle === o.id)
    );
    if (!free) continue;
    const w = n.measured?.width ?? NODE_W_APPROX;
    const h = n.measured?.height ?? 90;
    const dx = p.x - (n.position.x + w);
    const dy = p.y - (n.position.y + h / 2);
    if (dx < -60 || dx > 320 || Math.abs(dy) > 170) continue;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = { source: n.id, sourceHandle: free.id };
    }
  }
  return best;
}

// Friendly labels for selects whose stored value differs from the display.
const SELECT_LABELS: Record<string, Record<string, string>> = {
  op: {
    equals: "es igual a",
    contains: "contiene",
    exists: "tiene algún valor",
    gt: "mayor que",
    lt: "menor que",
    regex: "coincide (regex)",
  },
  unit: { minutes: "minutos", hours: "horas", days: "días" },
};

function toRFNodes(bot: Bot): Node[] {
  return bot.nodes.map((n) => ({
    id: n.id,
    type: "step",
    position: n.position,
    data: { ...n.data, kind: n.kind },
  }));
}
function toRFEdges(bot: Bot): Edge[] {
  return bot.edges.map((e) => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle ?? undefined,
    target: e.target,
    targetHandle: e.targetHandle ?? undefined,
    ...edgeDefaults,
  }));
}

export function FlowBuilder(props: {
  initial: Bot;
  onSave?: (bot: Bot) => void | Promise<void>;
  saving?: boolean;
  onBack?: () => void;
  autoTest?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <FlowBuilderInner {...props} />
    </ReactFlowProvider>
  );
}

function FlowBuilderInner({
  initial,
  onSave,
  saving,
  onBack,
  autoTest,
}: {
  initial: Bot;
  onSave?: (bot: Bot) => void | Promise<void>;
  saving?: boolean;
  onBack?: () => void;
  autoTest?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(toRFNodes(initial));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toRFEdges(initial));
  const [name, setName] = useState(initial.name);
  const [status, setStatus] = useState<Bot["status"]>(initial.status);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [testing, setTesting] = useState(!!autoTest);
  const [waTemplates, setWaTemplates] = useState<WaTemplate[]>([]);
  const [isDropping, setIsDropping] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Mini-tour: abre los tips la primera vez (luego, con el botón «?»).
  useEffect(() => {
    try {
      if (!localStorage.getItem("aira.bot.tips.v1")) {
        setShowHelp(true);
        localStorage.setItem("aira.bot.tips.v1", "1");
      }
    } catch {
      /* localStorage puede estar bloqueado */
    }
  }, []);

  // Approved WhatsApp templates — powers the "Plantilla" node's configurator.
  useEffect(() => {
    const ep = getApiEndpoints();
    if (!ep?.listWhatsAppTemplates) return;
    fetch(ep.listWhatsAppTemplates)
      .then((r) => r.json())
      .then((j) => setWaTemplates(Array.isArray(j.templates) ? j.templates : []))
      .catch(() => { /* templates optional */ });
  }, []);

  // Reset when a different bot is loaded.
  useEffect(() => {
    setNodes(toRFNodes(initial));
    setEdges(toRFEdges(initial));
    setName(initial.name);
    setStatus(initial.status);
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.botId]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, ...edgeDefaults }, eds)),
    [setEdges]
  );

  const currentBot = useMemo<Bot>(
    () => ({
      botId: initial.botId,
      name,
      status,
      trigger: initial.trigger,
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: (n.data as { kind: NodeKind }).kind,
        position: n.position,
        data: Object.fromEntries(
          Object.entries(n.data).filter(([k]) => k !== "kind")
        ),
      })) as BotNode[],
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? null,
        target: e.target,
        targetHandle: e.targetHandle ?? null,
      })),
    }),
    [initial.botId, initial.trigger, name, status, nodes, edges]
  );

  const issues = useMemo(() => validateBot(currentBot), [currentBot]);

  // Saltar al paso de un aviso de validación: lo selecciona y lo encuadra.
  const goToIssue = useCallback(
    (nodeId?: string) => {
      if (!nodeId) return;
      setSelectedId(nodeId);
      window.setTimeout(() => fitView({ nodes: [{ id: nodeId }], duration: 400, maxZoom: 1.2, padding: 0.6 }), 30);
    },
    [fitView]
  );

  const addNode = useCallback(
    (
      kind: NodeKind,
      dropPos?: { x: number; y: number },
      autoConnect?: { source: string; sourceHandle: string }
    ) => {
      // Soltar (arrastrar desde la paleta) = posición exacta del cursor. Click =
      // a la derecha del nodo seleccionado. En ambos casos puede autoconectar.
      const sel = !dropPos && selectedId ? nodes.find((n) => n.id === selectedId) : null;
      let pos: { x: number; y: number };
      if (dropPos) {
        pos = dropPos;
      } else if (sel) {
        pos = { x: sel.position.x + COL_GAP, y: sel.position.y };
      } else {
        const rect = wrapperRef.current?.getBoundingClientRect();
        pos = rect
          ? screenToFlowPosition({ x: rect.x + rect.width / 2 - 117, y: rect.y + rect.height / 3 })
          : { x: 120, y: 120 };
      }
      const node = makeNode(kind, pos);
      setNodes((nds) => [
        ...nds,
        { id: node.id, type: "step", position: node.position, data: { ...node.data, kind } },
      ]);
      // Conexión AUTOMÁTICA: al soltar cerca de una salida (autoConnect) o, en
      // click-add, desde el primer outlet libre del nodo seleccionado.
      if (autoConnect) {
        const conn: Connection = { source: autoConnect.source, sourceHandle: autoConnect.sourceHandle, target: node.id, targetHandle: null };
        setEdges((eds) => addEdge({ ...conn, ...edgeDefaults }, eds));
      } else if (sel) {
        const def = NODE_KINDS[(sel.data as { kind: NodeKind }).kind];
        const firstOutlet = def?.outlets(sel.data as Record<string, unknown>)[0];
        const taken = edges.some((e) => e.source === sel.id && e.sourceHandle === firstOutlet?.id);
        if (firstOutlet && !taken) {
          const conn: Connection = { source: sel.id, sourceHandle: firstOutlet.id, target: node.id, targetHandle: null };
          setEdges((eds) => addEdge({ ...conn, ...edgeDefaults }, eds));
        }
      }
      setSelectedId(node.id);
    },
    [screenToFlowPosition, setNodes, setEdges, selectedId, nodes, edges]
  );

  // "Ordenar" — auto-layout L→R + encuadrar.
  const arrange = useCallback(() => {
    setNodes((nds) => layoutLR(nds, edges));
    window.setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 60);
  }, [setNodes, edges, fitView]);

  // ── Arrastrar pasos desde la paleta al lienzo (HTML5 drag-and-drop) ──
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDropping(false);
      const kind = e.dataTransfer.getData("application/aira-node") as NodeKind;
      if (!kind || !NODE_KINDS[kind]) return;
      // Convierte el punto del cursor a coordenadas del lienzo (respeta zoom/pan)
      // y centra el nodo bajo el puntero. Si cae cerca de una salida, autoconecta.
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const conn = findDropConnection(p, nodes, edges);
      addNode(kind, { x: p.x - 117, y: p.y - 20 }, conn ?? undefined);
    },
    [screenToFlowPosition, addNode, nodes, edges]
  );

  const updateNodeData = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
      );
    },
    [setNodes]
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedId(null);
    },
    [setNodes, setEdges]
  );

  const selectedNode = nodes.find((n) => n.id === selectedId) || null;

  // 1-based step numbers among non-start nodes → the numbered badge (Kommo-style).
  const numberMap = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const nd of nodes) {
      if ((nd.data as { kind: NodeKind }).kind !== "start") {
        n += 1;
        m.set(nd.id, n);
      }
    }
    return m;
  }, [nodes]);

  const builderActions = useMemo(
    () => ({
      updateNodeData,
      selectNode: (id: string) => setSelectedId(id),
      numberOf: (id: string) => numberMap.get(id),
    }),
    [updateNodeData, numberMap]
  );

  return (
    <BuilderCtx.Provider value={builderActions}>
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      <div className="fb-bar">
        {onBack && (
          <button onClick={onBack} title="Volver a mis bots" className="fb-bar__back">←</button>
        )}
        <span className="fb-bar__icon"><BotIcon size={16} /></span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del bot"
          className="fb-bar__name"
        />
        <div className={`fb-status fb-status--${status}`}>
          <span className="fb-status__dot" />
          <select value={status} onChange={(e) => setStatus(e.target.value as Bot["status"])}>
            <option value="draft">Borrador</option>
            <option value="active">Activo</option>
            <option value="paused">Pausado</option>
          </select>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setShowHelp((s) => !s)}
            title="¿Cómo funciona el constructor?"
            className={`fb-chip ${showHelp ? "fb-chip--ok" : ""}`}
          >
            <HelpCircle size={13} /> Ayuda
          </button>
          <button
            onClick={() => setShowIssues((s) => !s)}
            title="Validación del flujo"
            className={`fb-chip ${issues.length ? "fb-chip--warn" : "fb-chip--ok"}`}
          >
            {issues.length ? <AlertTriangle size={13} /> : <Check size={13} />}
            {issues.length ? `${issues.length} aviso${issues.length > 1 ? "s" : ""}` : "Sin avisos"}
          </button>
          <button onClick={arrange} title="Ordenar el flujo automáticamente (izquierda → derecha)" className="btn btn--sm">
            <Network size={13} /> Ordenar
          </button>
          <button
            onClick={() => setTesting((t) => !t)}
            title="Probar el bot en un chat de prueba"
            className={`btn btn--sm ${testing ? "fb-test-on" : ""}`}
          >
            <Play size={13} /> Probar
          </button>
          <button onClick={() => onSave?.(currentBot)} disabled={saving} className="btn btn--primary btn--sm">
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

      {showHelp && (
        <div className="fb-tips">
          <div className="fb-tips__head">
            <HelpCircle size={14} /> Primeros pasos
            <button className="fb-tips__close" onClick={() => setShowHelp(false)} title="Cerrar"><X size={14} /></button>
          </div>
          <ul className="fb-tips__list">
            <li>Arrastrá pasos desde la izquierda al lienzo (o hacé click para agregarlos).</li>
            <li>Conectá dos pasos tirando una línea de un punto al siguiente — o soltá un paso cerca de la salida de otro y se conecta solo.</li>
            <li>Guardá datos con «Preguntar y guardar» y reutilizalos con «Insertar variable».</li>
            <li>Mirá la «Vista previa» del inspector para ver cómo le llega el mensaje al cliente.</li>
            <li>Tocá «Ordenar» para acomodar el flujo y «Probar» para chatear con el bot.</li>
          </ul>
        </div>
      )}

      {/* Body: palette | canvas | inspector */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Palette onAdd={addNode} />

        <div ref={wrapperRef} style={{ flex: 1, position: "relative", minWidth: 0 }}>
          {/* Absolute-fill so react-flow always measures a concrete size
              (avoids the #004 "needs width and height" warning under flex). */}
          <div
            style={{ position: "absolute", inset: 0 }}
            className={isDropping ? "fb-canvas--drop" : undefined}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnter={() => setIsDropping(true)}
            onDragLeave={(e) => {
              // Solo apaga el resaltado al salir del lienzo (no al pasar sobre hijos).
              if (!e.currentTarget.contains(e.relatedTarget as HTMLElement)) setIsDropping(false);
            }}
          >
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
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border-1)" />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(n) =>
                  NODE_KINDS[(n.data as { kind: NodeKind }).kind]?.accent || "#888"
                }
                nodeStrokeWidth={2}
                maskColor="rgba(10,16,28,0.6)"
                style={{ background: "var(--bg-2)", border: "1px solid var(--border-1)", borderRadius: 8 }}
              />
            </ReactFlow>
          </div>
          {nodes.filter((n) => (n.data as { kind?: string }).kind !== "start").length === 0 && (
            <div className="fb-coach">
              <div className="fb-coach__card">
                <span className="fb-coach__arrow" aria-hidden>←</span>
                <div>
                  <div className="fb-coach__h">Armá tu primer flujo</div>
                  <div className="fb-coach__p">
                    Arrastrá un paso desde la izquierda (o hacé click en uno). Para conectar dos
                    pasos, tirá una línea de un punto al siguiente — o soltá un paso cerca de la
                    salida de otro y se conecta solo.
                  </div>
                </div>
              </div>
            </div>
          )}
          {testing && <BotTester bot={currentBot} onClose={() => setTesting(false)} />}
        </div>

        {selectedNode && (
          <Inspector
            key={selectedNode.id}
            node={selectedNode}
            allNodes={nodes}
            waTemplates={waTemplates}
            onChange={(patch) => updateNodeData(selectedNode.id, patch)}
            onDelete={() => deleteNode(selectedNode.id)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
    </BuilderCtx.Provider>
  );
}

/* ─────────────────────────── Palette ─────────────────────────── */

function Palette({ onAdd }: { onAdd: (kind: NodeKind) => void }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  return (
    <div className="fb-pal">
      <div className="fb-pal__title">Pasos</div>
      <div className="fb-pal__search">
        <Search size={13} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar paso…" />
      </div>
      {PALETTE_GROUPS.map((group) => {
        const items = Object.values(NODE_KINDS).filter(
          (k) => k.group === group && (!query || k.label.toLowerCase().includes(query) || k.blurb.toLowerCase().includes(query))
        );
        if (items.length === 0) return null;
        return (
          <div key={group} className="fb-pal__group">
            <div className="fb-pal__group-h">{group}</div>
            {items.map((def) => {
              const Icn = FLOW_ICONS[def.icon] || FLOW_ICONS.message;
              return (
                <button
                  key={def.kind}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/aira-node", def.kind);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => onAdd(def.kind)}
                  title={`${def.blurb} — clic para agregar o arrastrá al lienzo`}
                  className="fb-pal__item"
                >
                  <span className="fb-pal__icon" style={{ background: `${def.accent}1a`, color: def.accent }}>
                    <Icn size={14} strokeWidth={2.2} />
                  </span>
                  <span className="fb-pal__item-label">{def.label}</span>
                  <Plus size={13} className="fb-pal__item-add" />
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Inspector ─────────────────────────── */

function Inspector({
  node,
  allNodes,
  waTemplates,
  onChange,
  onDelete,
  onClose,
}: {
  node: Node;
  allNodes: Node[];
  waTemplates: WaTemplate[];
  onChange: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const kind = (node.data as { kind: NodeKind }).kind;
  const def = NODE_KINDS[kind];
  const data = node.data as Record<string, unknown>;
  const Icn = FLOW_ICONS[def.icon] || FLOW_ICONS.message;

  // Variables capturadas en el flujo (pasos "Pregunta" → saveAs, "Set field" → field)
  // para ofrecerlas en el configurador de plantillas (modo flujo).
  const flowVars = Array.from(
    new Set(
      allNodes.flatMap((n) => {
        const d = n.data as { kind?: string; saveAs?: unknown; field?: unknown };
        const out: string[] = [];
        if (d.kind === "question" && typeof d.saveAs === "string" && d.saveAs.trim()) out.push(d.saveAs.trim());
        if (d.kind === "set_field" && typeof d.field === "string" && d.field.trim()) out.push(d.field.trim());
        return out;
      })
    )
  );

  return (
    <div className="fb-insp">
      <div className="fb-insp__head" style={{ background: `linear-gradient(135deg, ${def.accent}14, transparent 80%)` }}>
        <span className="fb-insp__icon" style={{ background: `${def.accent}1f`, color: def.accent }}>
          <Icn size={15} strokeWidth={2.2} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="fb-insp__title">{def.label}</div>
          <div className="fb-insp__blurb">{def.blurb}</div>
        </div>
        <button onClick={onClose} className="fb-insp__close" title="Cerrar">×</button>
      </div>

      <div className="fb-insp__body">
        <NodePreview kind={kind} data={data} />
        {kind === "start" && <StartPreview data={data} />}
        {kind === "condition" && <ConditionPreview data={data} />}
        {kind === "business_hours" && <BusinessHoursPreview data={data} />}
        {kind === "ab_split" && <ABSplitPreview data={data} />}
        {kind === "delay" && <DelayPresets data={data} onChange={onChange} />}
        {kind === "ai_agent" && <AiPersonaPresets onChange={onChange} />}
        {kind === "handoff" && <HandoffPreview data={data} />}
        {kind === "webhook" && <WebhookTester data={data} />}
        {kind === "template" ? (
          <WaTemplateConfigurator
            mode="flow"
            templates={waTemplates}
            templateName={typeof data.templateName === "string" ? data.templateName : ""}
            language={typeof data.language === "string" ? data.language : "es"}
            variables={Array.isArray(data.variables) ? (data.variables as string[]) : []}
            flowVars={flowVars}
            onChange={(v) => onChange(v)}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {def.fields.map((f) => (
              <Field
                key={f.key}
                field={f}
                value={data[f.key]}
                allNodes={allNodes}
                selfId={node.id}
                flowVars={flowVars}
                onChange={(v) => onChange({ [f.key]: v })}
              />
            ))}
            {def.fields.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>Este paso no tiene opciones.</div>
            )}
          </div>
        )}

        <button onClick={onDelete} className="fb-insp__delete">
          <Trash2 size={13} /> Eliminar paso
        </button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--text-2)",
  marginBottom: 5,
  display: "block",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 12.5,
  padding: "7px 9px",
  borderRadius: 7,
  border: "1px solid var(--border-1)",
  background: "var(--bg-1)",
  color: "var(--text-1)",
  boxSizing: "border-box",
};

const EMOJIS = ["😊", "👋", "🎉", "✅", "❤️", "🙌", "👍", "📅", "📞", "💳", "🎁", "⭐", "🔥", "💡", "📌", "🛒", "🤖", "🙏", "✨", "📎"];

/** Fila de chips para insertar una variable guardada en el cursor del campo. */
function VarInsert({ vars, onInsert }: { vars: string[]; onInsert: (name: string) => void }) {
  return (
    <div className="fb-varins">
      <span className="fb-varins__lbl"><Braces size={11} /> Insertar variable</span>
      {vars.map((vn) => (
        <button
          key={vn}
          type="button"
          className="fb-varchip"
          onClick={() => onInsert(vn)}
          title={`Insertar {{${vn}}}`}
        >
          {vn}
        </button>
      ))}
    </div>
  );
}

function Field({
  field,
  value,
  allNodes,
  selfId,
  flowVars,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  allNodes: Node[];
  selfId: string;
  flowVars: string[];
  onChange: (v: unknown) => void;
}) {
  const v = value;
  const labelMap = SELECT_LABELS[field.key];
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);

  const isDefine = field.variable === "define";
  const isUse = field.variable === "use";
  const isInsert = field.variable === "insert";
  const mono = isDefine || isUse;
  const dataListId = `vars-${selfId}-${field.key}`;
  const hasList = isUse || (field.suggestions?.length ?? 0) > 0;
  const txt = String(v ?? "");
  // Validación de JSON en vivo (reemplaza {{vars}} por null para chequear estructura).
  const jsonError =
    field.json && txt.trim()
      ? (() => {
          try {
            JSON.parse(txt.replace(/\{\{[^}]+\}\}/g, "null"));
            return false;
          } catch {
            return true;
          }
        })()
      : false;

  // Inserta texto en la posición del cursor (o al final si no hay foco).
  const insertAtCursor = (text: string) => {
    const el = fieldRef.current;
    const cur = String(v ?? "");
    if (!el || el.selectionStart == null) {
      onChange(cur + text);
      return;
    }
    const s = el.selectionStart;
    const e = el.selectionEnd ?? s;
    onChange(cur.slice(0, s) + text + cur.slice(e));
    requestAnimationFrame(() => {
      try {
        el.focus();
        const p = s + text.length;
        el.setSelectionRange(p, p);
      } catch {
        /* el puede haberse desmontado */
      }
    });
  };
  const insertVar = (name: string) => insertAtCursor(`{{${name}}}`);

  return (
    <div>
      <label style={labelStyle}>{field.label}</label>

      {field.type === "textarea" && (
        <textarea
          ref={fieldRef as React.RefObject<HTMLTextAreaElement>}
          value={String(v ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
      )}
      {field.type === "textarea" && (
        <div style={{ marginTop: 4 }}>
          <button type="button" className="fb-emoji-btn" onClick={() => setShowEmoji((s) => !s)} title="Insertar emoji">
            <span style={{ fontSize: 13 }}>😊</span> Emoji
          </button>
          {showEmoji && (
            <div className="fb-emoji-grid">
              {EMOJIS.map((em) => (
                <button key={em} type="button" className="fb-emoji" onClick={() => insertAtCursor(em)}>{em}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {(field.type === "text" || field.type === "var") && (
        <input
          ref={fieldRef as React.RefObject<HTMLInputElement>}
          value={String(v ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          list={hasList ? dataListId : undefined}
          style={{ ...inputStyle, fontFamily: mono ? "var(--font-mono, monospace)" : "inherit" }}
        />
      )}
      {hasList && (
        <datalist id={dataListId}>
          {(isUse ? flowVars : field.suggestions ?? []).map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
      )}

      {field.type === "number" && field.slider && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="range"
            min={field.slider.min}
            max={field.slider.max}
            step={field.slider.step ?? 1}
            value={Number(v) || field.slider.min}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ minWidth: 26, textAlign: "right", fontSize: 13, fontWeight: 700, color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>
            {Number(v) || field.slider.min}
          </span>
        </div>
      )}
      {field.type === "number" && !field.slider && (
        <input
          type="number"
          value={String(v ?? "")}
          onChange={(e) => onChange(Number(e.target.value))}
          placeholder={field.placeholder}
          style={inputStyle}
        />
      )}

      {field.type === "select" && (
        <select value={String(v ?? "")} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {labelMap?.[o] || o}
            </option>
          ))}
        </select>
      )}

      {field.type === "node-ref" && (
        <select value={String(v ?? "")} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          <option value="">— elegir paso —</option>
          {allNodes
            .filter((n) => n.id !== selfId)
            .map((n) => {
              const k = (n.data as { kind: NodeKind }).kind;
              return (
                <option key={n.id} value={n.id}>
                  {NODE_KINDS[k].label}: {NODE_KINDS[k].summary(n.data as Record<string, unknown>).slice(0, 28)}
                </option>
              );
            })}
        </select>
      )}

      {field.type === "buttons" && (
        <ButtonsEditor value={Array.isArray(v) ? (v as ButtonDef[]) : []} onChange={onChange} />
      )}

      {field.type === "varlist" && (
        <VarListEditor value={Array.isArray(v) ? (v as string[]) : []} onChange={onChange} />
      )}

      {field.type === "listrows" && (
        <ListRowsEditor value={Array.isArray(v) ? (v as ListRow[]) : []} onChange={onChange} />
      )}

      {/* Afford. didáctica de variables */}
      {isDefine && (
        <div className="fb-vardef">
          <Braces size={11} />
          {String(v ?? "").trim() ? (
            <span>Se crea la variable <span className="fb-var">{`{{${String(v).trim()}}}`}</span></span>
          ) : (
            <span>Ponele un nombre y se crea una variable reutilizable.</span>
          )}
        </div>
      )}
      {isUse && flowVars.length === 0 && (
        <div className="fb-varhint">
          <Braces size={11} /> Primero guardá una variable con un paso «Preguntar y guardar».
        </div>
      )}
      {isInsert && flowVars.length > 0 && <VarInsert vars={flowVars} onInsert={insertVar} />}
      {isInsert && flowVars.length === 0 && field.type === "textarea" && (
        <div className="fb-varhint">
          <Braces size={11} /> Guardá datos con un paso «Preguntar y guardar» y aparecerán acá para insertarlos.
        </div>
      )}

      {(field.counter || (field.json && txt.trim())) && (
        <div className="fb-fieldmeta">
          {field.json && txt.trim() && (
            <span className={jsonError ? "fb-meta-bad" : "fb-meta-ok"}>
              {jsonError ? <><AlertTriangle size={11} /> Revisá el JSON</> : <><Check size={11} /> JSON válido</>}
            </span>
          )}
          {field.counter && (
            <span className={txt.length > field.counter ? "fb-meta-bad" : "fb-meta-count"}>
              {txt.length}/{field.counter}
            </span>
          )}
        </div>
      )}

      {field.help && (
        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 4 }}>{field.help}</div>
      )}
    </div>
  );
}

const uid = () => Math.random().toString(36).slice(2, 7);

const addBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11.5,
  padding: "6px 9px",
  borderRadius: 7,
  border: "1px dashed var(--border-1)",
  background: "transparent",
  color: "var(--text-2)",
  cursor: "pointer",
  justifyContent: "center",
};
const xBtnStyle: React.CSSProperties = {
  border: "1px solid var(--border-1)",
  background: "var(--bg-1)",
  color: "var(--text-3)",
  borderRadius: 7,
  padding: "0 9px",
  cursor: "pointer",
  flex: "0 0 auto",
};

function ButtonsEditor({
  value,
  onChange,
}: {
  value: ButtonDef[];
  onChange: (v: ButtonDef[]) => void;
}) {
  const max = 3; // WhatsApp interactive button messages allow up to 3 buttons
  const add = () => {
    if (value.length >= max) return;
    onChange([...value, { id: uid(), label: "", type: "reply" }]);
  };
  const update = (id: string, patch: Partial<ButtonDef>) =>
    onChange(value.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const remove = (id: string) => onChange(value.filter((b) => b.id !== id));
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...value];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {value.map((b, i) => {
        const type = b.type || "reply";
        const valErr =
          type === "url" && b.value && !/^https?:\/\/.+/i.test(b.value.trim())
            ? "Empezá con http:// o https://"
            : type === "phone" && b.value && !/^\+?[\d\s().-]{6,}$/.test(b.value.trim())
            ? "Usá formato internacional, p. ej. +51 999 888 777"
            : null;
        return (
          <div
            key={b.id}
            onDragOver={(e) => { if (dragIdx !== null) e.preventDefault(); }}
            onDrop={() => { if (dragIdx !== null) move(dragIdx, i); setDragIdx(null); }}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 5,
              padding: 8,
              border: "1px solid var(--border-1)",
              borderRadius: 8,
              background: "var(--bg-1)",
              opacity: dragIdx === i ? 0.5 : 1,
            }}
          >
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span
                className="fb-grip"
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragEnd={() => setDragIdx(null)}
                title="Arrastrar para reordenar"
              >
                <GripVertical size={13} />
              </span>
              <input
                value={b.label}
                onChange={(e) => update(b.id, { label: e.target.value })}
                placeholder="Texto del botón"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button onClick={() => remove(b.id)} style={xBtnStyle} title="Quitar">×</button>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <select
                value={type}
                onChange={(e) => update(b.id, { type: e.target.value as ButtonKind })}
                style={{ ...inputStyle, flex: "0 0 116px" }}
              >
                <option value="reply">Respuesta</option>
                <option value="url">Enlace</option>
                <option value="phone">Llamada</option>
              </select>
              {type !== "reply" && (
                <input
                  value={b.value || ""}
                  onChange={(e) => update(b.id, { value: e.target.value })}
                  placeholder={type === "url" ? "https://…" : "+51…"}
                  style={{ ...inputStyle, flex: 1, borderColor: valErr ? "var(--accent-red)" : undefined }}
                />
              )}
            </div>
            {valErr && <div className="fb-btnerr"><AlertTriangle size={10} /> {valErr}</div>}
          </div>
        );
      })}
      <button
        onClick={add}
        disabled={value.length >= max}
        style={{ ...addBtnStyle, opacity: value.length >= max ? 0.5 : 1, cursor: value.length >= max ? "default" : "pointer" }}
      >
        <Plus size={12} /> Agregar botón · {value.length}/{max}
      </button>
      <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
        Solo los botones de <strong>Respuesta</strong> crean ramas en el flujo.
      </div>
    </div>
  );
}

function VarListEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const add = () => onChange([...value, ""]);
  const update = (i: number, val: string) => onChange(value.map((x, idx) => (idx === i ? val : x)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {value.map((val, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)", color: "var(--text-3)", flex: "0 0 36px" }}>
            {`{{${i + 1}}}`}
          </span>
          <input
            value={val}
            onChange={(e) => update(i, e.target.value)}
            placeholder="valor o {{variable}}"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={() => remove(i)} style={xBtnStyle} title="Quitar">×</button>
        </div>
      ))}
      <button onClick={add} style={addBtnStyle}>
        <Plus size={12} /> Agregar variable
      </button>
    </div>
  );
}

function ListRowsEditor({ value, onChange }: { value: ListRow[]; onChange: (v: ListRow[]) => void }) {
  const max = 10; // WhatsApp list messages allow up to 10 rows
  const add = () => {
    if (value.length >= max) return;
    onChange([...value, { id: uid(), title: "", description: "" }]);
  };
  const update = (id: string, patch: Partial<ListRow>) =>
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => onChange(value.filter((r) => r.id !== id));
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...value];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {value.map((r, i) => (
        <div
          key={r.id}
          onDragOver={(e) => { if (dragIdx !== null) e.preventDefault(); }}
          onDrop={() => { if (dragIdx !== null) move(dragIdx, i); setDragIdx(null); }}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            padding: 8,
            border: "1px solid var(--border-1)",
            borderRadius: 8,
            background: "var(--bg-1)",
            opacity: dragIdx === i ? 0.5 : 1,
          }}
        >
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="fb-grip" draggable onDragStart={() => setDragIdx(i)} onDragEnd={() => setDragIdx(null)} title="Arrastrar para reordenar">
              <GripVertical size={13} />
            </span>
            <input
              value={r.title}
              onChange={(e) => update(r.id, { title: e.target.value })}
              placeholder="Título de la opción"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={() => remove(r.id)} style={xBtnStyle} title="Quitar">×</button>
          </div>
          <input
            value={r.description || ""}
            onChange={(e) => update(r.id, { description: e.target.value })}
            placeholder="Descripción (opcional)"
            style={inputStyle}
          />
        </div>
      ))}
      <button
        onClick={add}
        disabled={value.length >= max}
        style={{ ...addBtnStyle, opacity: value.length >= max ? 0.5 : 1, cursor: value.length >= max ? "default" : "pointer" }}
      >
        <Plus size={12} /> Agregar opción · {value.length}/{max}
      </button>
    </div>
  );
}
