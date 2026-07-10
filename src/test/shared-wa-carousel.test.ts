import { describe, it, expect } from "vitest";
import { buildTemplateComponents } from "../../amplify/functions/_shared/waTemplateComponents";

/**
 * Red de seguridad para el builder de plantillas CAROUSEL de WhatsApp (Fase 4 ·
 * F4.2b). Verifica la estructura exacta que exige Meta Cloud API. Pura → sin AWS.
 */
function carousel() {
  return buildTemplateComponents({
    category: "MARKETING",
    bodyText: "Conoce nuestros programas 👇",
    // un carousel NO debe llevar header raíz aunque se lo pasen:
    headerText: "IGNORAME",
    cards: [
      {
        headerHandle: "handle_1",
        headerFormat: "IMAGE",
        bodyText: "Diplomado en Educación",
        buttons: [{ type: "QUICK_REPLY", text: "Me interesa" }],
      },
      {
        headerHandle: "handle_2",
        headerFormat: "IMAGE",
        bodyText: "Maestría en Gestión",
        buttons: [{ type: "URL", text: "Ver", url: "https://udep.edu.pe" }],
      },
    ],
  });
}

describe("buildTemplateComponents · carousel", () => {
  it("arma BODY raíz + componente CAROUSEL con las tarjetas, sin header raíz", () => {
    const r = carousel();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const types = r.components.map((c) => c.type);
    expect(types).toContain("BODY"); // texto de la burbuja
    expect(types).toContain("CAROUSEL");
    expect(types).not.toContain("HEADER"); // los headers van por-tarjeta
    const car = r.components.find((c) => c.type === "CAROUSEL");
    expect(car.cards).toHaveLength(2);
    // cada tarjeta = { components: [HEADER(IMAGE), BODY, BUTTONS] }
    const card0 = car.cards[0].components.map((c: { type: string }) => c.type);
    expect(card0).toEqual(["HEADER", "BODY", "BUTTONS"]);
    expect(car.cards[0].components[0]).toMatchObject({
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: ["handle_1"] },
    });
    expect(car.cards[1].components[2].buttons[0]).toMatchObject({
      type: "URL",
      url: "https://udep.edu.pe",
    });
  });

  it("rechaza un carousel con menos de 2 tarjetas", () => {
    const r = buildTemplateComponents({
      category: "MARKETING",
      bodyText: "x",
      cards: [{ bodyText: "sola", headerHandle: "h" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza una tarjeta sin body", () => {
    const r = buildTemplateComponents({
      category: "MARKETING",
      bodyText: "x",
      cards: [{ bodyText: "ok", headerHandle: "h" }, { headerHandle: "h2" }],
    });
    expect(r.ok).toBe(false);
  });
});
