import { describe, it, expect } from "vitest";
import type { AutomationRule, ActionType } from "@/lib/automations";
import type { Journey } from "@/hooks/useJourneys";
import {
  fromRule,
  toRule,
  fromJourney,
  toJourney,
  classifyShape,
  splitEventWithWait,
  isSplitRule,
  splitTargetJourneyId,
  fromSplit,
  nodeToAction,
  actionToNode,
  ruleIdOf,
  journeyIdOf,
  SPLIT_MARK,
  type Workflow,
} from "@/lib/workflows";

/**
 * Red de seguridad del MAPEO de la fachada Flujos (Fase 1). El riesgo de la
 * fusión está aquí: un mapeo malo = regla/journey malformado que el motor ejecuta
 * mal (mensaje duplicado / nurture roto). Estos round-trips garantizan que la
 * fachada produce EXACTAMENTE los mismos formatos que los builders de hoy, en
 * ambos sentidos (idempotencia + sin-pérdida). Todo PURO — sin red ni AWS.
 */

// ── Reglas canónicas (formato que consume el automation-engine) ───────────────

/** Una regla "kitchen sink": cubre condiciones a nivel regla, condiciones por
 *  acción, y una acción por cada familia de mapeo (tag add/remove, score, etc.). */
const KITCHEN_SINK_RULE: AutomationRule = {
  ruleId: "r-sink",
  name: "Kitchen sink",
  enabled: true,
  trigger: { type: "whatsapp_flow_completed", params: { flowName: "meta" } },
  conditions: [{ field: "source", op: "contains", value: "meta" }],
  actions: [
    { type: "apply_score", params: { delta: 25 } },
    { type: "apply_tag", params: { tag: "caliente" } },
    { type: "remove_tag", params: { tag: "frío" } },
    { type: "set_program", params: { programId: "p1" } },
    {
      type: "send_whatsapp_template",
      params: { templateName: "bienvenida", variables: ["{{name}}"] },
    },
    { type: "send_email", params: { subject: "Hola", body: "cuerpo" } },
    { type: "apply_attribute", params: { field: "prioridad", value: "alta" } },
    { type: "move_stage", params: { stageId: "contactado" } },
    { type: "notify_agent", params: { message: "llámalo", agent: "u1" } },
    { type: "enqueue_dialer", params: { campaignId: "c1", notes: "urgente" } },
    { type: "schedule_callback", params: { offsetHours: 2, channel: "voice", notes: "seg" } },
    { type: "webhook", params: { url: "https://x.test/hook" } },
    { type: "add_note", params: { text: "nota interna" } },
    { type: "unsubscribe", params: { channel: "whatsapp" } },
    { type: "mark_salesforce_sync", params: {} },
    { type: "unenroll_journey", params: { journeyId: "j-old" } },
    { type: "start_journey", params: { journeyId: "j-nurture" } },
    // Acción con condiciones PROPIAS (rama de acción del automation-engine).
    {
      type: "apply_tag",
      params: { tag: "vip" },
      conditions: [{ field: "valoracion", op: "eq", value: "positiva" }],
    },
  ],
};

const SIMPLE_RULE: AutomationRule = {
  ruleId: "r1",
  name: "Bienvenida web",
  enabled: false,
  trigger: { type: "lead_created", params: {} },
  conditions: [],
  actions: [
    { type: "send_whatsapp_template", params: { templateName: "hola", variables: ["{{name}}"] } },
  ],
};

