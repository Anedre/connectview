import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  reconnectEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type OnConnectStart,
  type OnConnectEnd,
  type OnReconnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Plus,
  Save,
  AlertTriangle,
  Check,
  Users,
  Search,
  Network,
  Download,
  Upload,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import {
  JOURNEY_KINDS,
  JOURNEY_PALETTE_GROUPS,
  journeyIcon,
  validateJourney,
  type JourneyParams,
} from "@/lib/journeyFlow";
import type { Journey, JourneyNode, JourneyNodeKind, JourneyStats } from "@/hooks/useJourneys";
import { journeyNodeTypes, JourneyStepNode } from "@/components/journeys/JourneyStepNode";
import { PlusEdge, branchColor } from "@/components/bots/PlusEdge";
import { JourneyNodePicker } from "@/components/journeys/JourneyNodePicker";
import { JourneyBuilderCtx } from "@/components/journeys/journeyBuilderCtx";
import { JourneyInspector } from "@/components/journeys/JourneyInspector";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";

/**
 * JourneyFlowBuilder — el editor de Journeys rediseñado al MISMO build-flow de
 * Bots: un canvas React Flow horizontal (step-by-step / AWS Step Functions) con
 * palette a la izquierda, nodos-estación premium (JourneyStepNode, con embudo de
 * gente), edges con "+/×" y ramas rotuladas (Sí/No · A/B), NodePicker, inspector
 * a la derecha, "Ordenar" (auto-layout L→R), import/export y avisos premium.
 * Reutiliza la CSS .fb-* y el PlusEdge de Bots. El modelo (nodes+edges+position)
 * es el nativo del journey; el avance lo corre el journey-runner por tick.
 */

const rid = () => Math.random().toString(36).slice(2, 9);

const nodeTypes = journeyNodeTypes;
const edgeTypes = { plus: PlusEdge };

const EDGE_COLOR = "#64748B";
const edgeDefaults = {
  type: "plus",
  animated: false,
  style: { stroke: EDGE_COLOR, strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR, width: 18, height: 18 },
};

const ROW_GAP = 120; // pitch VERTICAL (tarjeta-estado ~58 alto + aire)
const GAP_X = 56; // aire horizontal entre estados de la misma fila (ramas)
const NODE_W_APPROX = 240;
const NODE_H_APPROX = 60;

