import { describe, it, expect } from "vitest";
import { planLeadStamp } from "../../amplify/functions/_shared/leadStamp";

/**
 * Red de seguridad para `_shared/leadStamp.ts` — la decisión PURA del estampado
 * del agente de Connect sobre el lead (alimenta el fallback `l.assignedAgent` del
 * tab Pipeline de /reports). La escritura a DynamoDB vive en
 * process-contact-event; acá solo se prueba "¿aplica? ¿con qué claves busco?".
 */
describe("planLeadStamp", () => {
  it("null si no hay agente (llamada perdida/abandonada → nadie atendió)", () => {
    expect(planLeadStamp({ phone: "+51999888777", agentUsername: "" })).toBeNull();
    expect(planLeadStamp({ phone: "+51999888777", agentUsername: "   " })).toBeNull();
    expect(planLeadStamp({ phone: "+51999888777", agentUsername: null })).toBeNull();
    expect(planLeadStamp({ phone: "+51999888777" })).toBeNull();
  });

  it("null si el endpoint no es un teléfono real (CHAT/EMAIL → restringe a voz)", () => {
    expect(planLeadStamp({ phone: "cliente@correo.com", agentUsername: "carloscl" })).toBeNull();
    expect(planLeadStamp({ phone: "", agentUsername: "carloscl" })).toBeNull();
    expect(planLeadStamp({ phone: "12345", agentUsername: "carloscl" })).toBeNull(); // < 7 dígitos
    expect(planLeadStamp({ phone: null, agentUsername: "carloscl" })).toBeNull();
  });

  it("E.164: candidatos = [e164, dígitos] para tolerar '+51999…' vs '51999…'", () => {
    const plan = planLeadStamp({ phone: "+51999888777", agentUsername: "Andre-Alata" });
    expect(plan).not.toBeNull();
    expect(plan!.agent).toBe("Andre-Alata");
    expect(plan!.phoneCandidates).toEqual(["+51999888777", "51999888777"]);
  });

  it("recorta espacios del username del agente", () => {
    const plan = planLeadStamp({ phone: "+51999888777", agentUsername: "  gisela.vega  " });
    expect(plan!.agent).toBe("gisela.vega");
  });

  it("teléfono con formato (guiones/paréntesis) normaliza a un único par de claves", () => {
    const plan = planLeadStamp({ phone: "(01) 999-888-777", agentUsername: "carloscl" });
    expect(plan!.phoneCandidates).toEqual(["01999888777"]); // sin '+' → una sola clave (dígitos)
  });
});