describe("regla ⇄ workflow (ida y vuelta sin pérdida)", () => {
  it("rule → wf → rule reproduce la regla (kitchen sink, todas las familias)", () => {
    const back = toRule(fromRule(KITCHEN_SINK_RULE));
    expect(back).toEqual(KITCHEN_SINK_RULE);
  });

  it("rule → wf → rule reproduce una regla simple", () => {
    expect(toRule(fromRule(SIMPLE_RULE))).toEqual(SIMPLE_RULE);
  });

  it("wf → rule → wf es idempotente (reflex)", () => {
    const w = fromRule(KITCHEN_SINK_RULE);
    expect(fromRule(toRule(w))).toEqual(w);
  });

  it("cada ActionType hace round-trip a través del nodo del canvas", () => {
    const ALL: Array<{ type: ActionType; params: Record<string, unknown> }> = [
      { type: "send_whatsapp_template", params: { templateName: "t" } },
      { type: "send_email", params: { subject: "s", body: "b" } },
      { type: "move_stage", params: { stageId: "x" } },
      { type: "schedule_callback", params: { offsetHours: 1, channel: "voice" } },
      { type: "enqueue_dialer", params: { campaignId: "c" } },
      { type: "webhook", params: { url: "u" } },
      { type: "apply_tag", params: { tag: "a" } },
      { type: "remove_tag", params: { tag: "a" } },
      { type: "apply_attribute", params: { field: "f", value: "v" } },
      { type: "apply_score", params: { delta: 5 } },
      { type: "set_program", params: { programId: "p" } },
      { type: "unsubscribe", params: { channel: "all" } },
      { type: "add_note", params: { text: "n" } },
      { type: "mark_salesforce_sync", params: {} },
      { type: "unenroll_journey", params: { journeyId: "j" } },
      { type: "notify_agent", params: { message: "m" } },
      { type: "start_journey", params: { journeyId: "j" } },
    ];
    for (const a of ALL) {
      const node = actionToNode(a);
      expect(nodeToAction({ id: "n", kind: node.kind, params: node.params })).toEqual(a);
    }
  });

  it("apply_tag y remove_tag mapean al mismo nodo `tag` con op distinto", () => {
    expect(actionToNode({ type: "apply_tag", params: { tag: "x" } })).toMatchObject({
      kind: "tag",
      params: { op: "add", tag: "x" },
    });
    expect(actionToNode({ type: "remove_tag", params: { tag: "x" } })).toMatchObject({
      kind: "tag",
      params: { op: "remove", tag: "x" },
    });
  });

  it("schedule_callback (sin nodo-espejo) sobrevive en un nodo genérico", () => {
    const node = actionToNode({ type: "schedule_callback", params: { offsetHours: 3 } });
    expect(node.kind).toBe("action");
    expect(node.params[SPLIT_MARK]).toBeUndefined();
    expect(nodeToAction({ id: "n", kind: node.kind, params: node.params })).toEqual({
      type: "schedule_callback",
      params: { offsetHours: 3 },
    });
  });
});

// ── Journeys canónicos (formato que consume el journey-runner) ────────────────

/** Journey con ramas, espera, goal, reenroll — el caso "recorrido" completo. */
const BRANCHY_JOURNEY: Journey = {
  journeyId: "j-branch",
  name: "Recorrido con rama",
  status: "active",
  entry: { segmentId: "seg-1" },
  reenroll: true,
  nodes: [
    { id: "e", kind: "entry" },
    { id: "wa", kind: "send_whatsapp", params: { templateName: "hola" } },
    { id: "w", kind: "wait", params: { days: 2 } },
    {
      id: "b",
      kind: "branch",
      params: { rules: [{ field: "score", op: "gte", value: "60" }], match: "all" },
    },
    { id: "mv", kind: "move_stage", params: { stageId: "won" } },
    { id: "x", kind: "exit" },
  ],
  edges: [
    { from: "e", to: "wa" },
    { from: "wa", to: "w" },
    { from: "w", to: "b" },
    { from: "b", to: "mv", on: "yes" },
    { from: "b", to: "x", on: "no" },
    { from: "mv", to: "x" },
  ],
  goal: { stageId: "won" },
};

const MANUAL_DRAFT_JOURNEY: Journey = {
  journeyId: "j-manual",
  name: "Manual borrador",
  status: "draft",
  entry: { manual: true },
  reenroll: false,
  nodes: [
    { id: "e", kind: "entry" },
    { id: "x", kind: "exit" },
  ],
  edges: [{ from: "e", to: "x" }],
};

const NEWLEAD_PAUSED_JOURNEY: Journey = {
  journeyId: "j-new",
  name: "Lead nuevo pausado",
  status: "paused",
  entry: { trigger: "new_lead" },
  reenroll: false,
  nodes: [
    { id: "e", kind: "entry" },
    { id: "s", kind: "send_email", params: { subject: "hey" } },
    { id: "x", kind: "exit" },
  ],
  edges: [
    { from: "e", to: "s" },
    { from: "s", to: "x" },
  ],
};