// ── Auto-layout ARRIBA→ABAJO (identidad Step Functions): BFS por FILAS desde la
//    Entrada + baricentro anti-cruce + repartido por ancho medido. Transpuesta
//    del layoutLR de Bots (x↔y, H↔W) para que el tiempo BAJE. ──
function layoutTB(nodes: Node[], edges: Edge[]): Node[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  nodes.forEach((n) => {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  });
  edges.forEach((e) => {
    if (outgoing.has(e.source) && incoming.has(e.target)) {
      outgoing.get(e.source)!.push(e.target);
      incoming.get(e.target)!.push(e.source);
    }
  });

  // (1) Profundidad = FILA. BFS desde la Entrada; raíces sueltas también en 0.
  const depth = new Map<string, number>();
  const queue: string[] = [];
  const start = nodes.find((n) => (n.data as { kind?: string }).kind === "entry");
  if (start) {
    depth.set(start.id, 0);
    queue.push(start.id);
  }
  nodes.forEach((n) => {
    if (!depth.has(n.id) && (incoming.get(n.id)?.length ?? 0) === 0) {
      depth.set(n.id, 0);
      queue.push(n.id);
    }
  });
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    const d = depth.get(id)!;
    for (const t of outgoing.get(id) || []) {
      if (!depth.has(t)) {
        depth.set(t, d + 1);
        queue.push(t);
      }
    }
  }
  const maxD = depth.size ? Math.max(...depth.values()) : 0;
  nodes.forEach((n) => {
    if (!depth.has(n.id)) depth.set(n.id, maxD + 1);
  });
  const rows = new Map<number, string[]>();
  nodes.forEach((n) => {
    const d = depth.get(n.id)!;
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d)!.push(n.id);
  });
  const rowKeys = [...rows.keys()].sort((a, b) => a - b);

  // (2) Orden dentro de la fila por baricentro (reduce cruces de conectores).
  const idxIn = new Map<string, number>();
  const reindex = () => rowKeys.forEach((d) => rows.get(d)!.forEach((id, i) => idxIn.set(id, i)));
  reindex();
  for (let pass = 0; pass < 4; pass++) {
    const ttb = pass % 2 === 0;
    const sweep = ttb ? rowKeys : [...rowKeys].reverse();
    for (const d of sweep) {
      const neigh = ttb ? incoming : outgoing;
      const arr = rows.get(d)!;
      const bary = new Map<string, number>();
      arr.forEach((id) => {
        const ns = (neigh.get(id) || [])
          .map((x) => idxIn.get(x))
          .filter((v): v is number => v != null);
        bary.set(id, ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : idxIn.get(id)!);
      });
      arr.sort((a, b) => bary.get(a)! - bary.get(b)! || idxIn.get(a)! - idxIn.get(b)!);
      reindex();
    }
  }

  // (3) X por ancho medido: reparte la fila y alinea cada estado a sus padres.
  const W = (id: string) => byId.get(id)?.measured?.width ?? NODE_W_APPROX;
  const xc = new Map<string, number>();
  rowKeys.forEach((d) => {
    const arr = rows.get(d)!;
    const total = arr.reduce((s, id) => s + W(id), 0) + GAP_X * Math.max(0, arr.length - 1);
    let cur = -total / 2;
    arr.forEach((id) => {
      xc.set(id, cur + W(id) / 2);
      cur += W(id) + GAP_X;
    });
  });
  for (let pass = 0; pass < 3; pass++) {
    for (const d of rowKeys) {
      const arr = rows.get(d)!;
      const want = arr.map((id) => {
        const ps = (incoming.get(id) || [])
          .map((p) => xc.get(p))
          .filter((v): v is number => v != null);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : xc.get(id)!;
      });
      arr.forEach((id, i) => xc.set(id, want[i]));
      for (let i = 1; i < arr.length; i++) {
        const prev = arr[i - 1];
        const curId = arr[i];
        const minX = xc.get(prev)! + W(prev) / 2 + GAP_X + W(curId) / 2;
        if (xc.get(curId)! < minX) xc.set(curId, minX);
      }
    }
  }

  // Recentrar horizontalmente (que no quede cargado a un lado).
  const xs = [...xc.values()];
  const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  return nodes.map((n) => {
    const d = depth.get(n.id)!;
    const cx = (xc.get(n.id) ?? 0) - mid;
    return { ...n, position: { x: cx - W(n.id) / 2, y: d * ROW_GAP } };
  });
}

