import { describe, it, expect } from "vitest";
import { invalidFieldName } from "../../amplify/functions/_shared/leadSync";

/**
 * F5.1 — parser del campo inválido en el error de Salesforce. Es lo que decide
 * QUÉ campo `Vox*__c` descartar cuando la org del cliente aún no lo creó (para
 * degradar con gracia el rollup R4 sin romper el sync). Puro → sin AWS/SF.
 */
describe("invalidFieldName (SF error → campo a descartar)", () => {
  it("extrae el campo de 'No such column'", () => {
    expect(invalidFieldName(new Error("No such column 'VoxTouches__c' on entity 'Lead'."))).toBe(
      "VoxTouches__c",
    );
  });

  it("extrae el campo del formato INVALID_FIELD", () => {
    expect(
      invalidFieldName("INVALID_FIELD: No such column 'VoxDaysToClose__c' on entity 'Lead'"),
    ).toBe("VoxDaysToClose__c");
  });

  it("reconoce el campo aunque el mensaje solo lo mencione", () => {
    expect(invalidFieldName(new Error("Field VoxLastTouch__c is not writeable"))).toBe(
      "VoxLastTouch__c",
    );
    expect(invalidFieldName(new Error("VoxLeadId__c no existe"))).toBe("VoxLeadId__c");
  });

  it("devuelve null si el error no es de un campo conocido", () => {
    expect(invalidFieldName(new Error("REQUIRED_FIELD_MISSING: [LastName]"))).toBeNull();
    expect(invalidFieldName(new Error("algo raro"))).toBeNull();
  });
});
