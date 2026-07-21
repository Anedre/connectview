import type { ActionType, AutomationRule, RuleCondition, TriggerType } from "@/lib/automations";
import type { Journey, JourneyEdge, JourneyNode, JourneyNodeKind } from "@/hooks/useJourneys";

/**
 * workflows — la FACHADA de "Flujos" (fusión Automatización + Journey, Fase 1).
 *
 * Fuente ÚNICA y PURA del mapeo entre el modelo unificado `Workflow` y los dos
 * formatos que hoy ejecutan los motores REALES, sin tocarlos:
 *   · una **regla** (`connectview-automation-rules` → automation-engine, instantáneo)
 *   · un **journey** (`journeys` → journey-runner, poll 5 min, con estado por-lead)
 *
 * El usuario ve UN builder (el canvas de Journey extendido con entrada por evento);
 * al guardar, `saveWorkflow` (hook) rutea al motor correcto según la FORMA:
 *
 *   | forma   | trigger  | pasos                         | persiste como            |
 *   | ------- | -------- | ----------------------------- | ------------------------ |
 *   | reflex  | evento   | solo acciones (sin espera)    | regla                    |
 *   | journey | segmento | acción / espera / rama        | journey def              |
 *   | split   | evento   | con espera/rama               | regla(→start_journey)+journey |
 *
 * Todo aquí es PURO y testeable (cero red, cero AWS): produce EXACTAMENTE los
 * mismos formatos que generan hoy los builders actuales. El riesgo de la Fase 1
 * está en este mapeo → lo blinda `workflows.test.ts` con round-trips de ida y
 * vuelta (idempotencia + sin-pérdida en ambos sentidos).
 *
 * Decisión de modelo: `Workflow` reutiliza el GRAFO del journey (`nodes`+`edges`),
 * no una lista lineal de "steps". Motivo: (1) el builder ES el canvas de journey
 * —cero reescritura—, (2) un journey con ramas NO es representable como secuencia
 * sin pérdida, y (3) una regla es el caso lineal degenerado del grafo. Un "step"
 * del spec = un `JourneyNode`.
 */

// ── Modelo unificado ─────────────────────────────────────────────────────────

/** De qué motor/registro salió (o va) el workflow — decide lectura y ruteo. */
export type WorkflowSource = "rule" | "journey" | "split";

/** Estado nativo de un journey (se preserva para el round-trip sin pérdida). */
export type WorkflowStatus = "draft" | "active" | "paused";

/**
 * La entrada unificada. `event` = uno de los 9 disparadores de Automatización
 * (push, instantáneo). `segment`/`new_lead`/`manual` = las entradas tipo-journey
 * (auto-enroll por match cada 5 min, o inscripción manual/por otra regla).
 */
export type WorkflowTrigger =
  | {
      kind: "event";
      type: TriggerType;
      params?: Record<string, unknown>;
      /** Filtro a nivel regla (solo corre si se cumplen). */
      conditions?: RuleCondition[];
    }
  | { kind: "segment"; segmentId: string }
  | { kind: "new_lead" }
  | { kind: "manual" };

export interface Workflow {
  /**
   * Id namespaceado para la lista unificada: `"rule:<ruleId>"` |
   * `"journey:<journeyId>"` | `"split:<ruleId>:<journeyId>"`. Vacío = nuevo.
   */
  id: string;
  source: WorkflowSource;
  name: string;
  /** Activo/pausado. Para journeys mapea con `status` (active ↔ enabled). */
  enabled: boolean;
  trigger: WorkflowTrigger;
  /** El grafo del canvas (incluye el nodo `entry`). Para una regla es lineal. */
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  // ── Metadatos preservados para el round-trip (fuente journey) ──
  status?: WorkflowStatus;
  reenroll?: boolean;
  goal?: { segmentId?: string; stageId?: string };
}

/** La forma de un workflow decide a qué motor va. */
export type WorkflowShape = "reflex" | "journey" | "split";

