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
      { type: "action", action: "moveStage", params: { type: "moveStage", stageId: "won" } },
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
});