function needsLayout(nodes: Node[], edges: Edge[]): boolean {
  if (nodes.length <= 1) return false;
  const seen = new Set<string>();
  for (const n of nodes) {
    const key = `${Math.round(n.position.x / 40)},${Math.round(n.position.y / 40)}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  const pos = new Map(nodes.map((n) => [n.id, n.position]));
  let ttb = 0;
  let total = 0;
  for (const e of edges) {
    const s = pos.get(e.source);
    const t = pos.get(e.target);
    if (!s || !t) continue;
    total++;
    if (t.y > s.y + 40) ttb++; // el destino queda ABAJO del origen (flujo vertical)
  }
  if (total === 0) return false;
  return ttb / total < 0.6;
}

/** Conectar-al-soltar: si el drop cae cerca de una salida libre de otro nodo. */
function findDropConnection(
  p: { x: number; y: number },
  nodes: Node[],
  edges: Edge[],
): { source: string; sourceHandle: string } | null {
  let best: { source: string; sourceHandle: string } | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    const kind = (n.data as { kind?: JourneyNodeKind }).kind;
    if (!kind) continue;
    const outlets =
      JOURNEY_KINDS[kind]?.outlets((n.data as { params?: JourneyParams }).params || {}) || [];
    const free = outlets.find(
      (o) => !edges.some((e) => e.source === n.id && (e.sourceHandle || "out") === o.id),
    );
    if (!free) continue;
    // Vertical: la salida cuelga por ABAJO del nodo → buscamos el drop debajo.
    const w = n.measured?.width ?? NODE_W_APPROX;
    const h = n.measured?.height ?? NODE_H_APPROX;
    const dx = p.x - (n.position.x + w / 2);
    const dy = p.y - (n.position.y + h);
    if (dy < -40 || dy > 260 || Math.abs(dx) > 190) continue;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = { source: n.id, sourceHandle: free.id };
    }
  }
  return best;
}

// ── Conversión modelo Journey ⇄ React Flow ──
function toRFNodes(j: Journey): Node[] {
  return (j.nodes || []).map((n) => ({
    id: n.id,
    type: "jstep",
    position: n.position ?? { x: 0, y: 0 },
    data: { kind: n.kind, params: n.params ?? {} },
  }));
}
/** El modelo guarda `on` (branch→yes/no, lineal→undefined). En RF usamos un
 *  sourceHandle CONCRETO ("out" para lineal) para casar con los handles del nodo. */
function edgeId(from: string, on: string | undefined, to: string): string {
  return `${from}__${on || "out"}__${to}`;
}
function toRFEdges(j: Journey): Edge[] {
  return (j.edges || []).map((e) => ({
    id: edgeId(e.from, e.on, e.to),
    source: e.from,
    sourceHandle: e.on || "out",
    target: e.to,
    ...edgeDefaults,
  }));
}
function initialRFNodes(j: Journey): Node[] {
  const n = toRFNodes(j);
  const e = toRFEdges(j);
  return needsLayout(n, e) ? layoutTB(n, e) : n;
}
function makeRFNode(kind: JourneyNodeKind, pos: { x: number; y: number }): Node {
  return {
    id: rid(),
    type: "jstep",
    position: pos,
    data: { kind, params: JOURNEY_KINDS[kind].defaultParams?.() ?? {} },
  };
}

/** Etiqueta de rama para un edge (Sí/No · A/B), leída del outlet de su origen. */
function branchLabelFor(edge: Edge, nodes: Node[]): string | undefined {
  const handle = edge.sourceHandle;
  if (!handle || handle === "out") return undefined;
  const src = nodes.find((n) => n.id === edge.source);
  if (!src) return undefined;
  const kind = (src.data as { kind?: JourneyNodeKind }).kind;
  if (!kind) return undefined;
  const outlet = JOURNEY_KINDS[kind]
    .outlets((src.data as { params?: JourneyParams }).params || {})
    .find((o) => o.id === handle);
  return outlet?.label;
}

function serializeJourney(nodes: Node[], edges: Edge[], name: string, status: string): string {
  return JSON.stringify({
    name,
    status,
    nodes: nodes.map((n) => ({ id: n.id, data: n.data, position: n.position })),
    edges: edges.map((e) => ({ s: e.source, h: e.sourceHandle, t: e.target })),
  });
}

// ════════════════════════════════════════════════════════════════════════════
export function JourneyFlowBuilder(props: {
  initial: Journey;
  onSave?: (j: Journey) => void | Promise<void>;
  saving?: boolean;
  onBack?: () => void;
}) {
  return (
    <ReactFlowProvider>
      <JourneyFlowInner {...props} />
    </ReactFlowProvider>
  );
}

function JourneyFlowInner({
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
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialRFNodes(initial));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toRFEdges(initial));
  const [name, setName] = useState(initial.name);
  const [status, setStatus] = useState<Journey["status"]>(initial.status);
  const [entry, setEntry] = useState(initial.entry || { manual: true });
  const [reenroll, setReenroll] = useState(!!initial.reenroll);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [rightTab, setRightTab] = useState<"form" | "def">("form");
  const [stats, setStats] = useState<JourneyStats | null>(null);
  const [picker, setPicker] = useState<{
    at: { x: number; y: number };
    mode: "connect" | "insert";
    connect?: { source: string; sourceHandle: string; flowPos: { x: number; y: number } };
    insertEdgeId?: string;
  } | null>(null);
  const [isDropping, setIsDropping] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const connectFrom = useRef<{ nodeId: string; handleId: string | null } | null>(null);
  const madeConnection = useRef(false);
  const baseline = useRef(serializeJourney(nodes, edges, name, status));

  // Recargar al cambiar de journey.
  useEffect(() => {
    const n = initialRFNodes(initial);
    const e = toRFEdges(initial);
    setNodes(n);
    setEdges(e);
    setName(initial.name);
    setStatus(initial.status);
    setEntry(initial.entry || { manual: true });
    setReenroll(!!initial.reenroll);
    setSelectedId(null);
    baseline.current = serializeJourney(n, e, initial.name, initial.status);
    window.setTimeout(() => fitView({ padding: 0.2, duration: 350 }), 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.journeyId]);

  // Observabilidad: embudo por nodo (leads en cada estación).
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

  const dirty = serializeJourney(nodes, edges, name, status) !== baseline.current;

  const issues = useMemo(
    () =>
      validateJourney(
        nodes.map((n) => rfToJourneyNode(n)),
        edges.map((e) => ({ from: e.source, to: e.target, on: onOf(e) })),
      ),
    [nodes, edges],
  );

  const numberMap = useMemo(() => {
    const m = new Map<string, number>();
    let i = 0;
    for (const n of nodes) {
      if ((n.data as { kind?: string }).kind === "entry") continue;
      m.set(n.id, ++i);
    }
    return m;
  }, [nodes]);

  const issuesByNode = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const it of issues) {
      if (!it.nodeId) continue;
      const list = m.get(it.nodeId);
      if (list) list.push(it.message);
      else m.set(it.nodeId, [it.message]);
    }
    return m;
  }, [issues]);

  const byNode = useMemo(() => stats?.byNode || {}, [stats]);
  const selectedNode = nodes.find((n) => n.id === selectedId) || null;

  // ── Mutaciones ──
  const updateParams = useCallback(
    (id: string, patch: Record<string, unknown>) =>
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...(n.data as { kind: JourneyNodeKind; params?: JourneyParams }),
                  params: {
                    ...((n.data as { params?: JourneyParams }).params || {}),
                    ...patch,
                  },
                },
              }
            : n,
        ),
      ),
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node || (node.data as { kind?: string }).kind === "entry") return;
      // Recoser el riel si era lineal (1 entrada, 1 salida "out").
      const inEdge = edges.find((e) => e.target === id);
      const outEdge = edges.find((e) => e.source === id && (e.sourceHandle || "out") === "out");
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => {
        let next = es.filter((e) => e.source !== id && e.target !== id);
        if (inEdge && outEdge && (node.data as { kind?: string }).kind !== "branch") {
          next = [
            ...next,
            {
              id: edgeId(inEdge.source, onOf(inEdge), outEdge.target),
              source: inEdge.source,
              sourceHandle: inEdge.sourceHandle || "out",
              target: outEdge.target,
              ...edgeDefaults,
            },
          ];
        }
        return next;
      });
      setSelectedId(null);
    },
    [nodes, edges, setNodes, setEdges],
  );

  // ── Conexiones ──
  const onConnect = useCallback(
    (c: Connection) => {
      madeConnection.current = true;
      setEdges((eds) =>
        addEdge(
          { ...c, id: edgeId(c.source!, c.sourceHandle || "out", c.target!), ...edgeDefaults },
          eds,
        ),
      );
    },
    [setEdges],
  );

  const onConnectStart = useCallback<OnConnectStart>((_, params) => {
    madeConnection.current = false;
    connectFrom.current =
      params.nodeId != null && params.handleType === "source"
        ? { nodeId: params.nodeId, handleId: params.handleId }
        : null;
  }, []);

  const onConnectEnd = useCallback<OnConnectEnd>(
    (event) => {
      const from = connectFrom.current;
      connectFrom.current = null;
      if (!from || madeConnection.current) {
        madeConnection.current = false;
        return;
      }
      const target = event.target as HTMLElement | null;
      const point =
        "changedTouches" in event
          ? { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY }
          : { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
      const onNode =
        !!target &&
        (target.classList.contains("react-flow__handle") || !!target.closest(".react-flow__node"));
      let flowPos: { x: number; y: number };
      if (onNode) {
        const src = nodesRef.current.find((n) => n.id === from.nodeId);
        const base = src?.position ?? { x: 120, y: 120 };
        flowPos = { x: base.x, y: base.y + ROW_GAP };
      } else {
        const f = screenToFlowPosition(point);
        flowPos = { x: f.x - 117, y: f.y - 20 };
      }
      setPicker({
        at: point,
        mode: "connect",
        connect: { source: from.nodeId, sourceHandle: from.handleId ?? "out", flowPos },
      });
    },
    [screenToFlowPosition],
  );

  const openPickerFromOutlet = useCallback(
    (nodeId: string, handleId: string, screenX: number, screenY: number) => {
      const src = nodesRef.current.find((n) => n.id === nodeId);
      const base = src?.position ?? { x: 120, y: 120 };
      const h = src?.measured?.height ?? 60;
      setPicker({
        at: { x: screenX, y: screenY },
        mode: "connect",
        connect: {
          source: nodeId,
          sourceHandle: handleId,
          flowPos: { x: base.x, y: base.y + h + 44 },
        },
      });
    },
    [],
  );

  const openInsertOnEdge = useCallback((eid: string, screenX: number, screenY: number) => {
    setPicker({ at: { x: screenX, y: screenY }, mode: "insert", insertEdgeId: eid });
  }, []);

  const deleteEdge = useCallback(
    (eid: string) => setEdges((eds) => eds.filter((e) => e.id !== eid)),
    [setEdges],
  );

  const onReconnect = useCallback<OnReconnect>(
    (oldEdge, newConnection) => setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds)),
    [setEdges],
  );

  const addNode = useCallback(
    (
      kind: JourneyNodeKind,
      dropPos?: { x: number; y: number },
      autoConnect?: { source: string; sourceHandle: string },
    ) => {
      const sel = dropPos
        ? null
        : selectedId
          ? (nodes.find((n) => n.id === selectedId) ?? null)
          : (nodes[nodes.length - 1] ?? null);
      let pos: { x: number; y: number };
      if (dropPos) pos = dropPos;
      else if (sel) pos = { x: sel.position.x, y: sel.position.y + ROW_GAP };
      else {
        const rect = wrapperRef.current?.getBoundingClientRect();
        pos = rect
          ? screenToFlowPosition({ x: rect.x + rect.width / 2 - 117, y: rect.y + rect.height / 3 })
          : { x: 120, y: 120 };
      }
      const node = makeRFNode(kind, pos);
      setNodes((nds) => [...nds, node]);
      if (autoConnect) {
        setEdges((eds) =>
          addEdge(
            {
              source: autoConnect.source,
              sourceHandle: autoConnect.sourceHandle,
              target: node.id,
              targetHandle: null,
              id: edgeId(autoConnect.source, autoConnect.sourceHandle, node.id),
              ...edgeDefaults,
            },
            eds,
          ),
        );
      } else if (sel) {
        const kd = (sel.data as { kind: JourneyNodeKind }).kind;
        const firstOutlet = JOURNEY_KINDS[kd]?.outlets(
          (sel.data as { params?: JourneyParams }).params || {},
        )[0];
        const taken = edges.some(
          (e) => e.source === sel.id && (e.sourceHandle || "out") === firstOutlet?.id,
        );
        if (firstOutlet && !taken) {
          setEdges((eds) =>
            addEdge(
              {
                source: sel.id,
                sourceHandle: firstOutlet.id,
                target: node.id,
                targetHandle: null,
                id: edgeId(sel.id, firstOutlet.id, node.id),
                ...edgeDefaults,
              },
              eds,
            ),
          );
        }
      }
      setSelectedId(node.id);
    },
    [screenToFlowPosition, setNodes, setEdges, selectedId, nodes, edges],
  );

  const insertNodeOnEdge = useCallback(
    (eid: string, kind: JourneyNodeKind) => {
      const edge = edges.find((e) => e.id === eid);
      if (!edge) return;
      const sPos = nodes.find((n) => n.id === edge.source)?.position;
      const tPos = nodes.find((n) => n.id === edge.target)?.position;
      const mid =
        sPos && tPos
          ? { x: (sPos.x + tPos.x) / 2, y: (sPos.y + tPos.y) / 2 }
          : (sPos ?? tPos ?? { x: 120, y: 120 });
      const node = makeRFNode(kind, mid);
      const firstOutlet = JOURNEY_KINDS[kind].outlets(node.data.params as JourneyParams)[0];
      setNodes((nds) => [...nds, node]);
      setEdges((eds) => {
        const rest = eds.filter((e) => e.id !== eid);
        const inn: Edge = {
          source: edge.source,
          sourceHandle: edge.sourceHandle || "out",
          target: node.id,
          id: edgeId(edge.source, onOf(edge), node.id),
          ...edgeDefaults,
        };
        const out: Edge[] = firstOutlet
          ? [
              {
                source: node.id,
                sourceHandle: firstOutlet.id,
                target: edge.target,
                id: edgeId(node.id, firstOutlet.id, edge.target),
                ...edgeDefaults,
              },
            ]
          : [];
        return [...rest, inn, ...out];
      });
      setSelectedId(node.id);
    },
    [edges, nodes, setNodes, setEdges],
  );

  const onPickerPick = useCallback(
    (kind: JourneyNodeKind) => {
      if (picker?.mode === "connect" && picker.connect) {
        addNode(kind, picker.connect.flowPos, {
          source: picker.connect.source,
          sourceHandle: picker.connect.sourceHandle,
        });
      } else if (picker?.mode === "insert" && picker.insertEdgeId) {
        insertNodeOnEdge(picker.insertEdgeId, kind);
      }
      setPicker(null);
    },
    [picker, addNode, insertNodeOnEdge],
  );

  const arrange = useCallback(() => {
    setNodes((nds) => layoutTB(nds, edges));
    window.setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 60);
  }, [setNodes, edges, fitView]);

  // ── Drag desde la palette ──
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDropping(false);
      const kind = e.dataTransfer.getData("application/aria-journey-node") as JourneyNodeKind;
      if (!kind || !JOURNEY_KINDS[kind]) return;
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const pos = { x: flowPos.x - 117, y: flowPos.y - 20 };
      const conn = findDropConnection(pos, nodesRef.current, edges) ?? undefined;
      addNode(kind, pos, conn);
    },
    [screenToFlowPosition, edges, addNode],
  );

  // ── Import / export ──
  const currentJourney = useMemo<Journey>(
    () => ({
      journeyId: initial.journeyId,
      name,
      status,
      entry,
      reenroll,
      nodes: nodes.map((n) => rfToJourneyNode(n)),
      edges: edges.map((e) => ({ from: e.source, to: e.target, on: onOf(e) })),
      goal: initial.goal,
    }),
    [initial.journeyId, initial.goal, name, status, entry, reenroll, nodes, edges],
  );

  const exportFlow = useCallback(() => {
    const blob = new Blob([JSON.stringify(currentJourney, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name || "journey").replace(/[^\w-]+/g, "_")}.journey.json`;
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1500);
    toast.success("Journey exportado a JSON");
  }, [currentJourney, name]);

  const importFlow = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const j = JSON.parse(String(reader.result)) as Journey;
          if (!Array.isArray(j.nodes) || !Array.isArray(j.edges))
            throw new Error("el archivo no es un journey (faltan nodes/edges)");
          if (typeof j.name === "string" && j.name.trim()) setName(j.name.trim());
          setNodes(initialRFNodes(j));
          setEdges(toRFEdges(j));
          setSelectedId(null);
          window.setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 80);
          toast.success(`Journey importado — ${j.nodes.length} pasos`);
        } catch (err) {
          toast.error(
            "No se pudo importar: " + (err instanceof Error ? err.message : "JSON inválido"),
          );
        }
      };
      reader.readAsText(file);
    },
    [setNodes, setEdges, fitView],
  );

  const handleSave = useCallback(() => {
    baseline.current = serializeJourney(nodes, edges, name, status);
    onSave?.(currentJourney);
  }, [nodes, edges, name, status, currentJourney, onSave]);

  // ── Contexto para los nodos ──
  const builderActions = useMemo(
    () => ({
      updateParams,
      selectNode: (id: string) => setSelectedId(id),
      numberOf: (id: string) => numberMap.get(id),
      issuesOf: (id: string) => issuesByNode.get(id) ?? [],
      countOf: (id: string) => byNode[id] ?? 0,
      addFromOutlet: openPickerFromOutlet,
    }),
    [updateParams, numberMap, issuesByNode, byNode, openPickerFromOutlet],
  );

  // Inyecta onInsert/onDelete + branchLabel + color por rama en cada edge (render).
  const rfEdges = edges.map((e) => {
    const color = branchColor(e.sourceHandle);
    const baseStyle = (e.style as React.CSSProperties | undefined) ?? edgeDefaults.style;
    return {
      ...e,
      style: { ...baseStyle, stroke: color },
      markerEnd: { ...edgeDefaults.markerEnd, color },
      data: {
        ...(e.data as Record<string, unknown> | undefined),
        branchLabel: branchLabelFor(e, nodes),
        onInsert: openInsertOnEdge,
        onDelete: deleteEdge,
      },
    };
  });

  const totalActive = stats?.byStatus?.active || 0;
  const totalDone = stats?.byStatus?.done || 0;

  return (
    <JourneyBuilderCtx.Provider value={builderActions}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* Toolbar */}
        <div className="fb-bar">
          {onBack && (
            <button
              onClick={() => {
                if (dirty && !window.confirm("Tienes cambios sin guardar. ¿Salir y descartarlos?"))
                  return;
                onBack();
              }}
              title="Volver a mis journeys"
              className="fb-bar__back"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <span className="fb-bar__icon">
            <Users size={15} />
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
          {dirty && (
            <span className="fb-dirty" title="Tienes cambios sin guardar">
              <span className="fb-dirty__dot" /> sin guardar
            </span>
          )}

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {stats && stats.total > 0 && (
              <span className="fb-chip" title={`${totalActive} activos · ${totalDone} completados`}>
                <Users size={12} /> {stats.total} inscrito{stats.total === 1 ? "" : "s"}
              </span>
            )}
            <button
              onClick={() => setShowIssues((s) => !s)}
              title="Validación del recorrido"
              className={`fb-chip ${issues.length ? "fb-chip--warn" : "fb-chip--ok"}`}
            >
              {issues.length ? <AlertTriangle size={13} /> : <Check size={13} />}
              {issues.length
                ? `${issues.length} aviso${issues.length > 1 ? "s" : ""}`
                : "Sin avisos"}
            </button>
            <button onClick={exportFlow} title="Exportar el journey a JSON" className="btn btn--sm">
              <Download size={13} /> Exportar
            </button>
            <button
              onClick={() => importRef.current?.click()}
              title="Importar un journey desde JSON"
              className="btn btn--sm"
            >
              <Upload size={13} /> Importar
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importFlow(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={arrange}
              title="Ordenar automáticamente (izquierda → derecha)"
              className="btn btn--sm"
            >
              <Network size={13} /> Ordenar
            </button>
            <button onClick={handleSave} disabled={saving} className="btn btn--primary btn--sm">
              <Save size={13} /> {saving ? "Guardando…" : dirty ? "Guardar •" : "Guardar"}
            </button>
          </div>
        </div>

        {showIssues && issues.length > 0 && (
          <div className="fb-issues">
            <div className="fb-issues__head">
              <AlertTriangle size={13} strokeWidth={2.4} />
              {issues.length} {issues.length === 1 ? "cosa por revisar" : "cosas por revisar"}
              <button
                type="button"
                className="fb-issues__close"
                onClick={() => setShowIssues(false)}
                title="Ocultar avisos"
                aria-label="Ocultar avisos"
              >
                ×
              </button>
            </div>
            <div className="fb-issues__list">
              {issues.map((i, idx) => {
                const node = i.nodeId ? nodes.find((n) => n.id === i.nodeId) : null;
                const def = node
                  ? JOURNEY_KINDS[(node.data as { kind: JourneyNodeKind }).kind]
                  : null;
                const Icn = def ? journeyIcon(def.icon) : null;
                return (
                  <button
                    key={idx}
                    type="button"
                    className="fb-issue"
                    onClick={() => {
                      if (!i.nodeId) return;
                      setSelectedId(i.nodeId);
                      fitView({
                        nodes: [{ id: i.nodeId }],
                        duration: 400,
                        maxZoom: 1.2,
                        padding: 0.6,
                      });
                    }}
                    disabled={!i.nodeId}
                    title={i.nodeId ? "Ir al paso" : undefined}
                  >
                    <span className="fb-issue__ico">
                      <AlertTriangle size={13} strokeWidth={2.4} />
                    </span>
                    <span className="fb-issue__body">
                      <span className="fb-issue__msg">{i.message}</span>
                      {def && (
                        <span className="fb-issue__step" style={{ ["--_c" as string]: def.accent }}>
                          {Icn && <Icn size={11} strokeWidth={2.2} />}
                          {def.label}
                        </span>
                      )}
                    </span>
                    {i.nodeId && <span className="fb-issue__go">Ver paso →</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Body: palette | canvas | inspector */}
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <JourneyPalette onAdd={addNode} />

          <div ref={wrapperRef} style={{ flex: 1, position: "relative", minWidth: 0 }}>
            <div
              style={{ position: "absolute", inset: 0 }}
              className={isDropping ? "fb-canvas--drop" : undefined}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnter={() => setIsDropping(true)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as HTMLElement)) setIsDropping(false);
              }}
            >
              <ReactFlow
                nodes={nodes}
                edges={rfEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                onReconnect={onReconnect}
                connectOnClick={false}
                onNodeClick={(_, n) => {
                  setSelectedId(n.id);
                  setRightTab("form");
                }}
                onPaneClick={() => setSelectedId(null)}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultEdgeOptions={edgeDefaults}
                fitView
                snapToGrid
                snapGrid={[20, 20]}
                proOptions={{ hideAttribution: true }}
                style={{ background: "var(--bg-1)" }}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={22}
                  size={1.4}
                  color="var(--border-2)"
                />
                <Controls showInteractive={false} />
                <MiniMap
                  pannable
                  zoomable
                  nodeColor={(n) =>
                    JOURNEY_KINDS[(n.data as { kind: JourneyNodeKind }).kind]?.accent || "#888"
                  }
                  nodeStrokeWidth={2}
                  maskColor="rgba(10,16,28,0.6)"
                  style={{
                    background: "var(--bg-2)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                  }}
                />
              </ReactFlow>
            </div>
            {nodes.filter((n) => (n.data as { kind?: string }).kind !== "entry").length === 0 && (
              <div className="fb-coach">
                <div className="fb-coach__card">
                  <span className="fb-coach__arrow" aria-hidden>
                    ←
                  </span>
                  <div>
                    <div className="fb-coach__h">Arma tu recorrido</div>
                    <div className="fb-coach__p">
                      Arrastra un paso desde la izquierda (o haz clic en uno). Para seguir el flujo,
                      <strong> haz clic en el conector de abajo</strong> del estado y elige el
                      siguiente paso — o arrástralo hasta otro para enlazarlos.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="sfn-right">
            <div className="sfn-right__tabs">
              <button
                type="button"
                className={`sfn-right__tab ${rightTab === "form" ? "sfn-right__tab--on" : ""}`}
                onClick={() => setRightTab("form")}
              >
                Formulario
              </button>
              <button
                type="button"
                className={`sfn-right__tab ${rightTab === "def" ? "sfn-right__tab--on" : ""}`}
                onClick={() => setRightTab("def")}
              >
                Definición
              </button>
            </div>
            <div className="sfn-right__body">
              {rightTab === "def" ? (
                <pre className="sfn-def">{JSON.stringify(currentJourney, null, 2)}</pre>
              ) : selectedNode ? (
                <JourneyInspector
                  key={selectedNode.id}
                  node={rfToJourneyNode(selectedNode)}
                  entry={entry}
                  reenroll={reenroll}
                  stats={stats}
                  onEntry={setEntry}
                  onReenroll={setReenroll}
                  onParams={updateParams}
                  onDelete={deleteNode}
                  onClose={() => setSelectedId(null)}
                />
              ) : (
                <div className="sfn-hint">
                  Toca un paso del recorrido para editarlo. Empieza por <strong>Inicio</strong> —
                  define cómo entran los leads.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {picker && (
        <JourneyNodePicker
          screenX={picker.at.x}
          screenY={picker.at.y}
          onPick={onPickerPick}
          onClose={() => setPicker(null)}
        />
      )}
    </JourneyBuilderCtx.Provider>
  );
}

// ── Helpers de conversión RF → modelo ──
function onOf(e: Edge): string | undefined {
  const h = e.sourceHandle;
  return h && h !== "out" ? h : undefined;
}
function rfToJourneyNode(n: Node): JourneyNode {
  const d = n.data as { kind: JourneyNodeKind; params?: JourneyParams };
  return { id: n.id, kind: d.kind, params: d.params ?? {}, position: n.position };
}

/* ─────────────────────────── Palette ─────────────────────────── */
function JourneyPalette({ onAdd }: { onAdd: (kind: JourneyNodeKind) => void }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  return (
    <div className="fb-pal">
      <div className="fb-pal__title">Pasos</div>
      <div className="fb-pal__search">
        <Search size={13} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar paso…" />
      </div>
      {JOURNEY_PALETTE_GROUPS.map((group) => {
        const items = Object.values(JOURNEY_KINDS).filter(
          (k) =>
            !k.notInPalette &&
            k.group === group &&
            (!query ||
              k.label.toLowerCase().includes(query) ||
              k.blurb.toLowerCase().includes(query)),
        );
        if (items.length === 0) return null;
        return (
          <div key={group} className="fb-pal__group">
            <div className="fb-pal__group-h">{group}</div>
            {items.map((def) => {
              const Icn = journeyIcon(def.icon);
              return (
                <button
                  key={def.kind}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/aria-journey-node", def.kind);
                    e.dataTransfer.effectAllowed = "move";
                    const ghost = document.createElement("div");
                    ghost.className = "fb-drag-ghost";
                    ghost.style.setProperty("--_c", def.accent);
                    const iconEl = e.currentTarget.querySelector(".fb-pal__icon");
                    if (iconEl) ghost.appendChild(iconEl.cloneNode(true));
                    const lbl = document.createElement("span");
                    lbl.className = "fb-drag-ghost__lbl";
                    lbl.textContent = def.label;
                    ghost.appendChild(lbl);
                    document.body.appendChild(ghost);
                    void ghost.offsetWidth;
                    e.dataTransfer.setDragImage(ghost, 26, 22);
                    setTimeout(() => ghost.remove(), 0);
                  }}
                  onClick={() => onAdd(def.kind)}
                  title={`${def.blurb} — clic para agregar o arrastra al lienzo`}
                  className="fb-pal__item"
                >
                  <span
                    className="fb-pal__icon"
                    style={{ background: `${def.accent}1a`, color: def.accent }}
                  >
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

// Evita el warning de fast-refresh export mixto sin componente.
export { JourneyStepNode };
