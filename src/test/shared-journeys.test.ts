import { describe, it, expect } from "vitest";
import {
  planAdvance,
  entryNodeId,
  type JourneyDef,
} from "../../amplify/functions/_shared/journeys";

/**
 * Red de seguridad para el CEREBRO del motor de journeys (`planAdvance`). Pura →
 * sin AWS. Fija: encadenado de nodos instantáneos, la demora de un `wait` fijo,
 * las ramas por predicado, y la espera condicional. Fase 3 · 3A.
 */
const NOW = Date.parse("2026-07-01T12:00:00.000Z");

// entry → send → wait 2d → branch(score>=70) → yes:moveStage / no:exit
const J: JourneyDef = {
  journeyId: "j1",
  name: "Test",
  status: "active",
  nodes: [
    { id: "e", kind: "entry" },
    { id: "s", kind: "send", params: { channel: "whatsapp", templateName: "hola" } },
    { id: "w", kind: "wait", params: { days: 2 } },
    {
      id: "b",
      kind: "branch",
      params: { rules: [{ field: "score", op: "gte", value: 70 }], match: "all" },
    },
    { id: "mv", kind: "action", params: { type: "moveStage", stageId: "won" } },
    { id: "x", kind: "exit" },
  ],
  edges: [
    { from: "e", to: "s" },
    { from: "s", to: "w" },
    { from: "w", to: "b" },
    { from: "b", to: "mv", on: "yes" },
    { from: "b", to: "x", on: "no" },
    { from: "mv", to: "x" },
  ],
};

describe("entryNodeId", () => {
  it("encuentra el nodo entry", () => {
    expect(entryNodeId(J)).toBe("e");
  });
});

describe("planAdvance", () => {
  it("encadena entry→send y DESCANSA en el branch tras el wait de 2d", () => {
    const p = planAdvance(J, "e", { score: 80 }, NOW);
    expect(p.effects.map((e) => e.type)).toEqual(["send"]); // solo el send se ejecuta este tick
    expect(p.nextNodeId).toBe("b"); // descansa en el sucesor del wait (el branch)
    expect(p.done).toBe(false);
    expect(Date.parse(p.nextRunAt)).toBe(NOW + 2 * 86_400_000); // +2 días
  });

  it("branch YES (score alto) → moveStage → exit", () => {
    const p = planAdvance(J, "b", { score: 80 }, NOW);
    expect(p.effects).toEqual([
      {
        type: "action",
        nodeId: "mv",
        action: "moveStage",
        params: { type: "moveStage", stageId: "won" },
      },
    ]);
    expect(p.done).toBe(true);
  });

  it("branch NO (score bajo) → exit sin efectos", () => {
    const p = planAdvance(J, "b", { score: 20 }, NOW);
    expect(p.effects).toEqual([]);
    expect(p.done).toBe(true);
  });

  it("wait condicional: no cumplido → descansa en el wait y reintenta en ~5min", () => {
    const jc: JourneyDef = {
      ...J,
      nodes: [
        {
          id: "w",
          kind: "wait",
          params: { untilRule: [{ field: "grade", op: "eq", value: "A" }] },
        },
        { id: "x", kind: "exit" },
      ],
      edges: [{ from: "w", to: "x" }],
    };
    const notMet = planAdvance(jc, "w", { grade: "C" }, NOW);
    expect(notMet.nextNodeId).toBe("w");
    expect(notMet.done).toBe(false);
    expect(Date.parse(notMet.nextRunAt)).toBe(NOW + 5 * 60_000);
    const met = planAdvance(jc, "w", { grade: "A" }, NOW);
    expect(met.done).toBe(true); // cumplido → sigue al exit
  });

  it("split A/B: el percent decide la rama y es estable por lead", () => {
    const mk = (percent: number): JourneyDef => ({
      journeyId: "js",
      name: "AB",
      status: "active",
      nodes: [
        { id: "sp", kind: "split", params: { percent } },
        { id: "sa", kind: "send", params: { channel: "whatsapp", templateName: "a" } },
        { id: "sb", kind: "send", params: { channel: "whatsapp", templateName: "b" } },
        { id: "x", kind: "exit" },
      ],
      edges: [
        { from: "sp", to: "sa", on: "a" },
        { from: "sp", to: "sb", on: "b" },
        { from: "sa", to: "x" },
        { from: "sb", to: "x" },
      ],
    });
    // percent=100 → siempre rama A; percent=0 → siempre rama B.
    expect(planAdvance(mk(100), "sp", { leadId: "L1" }, NOW).effects[0]?.params.templateName).toBe(
      "a",
    );
    expect(planAdvance(mk(0), "sp", { leadId: "L1" }, NOW).effects[0]?.params.templateName).toBe(
      "b",
    );
    // Mismo lead → misma rama en dos evaluaciones (determinístico).
    const a1 = planAdvance(mk(50), "sp", { leadId: "stable" }, NOW).effects[0]?.params.templateName;
    const a2 = planAdvance(mk(50), "sp", { leadId: "stable" }, NOW).effects[0]?.params.templateName;
    expect(a1).toBe(a2);
  });
});

