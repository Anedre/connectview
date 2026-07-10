import { useEffect, useMemo, useState } from "react";
import {
  LogIn,
  Send,
  Clock,
  GitBranch,
  Shuffle,
  Zap,
  Plus,
  Save,
  Trash2,
  Check,
  AlertTriangle,
  X,
  Users,
  ArrowLeft,
  Flag,
} from "lucide-react";
import type {
  Journey,
  JourneyNode,
  JourneyNodeKind,
  JourneyEdge,
  JourneyStats,
} from "@/hooks/useJourneys";
import { useSegments, type FilterRule, type FilterOp } from "@/hooks/useSegments";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented";

/**
 * JourneyBuilder — el editor del motor de Journeys, rediseñado a su identidad
 * propia: una "línea de vida" VERTICAL (el tiempo baja), distinta a propósito del
 * canvas horizontal de Bots y de la receta de Automatizaciones. Las esperas no son
 * un nodo más: son TRAMOS rotulados del riel ("⏱ 3 días"). Las ramas abren dos
 * carriles paralelos (Sí / No). Cada estación muestra su embudo de gente. Color de
 * sección: verde. El modelo (nodes + edges) es el nativo del journey — no hay
 * conversión a react-flow. El avance lo corre el journey-runner (tick).
 */

const rid = () => Math.random().toString(36).slice(2, 9);

// ── Catálogo de tipos de estación ───────────────────────────────────────────
type Outlet = { id: "out" | "yes" | "no" | "a" | "b"; label?: string };
interface KindDef {
  label: string;
  icon: typeof Send;
  accent: string;
  outlets: Outlet[]; // 0 = terminal
}
const JOURNEY_KINDS: Record<JourneyNodeKind, KindDef> = {
  entry: { label: "Entrada", icon: LogIn, accent: "var(--green)", outlets: [{ id: "out" }] },
  send: { label: "Enviar", icon: Send, accent: "var(--cyan)", outlets: [{ id: "out" }] },
  wait: { label: "Esperar", icon: Clock, accent: "var(--gold)", outlets: [{ id: "out" }] },
  branch: {
    label: "Ramificar",
    icon: GitBranch,
    accent: "var(--iris)",
    outlets: [
      { id: "yes", label: "Sí" },
      { id: "no", label: "No" },
    ],
  },
  split: {
    label: "Test A/B",
    icon: Shuffle,
    accent: "var(--accent)",
    outlets: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  },
  action: { label: "Acción", icon: Zap, accent: "var(--coral)", outlets: [{ id: "out" }] },
  exit: { label: "Fin", icon: Flag, accent: "var(--text-3)", outlets: [] },
};
/** Pasos que se pueden insertar en medio del riel (exit se agrega solo al final). */
const INSERTABLE: JourneyNodeKind[] = ["send", "wait", "branch", "split", "action"];

type NodeParams = Record<string, unknown>;

/** Resumen legible de una estación según sus params. */
function summaryOf(kind: JourneyNodeKind, p: NodeParams): string {
  switch (kind) {
    case "entry":
      return "Los leads entran aquí";
    case "send": {
      const ch = p.channel === "email" ? "Email" : "WhatsApp";
      const t = String(p.templateName || p.subject || "");
      return t ? `${ch} · ${t}` : `${ch} · (sin plantilla)`;
    }
    case "wait": {
      if (Array.isArray(p.untilRule) && p.untilRule.length) return "hasta que se cumpla…";
      const d = Number(p.days ?? 0);
      return d > 0 ? `${d} día${d === 1 ? "" : "s"}` : "(sin definir)";
    }
    case "branch": {
      const n = Array.isArray(p.rules) ? p.rules.length : 0;
      const m = p.match === "any" ? "cualquiera" : "todas";
      return n ? `${n} ${n === 1 ? "condición" : "condiciones"} · ${m}` : "Sin condiciones";
    }
    case "action": {
      if (p.type === "moveStage") return `Mover a etapa "${p.stageId || "?"}"`;
      if (p.type === "webhook") return "Llamar webhook";
      if (p.type === "enqueueDialer") return "Llamar (encolar al dialer)";
      return "Acción (sin definir)";
    }
    case "split": {
      const pct = Math.max(0, Math.min(100, Number(p.percent ?? 50)));
      return `${pct}% A · ${100 - pct}% B`;
    }
    case "exit":
      return "El lead sale del recorrido";
  }
}