describe("journey ⇄ workflow (ida y vuelta sin pérdida)", () => {
  for (const j of [BRANCHY_JOURNEY, MANUAL_DRAFT_JOURNEY, NEWLEAD_PAUSED_JOURNEY]) {
    it(`journey → wf → journey reproduce "${j.name}"`, () => {
      expect(toJourney(fromJourney(j))).toEqual(j);
    });
  }

  it("wf → journey → wf es idempotente (recorrido)", () => {
    const w = fromJourney(BRANCHY_JOURNEY);
    expect(fromJourney(toJourney(w))).toEqual(w);
  });

  it("mapea status ↔ enabled (active=on, draft/paused=off) preservando el nativo", () => {
    expect(fromJourney(BRANCHY_JOURNEY).enabled).toBe(true);
    expect(fromJourney(MANUAL_DRAFT_JOURNEY).enabled).toBe(false);
    expect(fromJourney(NEWLEAD_PAUSED_JOURNEY).enabled).toBe(false);
    expect(toJourney(fromJourney(MANUAL_DRAFT_JOURNEY)).status).toBe("draft");
    expect(toJourney(fromJourney(NEWLEAD_PAUSED_JOURNEY)).status).toBe("paused");
  });

  it("mapea la entrada ↔ trigger (segment / new_lead / manual)", () => {
    expect(fromJourney(BRANCHY_JOURNEY).trigger).toEqual({ kind: "segment", segmentId: "seg-1" });
    expect(fromJourney(NEWLEAD_PAUSED_JOURNEY).trigger).toEqual({ kind: "new_lead" });
    expect(fromJourney(MANUAL_DRAFT_JOURNEY).trigger).toEqual({ kind: "manual" });
  });
});

// ── Clasificación de forma (a qué motor va) ───────────────────────────────────

describe("classifyShape (ruteo por forma)", () => {
  it("evento + solo acciones = reflex", () => {
    expect(classifyShape(fromRule(SIMPLE_RULE))).toBe("reflex");
    expect(classifyShape(fromRule(KITCHEN_SINK_RULE))).toBe("reflex");
  });

  it("trigger de segmento o manual = journey", () => {
    expect(classifyShape(fromJourney(BRANCHY_JOURNEY))).toBe("journey");
    expect(classifyShape(fromJourney(MANUAL_DRAFT_JOURNEY))).toBe("journey");
  });

  it("evento + espera = split", () => {
    const w: Workflow = {
      ...fromRule(SIMPLE_RULE),
      nodes: [
        { id: "e", kind: "entry" },
        { id: "s", kind: "send_whatsapp", params: { templateName: "t" } },
        { id: "w", kind: "wait", params: { days: 1 } },
        { id: "x", kind: "exit" },
      ],
      edges: [
        { from: "e", to: "s" },
        { from: "s", to: "w" },
        { from: "w", to: "x" },
      ],
    };
    expect(classifyShape(w)).toBe("split");
  });

  it("evento + rama = split", () => {
    const w: Workflow = {
      ...fromRule(SIMPLE_RULE),
      nodes: [
        { id: "e", kind: "entry" },
        { id: "b", kind: "branch", params: { rules: [], match: "all" } },
        { id: "x", kind: "exit" },
      ],
      edges: [
        { from: "e", to: "b" },
        { from: "b", to: "x", on: "no" },
      ],
    };
    expect(classifyShape(w)).toBe("split");
  });

  it("evento + acción no-representable (subscribe) = split", () => {
    const w: Workflow = {
      ...fromRule(SIMPLE_RULE),
      nodes: [
        { id: "e", kind: "entry" },
        { id: "s", kind: "subscription", params: { op: "subscribe", channel: "all" } },
        { id: "x", kind: "exit" },
      ],
      edges: [
        { from: "e", to: "s" },
        { from: "s", to: "x" },
      ],
    };
    expect(classifyShape(w)).toBe("split");
  });
});

// ── Split: evento + espera → regla(→start_journey) + journey ──────────────────