// ── Catálogo de kinds ────────────────────────────────────────────────────────

/**
 * Kinds que NO son "acción instantánea": esperas y bifurcaciones. Su presencia
 * saca al workflow de la forma `reflex` (necesita el journey-runner con estado).
 */
const NON_INSTANT_KINDS: ReadonlySet<JourneyNodeKind> = new Set<JourneyNodeKind>([
  "wait",
  "wait_business",
  "wait_weekday",
  "wait_event",
  "branch",
  "split",
  "switch",
  "leave",
  "goal",
]);

/** Nodos estructurales (no son pasos ejecutables ni acciones de regla). */
const STRUCTURAL_KINDS: ReadonlySet<JourneyNodeKind> = new Set<JourneyNodeKind>(["entry", "exit"]);

// ── Mapa bidireccional: nodo de journey ⇄ acción de automatización ────────────
//
// Los dos catálogos están ESPEJADOS a propósito (mismos executors) pero con
// nombres/params distintos: `tag{op}` ↔ `apply_tag`/`remove_tag`, `set_field`
// ↔ `apply_attribute`, `score` ↔ `apply_score`, etc. Este mapa es la traducción
// exacta y es lo que blindan los tests de round-trip.

/** Clave privada donde se preservan las condiciones POR ACCIÓN de una regla
 *  (ramas de acción del automation-engine) al viajar por un nodo del canvas.
 *  Nunca se serializa a un journey (solo existe en workflows forma `reflex`). */
const NODE_RULE_CONDS = "__ruleConditions";

/** Copia `params` quitando las claves internas de mapeo. */
function cleanParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const p = { ...(params || {}) };
  delete p[NODE_RULE_CONDS];
  return p;
}

/**
 * Nodo de journey → acción de automatización. Devuelve `null` cuando el nodo NO
 * es representable como acción instantánea (una espera, una rama, o una acción
 * que el motor de reglas no tiene — p.ej. `subscription{op:"subscribe"}`, que
 * solo existe en el journey-runner). Un `null` fuerza la forma `split`/`journey`.
 */
export function nodeToAction(
  node: JourneyNode,
): { type: ActionType; params: Record<string, unknown> } | null {
  const p = cleanParams(node.params);
  switch (node.kind) {
    case "send_whatsapp":
      return { type: "send_whatsapp_template", params: p };
    case "send_email":
      return { type: "send_email", params: p };
    case "send": {
      // Legacy: un solo nodo con `channel`.
      const channel = String(p.channel || "whatsapp");
      const { channel: _drop, ...rest } = p;
      void _drop;
      return channel === "email"
        ? { type: "send_email", params: rest }
        : { type: "send_whatsapp_template", params: rest };
    }
    case "move_stage":
      return { type: "move_stage", params: p };
    case "tag": {
      const { op, ...rest } = p;
      return op === "remove"
        ? { type: "remove_tag", params: rest }
        : { type: "apply_tag", params: rest };
    }
    case "set_field":
      return { type: "apply_attribute", params: p };
    case "notify_agent":
      return { type: "notify_agent", params: p };
    case "enqueue_dialer":
      return { type: "enqueue_dialer", params: p };
    case "webhook":
      return { type: "webhook", params: p };
    case "start_journey":
      return { type: "start_journey", params: p };
    case "score":
      return { type: "apply_score", params: p };
    case "note":
      return { type: "add_note", params: p };
    case "subscription": {
      // El motor de reglas solo tiene "dar de baja"; "suscribir" no es reflex.
      if (p.op === "subscribe") return null;
      const { op: _op, ...rest } = p;
      void _op;
      return { type: "unsubscribe", params: rest };
    }
    case "set_program":
      return { type: "set_program", params: p };
    case "sf_push":
      return { type: "mark_salesforce_sync", params: p };
    case "unenroll":
      return { type: "unenroll_journey", params: p };
    case "action": {
      // Nodo genérico: puede venir de una regla legacy (schedule_callback etc.)
      // preservada, o del `action{type}` clásico del journey.
      const wf = p.__wfAction as string | undefined;
      if (wf) {
        const { __wfAction: _drop, ...rest } = p;
        void _drop;
        return { type: wf as ActionType, params: rest };
      }
      const t = String(p.type || "");
      const { type: _t, ...rest } = p;
      void _t;
      if (t === "moveStage") return { type: "move_stage", params: rest };
      if (t === "webhook") return { type: "webhook", params: rest };
      if (t === "enqueueDialer") return { type: "enqueue_dialer", params: rest };
      return null;
    }
    default:
      return null; // wait/branch/split/switch/leave/goal/entry/exit
  }
}