// ── Layout: recorre el grafo y arma la "línea de vida" (árbol vertical) ───────
interface ForkLeg {
  on: "yes" | "no" | "a" | "b";
  label: string;
  tone: "yes" | "no" | "a" | "b";
  items: TreeItem[];
}
type TreeItem =
  | { type: "station"; node: JourneyNode }
  | { type: "wait"; node: JourneyNode }
  | { type: "fork"; node: JourneyNode; legs: ForkLeg[] }
  | { type: "ref"; toId: string; label: string };

interface BuiltTree {
  items: TreeItem[];
  orphans: JourneyNode[];
}

/** Primer edge que sale de `id` por el conector `handle`. */
function succ(
  edges: JourneyEdge[],
  id: string,
  handle: "out" | "yes" | "no" | "a" | "b",
): string | null {
  const e = edges.find((x) => x.from === id && (x.on || "out") === handle);
  return e ? e.to : null;
}

function buildTree(nodes: JourneyNode[], edges: JourneyEdge[]): BuiltTree {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const entry = nodes.find((n) => n.kind === "entry");
  const visited = new Set<string>();

  const walk = (startId: string | null): TreeItem[] => {
    const items: TreeItem[] = [];
    let cur = startId;
    while (cur) {
      const node = byId.get(cur);
      if (!node) break;
      if (visited.has(cur)) {
        items.push({ type: "ref", toId: cur, label: JOURNEY_KINDS[node.kind].label });
        break;
      }
      visited.add(cur);
      if (node.kind === "wait") {
        items.push({ type: "wait", node });
        cur = succ(edges, cur, "out");
        continue;
      }
      if (node.kind === "branch" || node.kind === "split") {
        const bp = (node.params as NodeParams) || {};
        const pct = Math.max(0, Math.min(100, Number(bp.percent ?? 50)));
        const legs: ForkLeg[] =
          node.kind === "branch"
            ? [
                {
                  on: "yes",
                  label: "SÍ · cumple",
                  tone: "yes",
                  items: walk(succ(edges, cur, "yes")),
                },
                {
                  on: "no",
                  label: "NO · no cumple",
                  tone: "no",
                  items: walk(succ(edges, cur, "no")),
                },
              ]
            : [
                { on: "a", label: `A · ${pct}%`, tone: "a", items: walk(succ(edges, cur, "a")) },
                {
                  on: "b",
                  label: `B · ${100 - pct}%`,
                  tone: "b",
                  items: walk(succ(edges, cur, "b")),
                },
              ];
        items.push({ type: "fork", node, legs });
        break;
      }
      items.push({ type: "station", node });
      if (node.kind === "exit") break;
      cur = succ(edges, cur, "out");
    }
    return items;
  };

  const items = entry ? walk(entry.id) : [];
  const orphans = nodes.filter((n) => !visited.has(n.id));
  return { items, orphans };
}