describe("splitEventWithWait + fromSplit (el puente reversible)", () => {
  const EVENT_WAIT_WF: Workflow = {
    id: "",
    source: "rule",
    name: "Reacción + nurture",
    enabled: true,
    trigger: {
      kind: "event",
      type: "whatsapp_flow_completed",
      params: { flowName: "meta" },
      conditions: [{ field: "source", op: "contains", value: "meta" }],
    },
    nodes: [
      { id: "e", kind: "entry" },
      { id: "s", kind: "send_whatsapp", params: { templateName: "hola" } },
      { id: "w", kind: "wait", params: { days: 2 } },
      { id: "s2", kind: "send_email", params: { subject: "seguimos" } },
      { id: "x", kind: "exit" },
    ],
    edges: [
      { from: "e", to: "s" },
      { from: "s", to: "w" },
      { from: "w", to: "s2" },
      { from: "s2", to: "x" },
    ],
  };

  it("el journey nace activo (si enabled), manual, con los pasos del workflow", () => {
    const { journey } = splitEventWithWait(EVENT_WAIT_WF);
    expect(journey.status).toBe("active");
    expect(journey.entry).toEqual({ manual: true });
    expect(journey.nodes).toBe(EVENT_WAIT_WF.nodes);
  });

  it("la regla-puente reacciona al evento y dispara start_journey(J) marcado", () => {
    const { buildRule } = splitEventWithWait(EVENT_WAIT_WF);
    const rule = buildRule("j-generated");
    expect(rule.trigger).toEqual({ type: "whatsapp_flow_completed", params: { flowName: "meta" } });
    expect(rule.conditions).toEqual([{ field: "source", op: "contains", value: "meta" }]);
    expect(rule.actions).toEqual([
      { type: "start_journey", params: { journeyId: "j-generated", [SPLIT_MARK]: true } },
    ]);
    expect(isSplitRule(rule)).toBe(true);
    expect(splitTargetJourneyId(rule)).toBe("j-generated");
  });

  it("fromSplit re-ensambla el workflow desde la regla + el journey", () => {
    const { journey, buildRule } = splitEventWithWait(EVENT_WAIT_WF);
    // Simula el guardado en 2 fases: el journey obtiene id, la regla también.
    const savedJourney: Journey = { ...journey, journeyId: "j-generated" };
    const savedRule: AutomationRule = { ...buildRule("j-generated"), ruleId: "r-generated" };
    const round = fromSplit(savedRule, savedJourney);
    expect(round.source).toBe("split");
    expect(round.trigger).toEqual(EVENT_WAIT_WF.trigger);
    expect(round.nodes).toEqual(EVENT_WAIT_WF.nodes);
    expect(round.edges).toEqual(EVENT_WAIT_WF.edges);
    expect(round.enabled).toBe(true);
    expect(ruleIdOf(round.id)).toBe("r-generated");
    expect(journeyIdOf(round.id)).toBe("j-generated");
  });

  it("una regla normal (con start_journey manual) NO es un split", () => {
    // El template "instant-plus-journey": start_journey SIN la marca.
    const rule: AutomationRule = {
      ruleId: "r2",
      name: "combo manual",
      enabled: true,
      trigger: { type: "lead_created", params: {} },
      conditions: [],
      actions: [
        { type: "apply_score", params: { delta: 10 } },
        { type: "start_journey", params: { journeyId: "j" } },
      ],
    };
    expect(isSplitRule(rule)).toBe(false);
    // Y se clasifica como reflex (se guarda como regla tal cual).
    expect(classifyShape(fromRule(rule))).toBe("reflex");
  });
});

// ── Helpers de id namespaceado ────────────────────────────────────────────────

describe("ids namespaceados", () => {
  it("rule:/journey:/split: se parsean a los ids del motor", () => {
    expect(ruleIdOf("rule:abc")).toBe("abc");
    expect(journeyIdOf("journey:xyz")).toBe("xyz");
    expect(ruleIdOf("split:r1:j1")).toBe("r1");
    expect(journeyIdOf("split:r1:j1")).toBe("j1");
    expect(ruleIdOf("journey:xyz")).toBeUndefined();
    expect(journeyIdOf("rule:abc")).toBeUndefined();
  });

  it("un id vacío = workflow nuevo (sin ruleId/journeyId)", () => {
    expect(ruleIdOf("")).toBeUndefined();
    expect(journeyIdOf("")).toBeUndefined();
    expect(toRule(fromRule({ ...SIMPLE_RULE, ruleId: undefined })).ruleId).toBeUndefined();
  });
});