/**
 * Acción de automatización → nodo de journey (el inverso de `nodeToAction`).
 * `id` lo pone el llamador. Preserva las condiciones de la acción en la clave
 * interna. Las acciones sin nodo-espejo (`schedule_callback`) se guardan en un
 * nodo `action` genérico con `__wfAction`, sin pérdida.
 */
export function actionToNode(action: {
  type: ActionType;
  params?: Record<string, unknown>;
  conditions?: RuleCondition[];
}): { kind: JourneyNodeKind; params: Record<string, unknown> } {
  const p = { ...(action.params || {}) };
  const withConds = (kind: JourneyNodeKind, params: Record<string, unknown>) => {
    const out = { ...params };
    if (action.conditions && action.conditions.length) out[NODE_RULE_CONDS] = action.conditions;
    return { kind, params: out };
  };
  switch (action.type) {
    case "send_whatsapp_template":
      return withConds("send_whatsapp", p);
    case "send_email":
      return withConds("send_email", p);
    case "move_stage":
      return withConds("move_stage", p);
    case "apply_tag":
      return withConds("tag", { op: "add", ...p });
    case "remove_tag":
      return withConds("tag", { op: "remove", ...p });
    case "apply_attribute":
      return withConds("set_field", p);
    case "notify_agent":
      return withConds("notify_agent", p);
    case "enqueue_dialer":
      return withConds("enqueue_dialer", p);
    case "webhook":
      return withConds("webhook", p);
    case "start_journey":
      return withConds("start_journey", p);
    case "apply_score":
      return withConds("score", p);
    case "add_note":
      return withConds("note", p);
    case "unsubscribe":
      return withConds("subscription", { op: "unsubscribe", ...p });
    case "set_program":
      return withConds("set_program", p);
    case "mark_salesforce_sync":
      return withConds("sf_push", p);
    case "unenroll_journey":
      return withConds("unenroll", p);
    default:
      // schedule_callback (y cualquier acción futura sin nodo-espejo): genérico.
      return withConds("action", { __wfAction: action.type, ...p });
  }
}

// ── Clasificación de forma ────────────────────────────────────────────────────

/** Los nodos "de paso" del grafo (sin los estructurales entry/exit). */
function stepNodes(w: Pick<Workflow, "nodes">): JourneyNode[] {
  return w.nodes.filter((n) => !STRUCTURAL_KINDS.has(n.kind));
}

/**
 * ¿A qué motor va este workflow? Regla de decisión (espejo del spec):
 *   · trigger ≠ evento               → journey (segmentos/manual = journey-runner)
 *   · evento + hay espera/rama       → split   (regla evento → start_journey(J))
 *   · evento + acción no-representable→ split   (p.ej. subscribe: solo el runner)
 *   · evento + solo acciones lineales→ reflex   (una regla instantánea)
 */
