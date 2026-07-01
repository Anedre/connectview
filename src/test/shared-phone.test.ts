import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  samePhone,
  sfPhoneCandidates,
} from "../../amplify/functions/_shared/phone";

/**
 * Red de seguridad para `_shared/phone.ts` — la normalización canónica de la que
 * depende TODO el dedup/matching (leads, supresión, Salesforce, inbox). Es una
 * función pura sin AWS, así que se testea directo desde el frontend (vitest solo
 * escanea src/, pero puede importar el módulo de amplify/). Fase 1 · F1.8.
 */
describe("normalizePhone", () => {
  it("devuelve null para vacío/corto", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone("12345")).toBeNull(); // < 7 dígitos
  });

  it("preserva el '+' (E.164) y saca solo dígitos", () => {
    expect(normalizePhone("+51999888777")).toEqual({
      e164: "+51999888777",
      digits: "51999888777",
    });
  });

  it("sin '+' devuelve dígitos como e164 (no inventa código de país)", () => {
    expect(normalizePhone("999 888 777")).toEqual({ e164: "999888777", digits: "999888777" });
  });

  it("convierte prefijo internacional '00' → '+'", () => {
    expect(normalizePhone("0051999888777")).toEqual({
      e164: "+51999888777",
      digits: "51999888777",
    });
  });

  it("limpia puntuación (paréntesis, guiones, espacios)", () => {
    expect(normalizePhone("(01) 234-5678")).toEqual({ e164: "012345678", digits: "012345678" });
  });
});

describe("samePhone", () => {
  it("iguala con y sin código de país", () => {
    expect(samePhone("+51999888777", "999888777")).toBe(true);
    expect(samePhone("+51999888777", "51999888777")).toBe(true);
  });

  it("iguala idénticos", () => {
    expect(samePhone("999888777", "999888777")).toBe(true);
  });

  it("NO iguala abonados distintos", () => {
    expect(samePhone("999888777", "888777666")).toBe(false);
  });

  it("NO iguala si el 'corto' tiene < 8 dígitos (evita falsos positivos)", () => {
    expect(samePhone("1234567", "511234567")).toBe(false);
  });

  it("es falso ante nulos", () => {
    expect(samePhone(null, "999888777")).toBe(false);
    expect(samePhone("999888777", undefined)).toBe(false);
  });
});

describe("sfPhoneCandidates", () => {
  it("devuelve E.164 + dígitos pelados (dedup por Set)", () => {
    expect(sfPhoneCandidates("+51999888777")).toEqual(["+51999888777", "51999888777"]);
  });

  it("sin '+' devuelve un solo candidato", () => {
    expect(sfPhoneCandidates("999888777")).toEqual(["999888777"]);
  });

  it("vacío → []", () => {
    expect(sfPhoneCandidates(null)).toEqual([]);
    expect(sfPhoneCandidates("123")).toEqual([]);
  });
});