// ── Fase 2: bloques nuevos (canales separados, acciones CRM, goal/leave, hasta-fecha) ──
describe("planAdvance · bloques Fase 2", () => {
  it("send_whatsapp / send_email emiten un efecto send con el canal correcto", () => {
    const j: JourneyDef = {
      journeyId: "j2",
      name: "F2",
      status: "active",
      nodes: [
        { id: "wa", kind: "send_whatsapp", params: { templateName: "hola" } },
        { id: "em", kind: "send_email", params: { subject: "Hey" } },
        { id: "x", kind: "exit" },
      ],
      edges: [
        { from: "wa", to: "em" },
        { from: "em", to: "x" },
      ],
    };
    const p = planAdvance(j, "wa", {}, NOW);
    expect(p.effects.map((e) => (e as { channel?: string }).channel)).toEqual([
      "whatsapp",
      "email",
    ]);
    expect(p.effects.every((e) => e.type === "send")).toBe(true);
    expect(p.done).toBe(true);
  });

  it("los bloques de acción mapean a su action del runner (tag→tag, move_stage→moveStage)", () => {
    const j: JourneyDef = {
      journeyId: "j3",
      name: "F2",
      status: "active",
      nodes: [
        { id: "t", kind: "tag", params: { op: "add", tag: "vip" } },
        { id: "m", kind: "move_stage", params: { stageId: "won" } },
        { id: "x", kind: "exit" },
      ],
      edges: [
        { from: "t", to: "m" },
        { from: "m", to: "x" },
      ],
    };
    const p = planAdvance(j, "t", {}, NOW);
    expect(p.effects.map((e) => (e as { action?: string }).action)).toEqual(["tag", "moveStage"]);
    expect(p.done).toBe(true);
  });

  it('goal emite un efecto "goal" y TERMINA (conversión)', () => {
    const j: JourneyDef = {
      journeyId: "j4",
      name: "F2",
      status: "active",
      nodes: [{ id: "g", kind: "goal" }],
      edges: [],
    };
    const p = planAdvance(j, "g", {}, NOW);
    expect(p.effects).toEqual([{ type: "action", nodeId: "g", action: "goal", params: {} }]);
    expect(p.done).toBe(true);
  });

  it("leave: si cumple sale (done sin efectos); si no, continúa al sucesor", () => {
    const j: JourneyDef = {
      journeyId: "j5",
      name: "F2",
      status: "active",
      nodes: [
        {
          id: "lv",
          kind: "leave",
          params: { rules: [{ field: "grade", op: "eq", value: "F" }], match: "all" },
        },
        { id: "s", kind: "send", params: { channel: "whatsapp", templateName: "sigue" } },
        { id: "x", kind: "exit" },
      ],
      edges: [
        { from: "lv", to: "s" },
        { from: "s", to: "x" },
      ],
    };
    const salio = planAdvance(j, "lv", { grade: "F" }, NOW);
    expect(salio.effects).toEqual([]);
    expect(salio.done).toBe(true);
    const siguio = planAdvance(j, "lv", { grade: "A" }, NOW);
    expect(siguio.effects.map((e) => e.type)).toEqual(["send"]);
  });

  it('wait "hasta fecha": descansa en el sucesor hasta esa fecha; si ya pasó, sigue', () => {
    const future = new Date(NOW + 3 * 86_400_000).toISOString();
    const base: JourneyDef = {
      journeyId: "j6",
      name: "F2",
      status: "active",
      nodes: [
        { id: "w", kind: "wait", params: { untilDate: future } },
        { id: "s", kind: "send", params: { channel: "whatsapp", templateName: "ping" } },
        { id: "x", kind: "exit" },
      ],
      edges: [
        { from: "w", to: "s" },
        { from: "s", to: "x" },
      ],
    };
    const espera = planAdvance(base, "w", {}, NOW);
    expect(espera.nextNodeId).toBe("s");
    expect(espera.done).toBe(false);
    expect(Date.parse(espera.nextRunAt)).toBe(Date.parse(future));
    // Fecha ya vencida → sigue de una y ejecuta el send.
    const past: JourneyDef = {
      ...base,
      nodes: [
        { id: "w", kind: "wait", params: { untilDate: new Date(NOW - 1000).toISOString() } },
        ...base.nodes.slice(1),
      ],
    };
    expect(planAdvance(past, "w", {}, NOW).effects.map((e) => e.type)).toEqual(["send"]);
  });
});