export function classifyShape(w: Pick<Workflow, "trigger" | "nodes" | "edges">): WorkflowShape {
  if (w.trigger.kind !== "event") return "journey";
  const steps = stepNodes(w);
  for (const n of steps) {
    if (NON_INSTANT_KINDS.has(n.kind)) return "split";
    if (nodeToAction(n) === null) return "split";
  }
  // Un action-like con más de una salida usada rompe la linealidad → split.
  for (const n of steps) {
    const outCount = w.edges.filter((e) => e.from === n.id).length;
    if (outCount > 1) return "split";
  }
  return "reflex";
}

// ── Linealización del grafo (para la forma reflex) ────────────────────────────

/** El nodo `entry` (o el primero sin edge entrante). */
function entryNode(w: Pick<Workflow, "nodes" | "edges">): JourneyNode | undefined {
  const e = w.nodes.find((n) => n.kind === "entry");
  if (e) return e;
  const hasIncoming = new Set(w.edges.map((ed) => ed.to));
  return w.nodes.find((n) => !hasIncoming.has(n.id)) || w.nodes[0];
}

/** Sucesor por la salida por defecto (edge sin `on`, o el primero). */
function successorId(w: Pick<Workflow, "edges">, id: string): string | undefined {
  const outs = w.edges.filter((e) => e.from === id);
  return (outs.find((e) => !e.on) || outs[0])?.to;
}

/**
 * Recorre la cadena lineal desde la entrada y devuelve los nodos de acción en
 * orden (saltando entry/exit). Asume forma reflex (sin ramas); corta al primer
 * exit o nodo sin sucesor. Cap de seguridad anti-loop.
 */
function linearSteps(w: Pick<Workflow, "nodes" | "edges">): JourneyNode[] {
  const byId = new Map(w.nodes.map((n) => [n.id, n]));
  const out: JourneyNode[] = [];
  const seen = new Set<string>();
  let cur = entryNode(w);
  let guard = 0;
  while (cur && !seen.has(cur.id) && guard++ < 200) {
    seen.add(cur.id);
    if (cur.kind === "exit") break;
    if (!STRUCTURAL_KINDS.has(cur.kind)) out.push(cur);
    const nextId = successorId(w, cur.id);
    cur = nextId ? byId.get(nextId) : undefined;
  }
  return out;
}

// ── Generación de ids/estructura de grafo (determinística) ────────────────────

/** Grafo lineal entry → paso₁ → … → pasoₙ → exit, con ids estables (`wf-*`). */
function linearGraph(steps: Array<{ kind: JourneyNodeKind; params: Record<string, unknown> }>): {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
} {
  const entryId = "wf-entry";
  const exitId = "wf-exit";
  const nodes: JourneyNode[] = [{ id: entryId, kind: "entry", params: {} }];
  const edges: JourneyEdge[] = [];
  let prev = entryId;
  steps.forEach((s, i) => {
    const id = `wf-${i}`;
    nodes.push({ id, kind: s.kind, params: s.params });
    edges.push({ from: prev, to: id });
    prev = id;
  });
  nodes.push({ id: exitId, kind: "exit", params: {} });
  edges.push({ from: prev, to: exitId });
  return { nodes, edges };
}

// ── Regla ⇄ Workflow ──────────────────────────────────────────────────────────

/** Una regla (AutomationRule) → Workflow (forma reflex). */
export function fromRule(rule: AutomationRule): Workflow {
  const steps = (rule.actions || []).map((a) => actionToNode(a));
  const { nodes, edges } = linearGraph(steps);
  return {
    id: rule.ruleId ? `rule:${rule.ruleId}` : "",
    source: "rule",
    name: rule.name,
    enabled: !!rule.enabled,
    trigger: {
      kind: "event",
      type: rule.trigger.type,
      ...(rule.trigger.params ? { params: rule.trigger.params } : {}),
      ...(rule.conditions && rule.conditions.length ? { conditions: rule.conditions } : {}),
    },
    nodes,
    edges,
  };
}