/** Avisos de validación (no bloquean, guían). */
function validateJourney(nodes: JourneyNode[], edges: JourneyEdge[]) {
  const out: Array<{ message: string; nodeId?: string }> = [];
  const entries = nodes.filter((n) => n.kind === "entry");
  if (entries.length === 0) out.push({ message: "Falta el nodo de Entrada." });
  if (entries.length > 1) out.push({ message: "Hay más de una Entrada — deja solo una." });
  const entry = entries[0];
  if (entry && !edges.some((e) => e.from === entry.id))
    out.push({ message: "La Entrada no lleva a ningún paso.", nodeId: entry.id });
  if (!nodes.some((n) => n.kind === "exit"))
    out.push({ message: "Agrega un Fin para cerrar el recorrido." });
  for (const n of nodes) {
    const p = (n.params as NodeParams) || {};
    if (n.kind === "branch") {
      const outs = edges.filter((e) => e.from === n.id).map((e) => e.on || "out");
      if (!outs.includes("yes") || !outs.includes("no"))
        out.push({ message: `La rama necesita salida Sí y No.`, nodeId: n.id });
    }
    if (n.kind === "split") {
      const outs = edges.filter((e) => e.from === n.id).map((e) => e.on || "out");
      if (!outs.includes("a") || !outs.includes("b"))
        out.push({ message: `El test A/B necesita salida A y B.`, nodeId: n.id });
    }
    if (n.kind === "send" && !p.templateName && !p.subject)
      out.push({ message: "Un paso Enviar no tiene plantilla/asunto.", nodeId: n.id });
    if (n.kind === "wait" && !Number(p.days) && !(Array.isArray(p.untilRule) && p.untilRule.length))
      out.push({ message: "Una Espera no tiene tiempo definido.", nodeId: n.id });
    if (
      n.kind !== "entry" &&
      !edges.some((e) => e.to === n.id) &&
      nodes.some((x) => x.kind === "entry")
    )
      out.push({
        message: `Paso "${JOURNEY_KINDS[n.kind].label}" suelto (sin entrada).`,
        nodeId: n.id,
      });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
export function JourneyBuilder({
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
  const [nodes, setNodes] = useState<JourneyNode[]>(initial.nodes);
  const [edges, setEdges] = useState<JourneyEdge[]>(initial.edges);
  const [name, setName] = useState(initial.name);
  const [status, setStatus] = useState<Journey["status"]>(initial.status);
  const [entry, setEntry] = useState(initial.entry || { manual: true });
  const [reenroll, setReenroll] = useState(!!initial.reenroll);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [stats, setStats] = useState<JourneyStats | null>(null);

  // Recargar al cambiar de journey.
  useEffect(() => {
    setNodes(initial.nodes);
    setEdges(initial.edges);
    setName(initial.name);
    setStatus(initial.status);
    setEntry(initial.entry || { manual: true });
    setReenroll(!!initial.reenroll);
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.journeyId]);

  // Observabilidad: embudo por nodo + timeline del journey guardado.
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

  const tree = useMemo(() => buildTree(nodes, edges), [nodes, edges]);
  const issues = useMemo(() => validateJourney(nodes, edges), [nodes, edges]);
  const byNode = stats?.byNode || {};
  const selectedNode = nodes.find((n) => n.id === selectedId) || null;

  // ── Mutaciones sobre el modelo ──
  const updateParams = (id: string, patch: NodeParams) =>
    setNodes((ns) =>
      ns.map((n) =>
        n.id === id ? { ...n, params: { ...((n.params as NodeParams) || {}), ...patch } } : n,
      ),
    );

  /** Inserta una estación nueva en la arista `from --handle--> to` (to puede ser null = punta). */
  const insertStep = (
    fromId: string,
    handle: "out" | "yes" | "no" | "a" | "b",
    toId: string | null,
    kind: JourneyNodeKind,
  ) => {
    const id = rid();
    const newNode: JourneyNode = { id, kind, params: kind === "split" ? { percent: 50 } : {} };
    setNodes((ns) => {
      const extra: JourneyNode[] = [newNode];
      // Un branch/split nace con su 2ª salida hacia un Fin nuevo; la 1ª continúa el riel.
      if (kind === "branch" || kind === "split")
        extra.push({ id: `${id}x`, kind: "exit", params: {} });
      return [...ns, ...extra];
    });
    setEdges((es) => {
      let next = es.filter(
        (e) => !(e.from === fromId && (e.on || "out") === handle && e.to === toId),
      );
      if (kind === "branch" || kind === "split") {
        const contOn = kind === "branch" ? "yes" : "a";
        const exitOn = kind === "branch" ? "no" : "b";
        next = [
          ...next,
          { from: fromId, to: id, on: handle === "out" ? undefined : handle },
          ...(toId ? [{ from: id, to: toId, on: contOn }] : []),
          { from: id, to: `${id}x`, on: exitOn },
        ];
      } else {
        next = [
          ...next,
          { from: fromId, to: id, on: handle === "out" ? undefined : handle },
          ...(toId ? [{ from: id, to: toId }] : []),
        ];
      }
      return next;
    });
    setSelectedId(id);
  };

  /** Quita una estación y recose el riel (predecesor → sucesor) cuando es lineal. */
  const deleteNode = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node || node.kind === "entry") return;
    const inEdge = edges.find((e) => e.to === id);
    const outEdge = edges.find((e) => e.from === id && (e.on || "out") === "out");
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => {
      let next = es.filter((e) => e.from !== id && e.to !== id);
      // recoser sólo si el nodo era lineal (1 entrada, ≤1 salida)
      if (inEdge && outEdge && node.kind !== "branch")
        next = [...next, { from: inEdge.from, to: outEdge.to, on: inEdge.on }];
      return next;
    });
    setSelectedId(null);
  };

  const currentJourney: Journey = {
    journeyId: initial.journeyId,
    name,
    status,
    entry,
    reenroll,
    nodes,
    edges,
    goal: initial.goal,
  };

  const totalActive = stats?.byStatus?.active || 0;
  const totalDone = stats?.byStatus?.done || 0;

  return (
    <div className="jb">
      {/* Toolbar */}
      <div className="jb-bar">
        {onBack && (
          <button onClick={onBack} title="Volver a mis journeys" className="jb-bar__back">
            <ArrowLeft size={16} />
          </button>
        )}
        <span className="jb-bar__icon">
          <Users size={15} />
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del journey"
          className="jb-bar__name"
        />
        <div className={`jb-status jb-status--${status}`}>
          <span className="jb-status__dot" />
          <select value={status} onChange={(e) => setStatus(e.target.value as Journey["status"])}>
            <option value="draft">Borrador</option>
            <option value="active">Activo</option>
            <option value="paused">Pausado</option>
          </select>
        </div>
        <div className="jb-bar__spacer" />
        {stats && stats.total > 0 && (
          <span className="jb-chip" title={`${totalActive} activos · ${totalDone} completados`}>
            <Users size={12} /> {stats.total} inscrito{stats.total === 1 ? "" : "s"}
          </span>
        )}
        <button
          onClick={() => setShowIssues((s) => !s)}
          title="Validación del recorrido"
          className={`jb-chip ${issues.length ? "jb-chip--warn" : "jb-chip--ok"}`}
        >
          {issues.length ? <AlertTriangle size={13} /> : <Check size={13} />}
          {issues.length ? `${issues.length} aviso${issues.length > 1 ? "s" : ""}` : "Sin avisos"}
        </button>
        <button
          onClick={() => onSave?.(currentJourney)}
          disabled={saving}
          className="jb-btn jb-btn--primary"
        >
          <Save size={13} /> {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>

      {showIssues && issues.length > 0 && (
        <div className="jb-issues">
          {issues.map((i, idx) => (
            <button
              key={idx}
              className="jb-issue"
              onClick={() => i.nodeId && setSelectedId(i.nodeId)}
              disabled={!i.nodeId}
            >
              <AlertTriangle size={12} />
              <span>{i.message}</span>
              {i.nodeId && <span className="jb-issue__go">Ver →</span>}
            </button>
          ))}
        </div>
      )}

      {/* Body: lienzo vertical | inspector */}
      <div className="jb-body">
        <div className="jb-canvas">
          <div className="jb-lifeline">
            <ColumnView
              items={tree.items}
              byNode={byNode}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onInsert={insertStep}
            />
            {tree.orphans.length > 0 && (
              <div className="jb-orphans">
                <div className="jb-orphans__title">
                  <AlertTriangle size={12} /> Pasos sueltos (no conectados al recorrido)
                </div>
                <div className="jb-orphans__row">
                  {tree.orphans.map((n) => (
                    <StationCard
                      key={n.id}
                      node={n}
                      count={byNode[n.id] || 0}
                      selected={selectedId === n.id}
                      onSelect={() => setSelectedId(n.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <JourneyInspector
          node={selectedNode}
          entry={entry}
          reenroll={reenroll}
          stats={stats}
          onEntry={setEntry}
          onReenroll={setReenroll}
          onParams={updateParams}
          onDelete={deleteNode}
        />
      </div>
    </div>
  );
}

// ── Render recursivo de una columna del riel ────────────────────────────────
function ColumnView({
  items,
  byNode,
  selectedId,
  onSelect,
  onInsert,
}: {
  items: TreeItem[];
  byNode: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInsert: (
    fromId: string,
    handle: "out" | "yes" | "no" | "a" | "b",
    toId: string | null,
    kind: JourneyNodeKind,
  ) => void;
}) {
  // ¿La columna está "abierta" al final? (último item con salida libre → inserter de punta)
  const last = items[items.length - 1];
  let tailFrom: { id: string; handle: "out" | "yes" | "no" } | null = null;
  if (last) {
    if (last.type === "station" && last.node.kind !== "exit")
      tailFrom = { id: last.node.id, handle: "out" };
    else if (last.type === "wait") tailFrom = { id: last.node.id, handle: "out" };
    // branch: sus legs manejan su propia cola; ref/exit: cerrado
  }

  return (
    <div className="jb-col">
      {items.length === 0 && (
        <Inserter onPick={(k) => onInsert("__none__", "out", null, k)} disabledRoot />
      )}
      {items.map((it, i) => {
        const prev = items[i - 1];
        // el inserter ANTES de este item divide la arista prev--handle-->this
        let node: JourneyNode | null = null;
        if (it.type === "station" || it.type === "wait" || it.type === "fork") node = it.node;
        const showInserter = i > 0 && prev && node;
        let fromId = "";
        let handle: "out" | "yes" | "no" = "out";
        if (showInserter && node) {
          if (prev.type === "station" || prev.type === "wait") {
            fromId = prev.node.id;
            handle = "out";
          } else if (prev.type === "fork") {
            fromId = prev.node.id; // no debería pasar (el fork corta la columna), pero por seguridad
          }
        }
        return (
          <div key={node ? node.id : `ref${i}`} className="jb-seg">
            {showInserter && node && fromId && (
              <Inserter onPick={(k) => onInsert(fromId, handle, node!.id, k)} />
            )}
            {it.type === "station" && (
              <>
                {i === 0 && it.node.kind !== "entry" && <div className="jb-link" />}
                <StationCard
                  node={it.node}
                  count={byNode[it.node.id] || 0}
                  selected={selectedId === it.node.id}
                  onSelect={() => onSelect(it.node.id)}
                />
              </>
            )}
            {it.type === "wait" && (
              <WaitTram
                node={it.node}
                count={byNode[it.node.id] || 0}
                selected={selectedId === it.node.id}
                onSelect={() => onSelect(it.node.id)}
              />
            )}
            {it.type === "fork" && (
              <>
                <StationCard
                  node={it.node}
                  count={byNode[it.node.id] || 0}
                  selected={selectedId === it.node.id}
                  onSelect={() => onSelect(it.node.id)}
                />
                <div className="jb-split">
                  {it.legs.map((leg) => (
                    <div key={leg.on} className={`jb-leg jb-leg--${leg.tone}`}>
                      <div className={`jb-leg__tag jb-leg__tag--${leg.tone}`}>{leg.label}</div>
                      <ColumnView
                        items={leg.items}
                        byNode={byNode}
                        selectedId={selectedId}
                        onSelect={onSelect}
                        onInsert={onInsert}
                      />
                      {leg.items.length === 0 && (
                        <Inserter onPick={(k) => onInsert(it.node.id, leg.on, null, k)} />
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            {it.type === "ref" && (
              <div className="jb-ref" title="Este paso vuelve a una estación anterior">
                ↑ vuelve a {it.label}
              </div>
            )}
          </div>
        );
      })}
      {tailFrom && (
        <Inserter onPick={(k) => onInsert(tailFrom!.id, tailFrom!.handle, null, k)} allowExit />
      )}
    </div>
  );
}

// ── Estación (tarjeta) ──────────────────────────────────────────────────────
function StationCard({
  node,
  count,
  selected,
  onSelect,
}: {
  node: JourneyNode;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const def = JOURNEY_KINDS[node.kind];
  const Icon = def.icon;
  const p = (node.params as NodeParams) || {};
  return (
    <button
      className={`jb-station ${selected ? "jb-station--sel" : ""}`}
      style={{ "--_c": def.accent } as React.CSSProperties}
      onClick={onSelect}
    >
      <span className="jb-station__ico">
        <Icon size={15} strokeWidth={2.2} />
      </span>
      <span className="jb-station__body">
        <span className="jb-station__label">{def.label}</span>
        <span className="jb-station__sum">{summaryOf(node.kind, p)}</span>
      </span>
      {count > 0 && (
        <span className="jb-station__count" title={`${count} lead${count === 1 ? "" : "s"} aquí`}>
          <Users size={11} /> {count}
        </span>
      )}
    </button>
  );
}

// ── Tramo de espera (el tiempo hecho visible) ───────────────────────────────
function WaitTram({
  node,
  count,
  selected,
  onSelect,
}: {
  node: JourneyNode;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const p = (node.params as NodeParams) || {};
  const until = Array.isArray(p.untilRule) && p.untilRule.length;
  const d = Number(p.days ?? 0);
  const label = until
    ? "hasta que se cumpla"
    : d > 0
      ? `${d} día${d === 1 ? "" : "s"}`
      : "sin definir";
  return (
    <button
      className={`jb-tram ${selected ? "jb-tram--sel" : ""}`}
      onClick={onSelect}
      title="Editar la espera"
    >
      <span className="jb-tram__line" />
      <span className="jb-tram__pill">
        <Clock size={12} /> {label}
        {count > 0 && <span className="jb-tram__count">· {count} esperando</span>}
      </span>
      <span className="jb-tram__line" />
    </button>
  );
}

// ── Inserter "+" (menú de pasos) ────────────────────────────────────────────
function Inserter({
  onPick,
  allowExit,
  disabledRoot,
}: {
  onPick: (k: JourneyNodeKind) => void;
  allowExit?: boolean;
  disabledRoot?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const kinds: JourneyNodeKind[] = allowExit ? [...INSERTABLE, "exit"] : INSERTABLE;
  if (disabledRoot) return null;
  return (
    <div className="jb-ins">
      {!open ? (
        <button className="jb-ins__btn" onClick={() => setOpen(true)} title="Insertar paso aquí">
          <Plus size={13} />
        </button>
      ) : (
        <>
          <div className="jb-ins__backdrop" onClick={() => setOpen(false)} />
          <div className="jb-ins__menu">
            {kinds.map((k) => {
              const def = JOURNEY_KINDS[k];
              const Icon = def.icon;
              return (
                <button
                  key={k}
                  className="jb-ins__opt"
                  style={{ "--_c": def.accent } as React.CSSProperties}
                  onClick={() => {
                    onPick(k);
                    setOpen(false);
                  }}
                >
                  <span className="jb-ins__optico">
                    <Icon size={13} strokeWidth={2.2} />
                  </span>
                  {def.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Inspector derecho (edición de params) — re-pieled verde, lógica intacta
// ════════════════════════════════════════════════════════════════════════════
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
              style={jbInput(84)}
            />
            <select
              value={r.op}
              onChange={(e) => set(i, { op: e.target.value as FilterOp })}
              style={jbInput(92)}
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
                style={jbInput(64)}
              />
            )}
            <button
              onClick={() => onChange(rules.filter((_, idx) => idx !== i))}
              title="Quitar"
              style={{ ...jbInput(26), color: "var(--red)", cursor: "pointer", padding: 0 }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        onClick={() => onChange([...rules, { field: "score", op: "gte", value: "70" }])}
        className="jb-btn"
        style={{ alignSelf: "flex-start" }}
      >
        <Plus size={12} /> Condición
      </button>
    </div>
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
  node: JourneyNode | null;
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

  if (!node) {
    return (
      <div className="jb-inspect">
        <div className="jb-inspect__hint">
          Toca una estación del riel para editarla. Empieza por la <strong>Entrada</strong> — define
          cómo entran los leads al recorrido.
        </div>
        {stats && stats.total > 0 && (
          <div style={{ marginTop: 18 }}>
            <div className="jb-inspect__h">
              Actividad · {stats.total} inscrito{stats.total === 1 ? "" : "s"}
            </div>
            <div style={{ display: "flex", gap: 6, margin: "8px 0 14px" }}>
              <span className="jb-chip jb-chip--ok">{stats.byStatus.active || 0} activos</span>
              <span className="jb-chip">{stats.byStatus.done || 0} completados</span>
            </div>
            <div className="jb-inspect__k">Timeline reciente</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 6 }}>
              {stats.recent.slice(0, 12).map((r, i) => (
                <div key={i} className="jb-tl">
                  <div className="jb-tl__note">{r.note || `en ${r.node}`}</div>
                  <div className="jb-tl__meta">
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

  const def = JOURNEY_KINDS[node.kind];
  const p = (node.params as NodeParams) || {};
  const set = (patch: NodeParams) => onParams(node.id, patch);

  return (
    <div className="jb-inspect">
      <div className="jb-inspect__head">
        <span className="jb-inspect__ico" style={{ "--_c": def.accent } as React.CSSProperties}>
          <def.icon size={15} strokeWidth={2.2} />
        </span>
        <span className="jb-inspect__title">{def.label}</span>
        {node.kind !== "entry" && (
          <button
            onClick={() => onDelete(node.id)}
            title="Eliminar paso"
            className="jb-inspect__del"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {node.kind === "entry" && (
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
                <option value="manual">Manual (los inscribes tú)</option>
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
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0" }}>
              <Switch
                checked={reenroll}
                onCheckedChange={onReenroll}
                accent="var(--green)"
                aria-label="Permitir re-inscripción"
              />
              <span
                onClick={() => onReenroll(!reenroll)}
                style={{
                  cursor: "pointer",
                  fontSize: 12.5,
                  color: "var(--text-2)",
                  lineHeight: 1.4,
                }}
              >
                Permitir re-inscripción (volver a entrar si ya pasó)
              </span>
            </div>
            <div className="jb-note">
              La entrada automática por disparador/segmento la activa el tick del runner. La
              inscripción manual ya funciona desde Leads.
            </div>
          </>
        )}

        {node.kind === "send" && (
          <>
            <Field label="Canal">
              <SegmentedControl
                value={String(p.channel || "whatsapp")}
                onValueChange={(channel) => set({ channel })}
                options={[
                  { value: "whatsapp", label: "WhatsApp", color: "var(--green)" },
                  { value: "email", label: "Email", color: "var(--gold)" },
                ]}
                block
              />
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
            <div className="jb-note">
              El envío pasa por el gate de supresión (no le manda a un DNC).
            </div>
          </>
        )}

        {node.kind === "wait" && (
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

        {node.kind === "branch" && (
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
            <div className="jb-note">
              <strong>Sí</strong> = el lead cumple · <strong>No</strong> = no cumple.
            </div>
          </>
        )}

        {node.kind === "split" && (
          <>
            <Field label="% que va a la rama A">
              <input
                type="number"
                min={0}
                max={100}
                value={Number(p.percent ?? 50)}
                onChange={(e) =>
                  set({ percent: Math.max(0, Math.min(100, Number(e.target.value))) })
                }
                style={jbInput(90)}
              />
            </Field>
            <div className="jb-note">
              Reparte los leads de forma estable: el mismo lead cae siempre en la misma rama.{" "}
              <strong>A</strong> recibe {Number(p.percent ?? 50)}% · <strong>B</strong> el resto.
            </div>
          </>
        )}

        {node.kind === "action" && (
          <>
            <Field label="Tipo de acción">
              <select
                value={String(p.type || "moveStage")}
                onChange={(e) => set({ type: e.target.value })}
                style={jbInput()}
              >
                <option value="moveStage">Mover a etapa</option>
                <option value="webhook">Llamar webhook</option>
                <option value="enqueueDialer">Llamar (encolar al dialer)</option>
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

        {node.kind === "exit" && (
          <div className="jb-note" style={{ fontSize: 12.5 }}>
            Fin del recorrido. Al llegar aquí, el lead sale del journey (enrollment «done»).
          </div>
        )}
      </div>
    </div>
  );
}