// ── Fase 3: +10 módulos (acciones, switch, esperas por horario/día, esperar respuesta) ──
describe("planAdvance · +10 módulos", () => {
  const mkJ = (nodes: JourneyDef["nodes"], edges: JourneyDef["edges"]): JourneyDef => ({
    journeyId: "jx",
    name: "F3",
    status: "active",
    nodes,
    edges,
  });

  it("score/note → efecto action con su nombre (ACTION_OF)", () => {
    const j = mkJ(
      [
        { id: "s", kind: "score", params: { delta: 15 } },
        { id: "n", kind: "note", params: { text: "hola" } },
        { id: "x", kind: "exit" },
      ],
      [
        { from: "s", to: "n" },
        { from: "n", to: "x" },
      ],
    );
    const p = planAdvance(j, "s", {}, NOW);
    expect(p.effects.map((e) => (e as { action?: string }).action)).toEqual([
      "scoreAdjust",
      "note",
    ]);
    expect(p.done).toBe(true);
  });

  it("switch: toma el caso cuyo value iguala el campo; si no, «default»", () => {
    const j = mkJ(
      [
        {
          id: "sw",
          kind: "switch",
          params: {
            field: "grade",
            cases: [
              { id: "c0", value: "A" },
              { id: "c1", value: "B" },
            ],
          },
        },
        { id: "a", kind: "exit" },
        { id: "b", kind: "exit" },
        { id: "d", kind: "exit" },
      ],
      [
        { from: "sw", to: "a", on: "c0" },
        { from: "sw", to: "b", on: "c1" },
        { from: "sw", to: "d", on: "default" },
      ],
    );
    expect(planAdvance(j, "sw", { grade: "B" }, NOW).nextNodeId).toBe("b");
    expect(planAdvance(j, "sw", { grade: "Z" }, NOW).nextNodeId).toBe("d");
  });

  it("wait_business: fuera de franja descansa; dentro sigue", () => {
    const j = mkJ(
      [
        { id: "w", kind: "wait_business", params: { start: 9, end: 18 } },
        { id: "x", kind: "exit" },
      ],
      [{ from: "w", to: "x" }],
    );
    // NOW = 12:00Z → local Perú 07:00 (UTC-5) → FUERA de 9–18 → descansa en el sucesor.
    const out = planAdvance(j, "w", {}, NOW);
    expect(out.done).toBe(false);
    expect(out.nextNodeId).toBe("x");
    // 18:00Z → local 13:00 → dentro → sigue hasta el Fin.
    expect(planAdvance(j, "w", {}, Date.parse("2026-07-01T18:00:00Z")).done).toBe(true);
  });

  it("wait_event: si el lead ya cumple → «met»; si no, descansa re-chequeando", () => {
    const j = mkJ(
      [
        {
          id: "we",
          kind: "wait_event",
          params: { rules: [{ field: "replied", op: "eq", value: "yes" }], match: "all", days: 3 },
        },
        { id: "m", kind: "exit" },
        { id: "t", kind: "exit" },
      ],
      [
        { from: "we", to: "m", on: "met" },
        { from: "we", to: "t", on: "timeout" },
      ],
    );
    expect(planAdvance(j, "we", { replied: "yes" }, NOW).nextNodeId).toBe("m");
    const wait = planAdvance(j, "we", { replied: "no" }, NOW);
    expect(wait.nextNodeId).toBe("we");
    expect(wait.done).toBe(false);
  });
});