/** Extrae el ruleId de un id namespaceado (`rule:xxx` o `split:rule:journey`). */
export function ruleIdOf(id: string): string | undefined {
  if (id.startsWith("rule:")) return id.slice("rule:".length);
  if (id.startsWith("split:")) return id.split(":")[1] || undefined;
  return undefined;
}
/** Extrae el journeyId de un id namespaceado (`journey:xxx` o `split:...`). */
export function journeyIdOf(id: string): string | undefined {
  if (id.startsWith("journey:")) return id.slice("journey:".length);
  if (id.startsWith("split:")) return id.split(":")[2] || undefined;
  return undefined;
}

/**
 * Workflow (forma reflex) → regla. Lanza si el workflow no es reflex (bug de
 * ruteo). Produce EXACTAMENTE el formato de `AutomationRule` que consume hoy el
 * automation-engine.
 */
export function toRule(w: Workflow): AutomationRule {
  if (w.trigger.kind !== "event") throw new Error("toRule: el workflow no tiene trigger de evento");
  const actions = linearSteps(w).map((n) => {
    const mapped = nodeToAction(n);
    if (!mapped)
      throw new Error(`toRule: el paso "${n.kind}" no es una acción de regla (usá split/journey)`);
    const conds = (n.params?.[NODE_RULE_CONDS] as RuleCondition[] | undefined) || undefined;
    return {
      type: mapped.type,
      params: mapped.params,
      ...(conds && conds.length ? { conditions: conds } : {}),
    };
  });
  const ruleId = ruleIdOf(w.id);
  return {
    ...(ruleId ? { ruleId } : {}),
    name: w.name,
    enabled: w.enabled,
    trigger: {
      type: w.trigger.type,
      params: w.trigger.params || {},
    },
    conditions: w.trigger.conditions || [],
    actions,
  };
}

// ── Journey ⇄ Workflow ────────────────────────────────────────────────────────

/** El `entry` del journey → trigger unificado. */
function entryToTrigger(entry: Journey["entry"]): WorkflowTrigger {
  if (entry?.segmentId) return { kind: "segment", segmentId: entry.segmentId };
  if (entry?.trigger === "new_lead") return { kind: "new_lead" };
  return { kind: "manual" };
}

/** Trigger unificado → `entry` del journey (para segment/new_lead/manual). */
function triggerToEntry(trigger: WorkflowTrigger): Journey["entry"] {
  if (trigger.kind === "segment") return { segmentId: trigger.segmentId };
  if (trigger.kind === "new_lead") return { trigger: "new_lead" };
  return { manual: true }; // "manual" y el caso "event" de un split (lo enrola la regla)
}

/** Un journey → Workflow (forma journey/recorrido). */
export function fromJourney(j: Journey): Workflow {
  return {
    id: j.journeyId ? `journey:${j.journeyId}` : "",
    source: "journey",
    name: j.name,
    enabled: j.status === "active",
    status: j.status,
    trigger: entryToTrigger(j.entry),
    nodes: Array.isArray(j.nodes) ? j.nodes : [],
    edges: Array.isArray(j.edges) ? j.edges : [],
    reenroll: !!j.reenroll,
    ...(j.goal ? { goal: j.goal } : {}),
  };
}

/**
 * Workflow → journey def. `enabled` mapea con `status` (active ↔ enabled),
 * preservando el status nativo (draft/paused) cuando existe. El nodo `entry`
 * del grafo se conserva; la ENTRADA (segment/manual) vive en `entry`.
 */
export function toJourney(w: Workflow): Journey {
  const journeyId = journeyIdOf(w.id) || "";
  const status: WorkflowStatus = w.status ?? (w.enabled ? "active" : "paused");
  return {
    journeyId,
    name: w.name,
    status,
    entry: triggerToEntry(w.trigger),
    reenroll: !!w.reenroll,
    nodes: w.nodes,
    edges: w.edges,
    ...(w.goal ? { goal: w.goal } : {}),
  };
}

// ── Split: evento + espera → regla(→start_journey) + journey ──────────────────

