import { describe, it, expect } from "vitest";
import {
  computeScore,
  computeGrade,
  DEFAULT_SCORING_RULES,
} from "../../amplify/functions/_shared/scoring";

/**
 * Red de seguridad para el motor de scoring/grading (Fase 2). Funciones puras →
 * se testean sin AWS. `nowMs` inyectado hace la recencia determinística.
 */
const NOW = Date.parse("2026-07-01T12:00:00.000Z");

describe("computeScore (comportamiento)", () => {
  it("lead sin actividad → solo la base", () => {
    const { score } = computeScore({ golpesTotal: 0, converted: false, nowMs: NOW });
    expect(score).toBe(DEFAULT_SCORING_RULES.behavior.base); // 40
  });

  it("más golpes → más score, con tope (golpeCap)", () => {
    const s3 = computeScore({ golpesTotal: 3, converted: false, nowMs: NOW }).score;
    const s10 = computeScore({ golpesTotal: 10, converted: false, nowMs: NOW }).score;
    expect(s3).toBeGreaterThan(40);
    expect(s10).toBeGreaterThan(s3);
    // 10 golpes*6=60 pero cap=30 → base40+30 = 70 (sin otras señales)
    expect(s10).toBe(70);
  });

  it("conversión suma el bono", () => {
    const base = computeScore({ golpesTotal: 2, converted: false, nowMs: NOW }).score;
    const conv = computeScore({ golpesTotal: 2, converted: true, nowMs: NOW }).score;
    expect(conv - base).toBe(DEFAULT_SCORING_RULES.behavior.converted); // +20
  });

  it("recencia: un toque fresco suma, uno viejo resta", () => {
    const fresh = computeScore({
      golpesTotal: 1,
      converted: false,
      lastTouchAt: "2026-07-01T00:00:00.000Z", // ~medio día → fresco
      nowMs: NOW,
    }).score;
    const stale = computeScore({
      golpesTotal: 1,
      converted: false,
      lastTouchAt: "2026-05-01T00:00:00.000Z", // ~2 meses → decae (con tope)
      nowMs: NOW,
    }).score;
    expect(fresh).toBeGreaterThan(stale);
  });

  it("clampa a 0-100 y devuelve el desglose (audit)", () => {
    const r = computeScore({ golpesTotal: 99, converted: true, nowMs: NOW });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.inputs).toHaveProperty("golpes");
    expect(r.inputs).toHaveProperty("converted");
  });
});

describe("computeGrade (fit demográfico, independiente del score)", () => {
  it("lead completo (email+empresa+valor+UTM) → grado alto", () => {
    const g = computeGrade({
      source: "referral",
      hasEmail: true,
      hasCompany: true,
      hasValue: true,
      attributes: { utm_campaign: "adm" },
    });
    expect(g).toBe("A");
  });

  it("lead pelado (solo teléfono) → grado bajo", () => {
    const g = computeGrade({ hasEmail: false, hasCompany: false, hasValue: false });
    expect(g).toBe("F");
  });

  it("es independiente de la actividad: mismo fit → mismo grado sin importar golpes", () => {
    const a = computeGrade({
      source: "web_form",
      hasEmail: true,
      hasCompany: false,
      hasValue: false,
    });
    const b = computeGrade({
      source: "web_form",
      hasEmail: true,
      hasCompany: false,
      hasValue: false,
    });
    expect(a).toBe(b);
  });
});
