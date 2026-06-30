import { describe, it, expect } from "vitest";
import { pluralES } from "./utils";

// Primer test "smoke" para validar el arnés de Vitest contra lógica real.
describe("pluralES", () => {
  it("usa el singular cuando n === 1", () => {
    expect(pluralES(1, "agente", "agentes")).toBe("agente");
  });

  it("usa el plural para 0 y para n > 1", () => {
    expect(pluralES(0, "agente", "agentes")).toBe("agentes");
    expect(pluralES(5, "cola", "colas")).toBe("colas");
  });
});