/** Marca (en params de la acción) que la regla nació de un split de la fachada,
 *  para re-ensamblar el workflow al leer sin confundirlo con un combo manual. */
export const SPLIT_MARK = "__wfSplit";

export interface SplitResult {
  /** El journey con los pasos-con-espera. Sin id hasta guardarlo. Nace `active`
   *  si el workflow está habilitado (start_journey exige journey activo). */
  journey: Journey;
  /**
   * Arma la regla-puente una vez que el journey tiene id. Su única acción es
   * `start_journey(journeyId)`, marcada con {@link SPLIT_MARK}.
   */
  buildRule: (journeyId: string) => AutomationRule;
}

/**
 * Descompone un workflow "evento + espera/rama" en el PUENTE que ya existe: una
 * regla que reacciona al evento e inscribe al lead en un journey con los pasos
 * en el tiempo. Reversible al leer (ver `SPLIT_MARK`). PURO: no persiste nada;
 * el hook `saveWorkflow` orquesta el guardado en 2 fases (journey → regla).
 */
export function splitEventWithWait(w: Workflow): SplitResult {
  if (w.trigger.kind !== "event")
    throw new Error("splitEventWithWait: el workflow no tiene trigger de evento");
  const journey: Journey = {
    journeyId: journeyIdOf(w.id) || "",
    name: w.name,
    // El journey se inscribe por la regla (start_journey), no por auto-enroll.
    status: w.enabled ? "active" : "paused",
    entry: { manual: true },
    reenroll: !!w.reenroll,
    nodes: w.nodes,
    edges: w.edges,
    ...(w.goal ? { goal: w.goal } : {}),
  };
  const trigger = w.trigger;
  const buildRule = (journeyId: string): AutomationRule => ({
    ...(ruleIdOf(w.id) ? { ruleId: ruleIdOf(w.id) } : {}),
    name: w.name,
    enabled: w.enabled,
    trigger: { type: trigger.type, params: trigger.params || {} },
    conditions: trigger.conditions || [],
    actions: [{ type: "start_journey", params: { journeyId, [SPLIT_MARK]: true } }],
  });
  return { journey, buildRule };
}

/** ¿Esta regla es la mitad-puente de un split de la fachada? (1 sola acción
 *  `start_journey` marcada). Se usa al leer para re-ensamblar el workflow. */
export function isSplitRule(rule: AutomationRule): boolean {
  return (
    Array.isArray(rule.actions) &&
    rule.actions.length === 1 &&
    rule.actions[0].type === "start_journey" &&
    !!rule.actions[0].params?.[SPLIT_MARK]
  );
}

/** El journeyId al que apunta una regla-puente de split (o undefined). */
export function splitTargetJourneyId(rule: AutomationRule): string | undefined {
  if (!isSplitRule(rule)) return undefined;
  const id = String(rule.actions[0].params?.journeyId || "");
  return id || undefined;
}

/**
 * Re-ensambla un workflow "evento + espera" desde sus dos registros (la regla
 * puente + el journey destino). Inverso de `splitEventWithWait`.
 */
export function fromSplit(rule: AutomationRule, journey: Journey): Workflow {
  return {
    id: `split:${rule.ruleId || ""}:${journey.journeyId || ""}`,
    source: "split",
    name: rule.name || journey.name,
    enabled: !!rule.enabled,
    status: journey.status,
    trigger: {
      kind: "event",
      type: rule.trigger.type,
      ...(rule.trigger.params ? { params: rule.trigger.params } : {}),
      ...(rule.conditions && rule.conditions.length ? { conditions: rule.conditions } : {}),
    },
    nodes: Array.isArray(journey.nodes) ? journey.nodes : [],
    edges: Array.isArray(journey.edges) ? journey.edges : [],
    reenroll: !!journey.reenroll,
    ...(journey.goal ? { goal: journey.goal } : {}),
  };
}
