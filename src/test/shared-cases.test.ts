import { describe, it, expect } from "vitest";
import {
  canTransition,
  initialSla,
  advanceSla,
  DEFAULT_SLA,
  type CaseSla,
} from "../../amplify/functions/_shared/cases";

/**
 * Red de seguridad para la lógica PURA de la primitiva Case (design/case-primitiva.md):
 * la máquina de estados (`canTransition`) y el reloj SLA (`initialSla`/`advanceSla`).
 * Sin AWS — el `now` se inyecta. La escritura en DynamoDB (transitionCase/createCase)
 * queda fuera (no es lógica, es I/O).
 */
const T0 = "2026-07-01T12:00:00.000Z";
const T30 = "2026-07-01T12:30:00.000Z"; // +30 min
const MIN = 60_000;

describe("canTransition — máquina de estados", () => {
  it("permite los avances normales del flujo", () => {
    expect(canTransition("new", "open")).toBe(true);
    expect(canTransition("open", "pending")).toBe(true);
    expect(canTransition("open", "solved")).toBe(true);
    expect(canTransition("pending", "open")).toBe(true);
    expect(canTransition("on_hold", "solved")).toBe(true);
  });

  it("permite reabrir (solved/closed → open) y quedarse igual", () => {
    expect(canTransition("solved", "open")).toBe(true);
    expect(canTransition("closed", "open")).toBe(true);
    expect(canTransition("open", "open")).toBe(true);
  });

  it("bloquea transiciones fuera de la máquina", () => {
    expect(canTransition("open", "new")).toBe(false); // no se vuelve a "new"
    expect(canTransition("solved", "pending")).toBe(false); // resuelto solo → open/closed
    expect(canTransition("closed", "solved")).toBe(false); // cerrado solo → open
  });
});

describe("initialSla — vencimientos desde la política", () => {
  it("usa DEFAULT_SLA por prioridad (24/7) sobre createdAt", () => {
    const sla = initialSla("urgent", T0);
    expect(Date.parse(sla.firstResponseDueAt!)).toBe(
      Date.parse(T0) + DEFAULT_SLA.urgent.firstResponseMins * MIN,
    );
    expect(Date.parse(sla.resolutionDueAt!)).toBe(
      Date.parse(T0) + DEFAULT_SLA.urgent.resolutionMins * MIN,
    );
    expect(sla.pausedMs).toBe(0);
  });

  it("respeta el override de política del tenant", () => {
    const sla = initialSla("normal", T0, [
      { priority: "normal", firstResponseMins: 30, resolutionMins: 120 },
    ]);
    expect(Date.parse(sla.firstResponseDueAt!)).toBe(Date.parse(T0) + 30 * MIN);
    expect(Date.parse(sla.resolutionDueAt!)).toBe(Date.parse(T0) + 120 * MIN);
  });
});

describe("advanceSla — reloj de resolución (pausa/reanuda/resuelve)", () => {
  it("entrar a pending marca pausedSince", () => {
    const s = advanceSla({ pausedMs: 0 }, "open", "pending", T0);
    expect(s.pausedSince).toBe(T0);
    expect(s.pausedMs).toBe(0);
  });

  it("salir de un estado pausado acumula el tiempo en pausedMs", () => {
    const s = advanceSla({ pausedMs: 0, pausedSince: T0 }, "pending", "open", T30);
    expect(s.pausedSince).toBeUndefined();
    expect(s.pausedMs).toBe(30 * MIN);
  });

  it("pausado → pausado (pending → on_hold) mantiene el reloj pausado sin acumular", () => {
    const s = advanceSla({ pausedMs: 0, pausedSince: T0 }, "pending", "on_hold", T30);
    expect(s.pausedSince).toBe(T0); // sigue pausado desde el mismo instante
    expect(s.pausedMs).toBe(0);
  });

  it("acumula sobre lo ya pausado (varias pausas suman)", () => {
    const prev: CaseSla = { pausedMs: 10 * MIN, pausedSince: T0 };
    const s = advanceSla(prev, "on_hold", "open", T30);
    expect(s.pausedMs).toBe(40 * MIN); // 10 previos + 30 de esta pausa
  });

  it("llegar a solved/closed registra resolvedAt; no lo pisa si ya existe", () => {
    const solved = advanceSla({}, "open", "solved", T30);
    expect(solved.resolvedAt).toBe(T30);
    const closed = advanceSla({ resolvedAt: T0 }, "solved", "closed", T30);
    expect(closed.resolvedAt).toBe(T0); // conserva el instante original de resolución
  });

  it("reabrir (→ open) limpia resolvedAt para que el reloj vuelva a correr", () => {
    const s = advanceSla({ resolvedAt: T0 }, "solved", "open", T30);
    expect(s.resolvedAt).toBeUndefined();
  });
});
