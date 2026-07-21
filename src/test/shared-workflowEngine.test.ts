import { describe, it, expect } from "vitest";
import {
  matchTrigger,
  matchingWorkflows,
  evalConditions,
  runFromStart,
  isInstant,
  startNodeId,
  type WorkflowDef,
  type WorkflowEvent,
} from "../../amplify/functions/_shared/workflowEngine";

/**
 * Red de seguridad del motor UNIFICADO (Fase 2). Blinda lo NUEVO —el matching de
 * triggers por evento— y demuestra la tesis del spec: UN solo motor
 * (`planAdvance`) ejecuta las 3 formas. Puro, sin AWS.
 */
const NOW = Date.parse("2026-07-01T12:00:00.000Z");

function wf(partial: Partial<WorkflowDef>): WorkflowDef {
  return {
    workflowId: "w1",
    name: "Test",
    status: "active",
    trigger: { kind: "event", type: "lead_created" },
    nodes: [],
    edges: [],
    ...partial,
  };
}
function ev(type: string, ctx: WorkflowEvent["ctx"] = {}): WorkflowEvent {
  return { type, tenantId: "t1", ctx };
}

describe("matchTrigger (espejo del automation-engine)", () => {
  it("matchea por tipo de evento; ignora tipos distintos", () => {
    const w = wf({ trigger: { kind: "event", type: "lead_created" } });
    expect(matchTrigger(w, ev("lead_created"))).toBe(true);
    expect(matchTrigger(w, ev("wrapup_saved"))).toBe(false);
  });

  it("solo dispara si está activo", () => {
    const w = wf({ status: "paused", trigger: { kind: "event", type: "lead_created" } });
    expect(matchTrigger(w, ev("lead_created"))).toBe(false);
  });

  it("los triggers por segmento/manual NO reaccionan a eventos", () => {
    expect(
      matchTrigger(wf({ trigger: { kind: "segment", segmentId: "s" } }), ev("lead_created")),
    ).toBe(false);
    expect(matchTrigger(wf({ trigger: { kind: "manual" } }), ev("lead_created"))).toBe(false);
    expect(matchTrigger(wf({ trigger: { kind: "new_lead" } }), ev("lead_created"))).toBe(false);
  });

  it("filtra por params: stageId / flowName / channel / tag", () => {
    const stage = wf({
      trigger: { kind: "event", type: "lead_stage_changed", params: { stageId: "won" } },
    });
    expect(matchTrigger(stage, ev("lead_stage_changed", { stageId: "won" }))).toBe(true);
    expect(matchTrigger(stage, ev("lead_stage_changed", { stageId: "lost" }))).toBe(false);
    // sin param → cualquier etapa
    const anyStage = wf({ trigger: { kind: "event", type: "lead_stage_changed" } });
    expect(matchTrigger(anyStage, ev("lead_stage_changed", { stageId: "x" }))).toBe(true);

    const flow = wf({
      trigger: { kind: "event", type: "whatsapp_flow_completed", params: { flowName: "Meta" } },
    });
    expect(matchTrigger(flow, ev("whatsapp_flow_completed", { flowName: "meta" }))).toBe(true); // case-insensitive
    expect(matchTrigger(flow, ev("whatsapp_flow_completed", { flowName: "otro" }))).toBe(false);

    const msg = wf({
      trigger: { kind: "event", type: "message_inbound", params: { channel: "whatsapp" } },
    });
    expect(matchTrigger(msg, ev("message_inbound", { channel: "whatsapp" }))).toBe(true);
    expect(matchTrigger(msg, ev("message_inbound", { channel: "instagram" }))).toBe(false);

    const tag = wf({ trigger: { kind: "event", type: "tag_applied", params: { tag: "VIP" } } });
    expect(matchTrigger(tag, ev("tag_applied", { tag: "vip" }))).toBe(true);
    expect(matchTrigger(tag, ev("tag_applied", { tag: "otro" }))).toBe(false);
  });

  it("aplica las condiciones (filtro) del trigger", () => {
    const w = wf({
      trigger: {
        kind: "event",
        type: "lead_created",
        conditions: [{ field: "source", op: "contains", value: "meta" }],
      },
    });
    expect(matchTrigger(w, ev("lead_created", { source: "facebook-meta" }))).toBe(true);
    expect(matchTrigger(w, ev("lead_created", { source: "web" }))).toBe(false);
  });

  it("evalConditions: eq/neq/contains/exists/notexists", () => {
    const ctx = { source: "web", stageId: "" };
    expect(evalConditions([{ field: "source", op: "eq", value: "web" }], ctx)).toBe(true);
    expect(evalConditions([{ field: "source", op: "neq", value: "web" }], ctx)).toBe(false);
    expect(evalConditions([{ field: "stageId", op: "notexists" }], ctx)).toBe(true);
    expect(evalConditions([{ field: "source", op: "exists" }], ctx)).toBe(true);
    expect(evalConditions(undefined, ctx)).toBe(true); // sin condiciones → siempre
  });

  it("matchingWorkflows filtra la lista a los que reaccionan", () => {
    const list = [
      wf({ workflowId: "a", trigger: { kind: "event", type: "lead_created" } }),
      wf({ workflowId: "b", trigger: { kind: "event", type: "wrapup_saved" } }),
      wf({ workflowId: "c", status: "paused", trigger: { kind: "event", type: "lead_created" } }),
      wf({ workflowId: "d", trigger: { kind: "segment", segmentId: "s" } }),
    ];
    expect(matchingWorkflows(list, ev("lead_created")).map((w) => w.workflowId)).toEqual(["a"]);
  });
});

describe("un solo motor ejecuta las 3 formas (planAdvance reutilizado)", () => {
  const reflex = wf({
    trigger: { kind: "event", type: "lead_created" },
    nodes: [
      { id: "e", kind: "entry" },
      { id: "s", kind: "send_whatsapp", params: { templateName: "hola" } },
      { id: "x", kind: "exit" },
    ],
    edges: [
      { from: "e", to: "s" },
      { from: "s", to: "x" },
    ],
  });
  const recorrido = wf({
    trigger: { kind: "event", type: "lead_created" },
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
  });

  it("REFLEJO (sin esperas): ejecuta los pasos y TERMINA en el primer tick", () => {
    const plan = runFromStart(reflex, { leadId: "L1" }, NOW)!;
    expect(plan.effects.map((e) => e.type)).toEqual(["send"]);
    expect(plan.done).toBe(true); // no descansa → equivale a una regla instantánea
    expect(isInstant(reflex, { leadId: "L1" }, NOW)).toBe(true);
  });

  it("RECORRIDO (con espera): ejecuta hasta el wait y DESCANSA (+2 días)", () => {
    const plan = runFromStart(recorrido, { leadId: "L1" }, NOW)!;
    expect(plan.effects.map((e) => e.type)).toEqual(["send"]); // solo el 1er envío este tick
    expect(plan.done).toBe(false); // descansa en la espera
    expect(Date.parse(plan.nextRunAt)).toBe(NOW + 2 * 86_400_000);
    expect(isInstant(recorrido, { leadId: "L1" }, NOW)).toBe(false);
  });

  it("startNodeId encuentra la Entrada del grafo", () => {
    expect(startNodeId(reflex)).toBe("e");
  });
});
