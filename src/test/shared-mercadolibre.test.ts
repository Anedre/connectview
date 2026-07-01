import { describe, it, expect } from "vitest";
import { parseNotification, resourceKind } from "../../amplify/functions/_shared/mercadolibre";

/**
 * Red de seguridad para la INGESTA del canal Mercado Libre (F4.1). El parseo de
 * la notificación y del `resource` es puro → estos tests fijan cómo se enruta un
 * webhook de ML sin tocar AWS ni la API de ML.
 */

describe("mercadolibre · parseNotification", () => {
  it("normaliza una notificación válida (topic + resource + user_id)", () => {
    const n = parseNotification({
      resource: "/questions/5036111111",
      user_id: 123456789,
      topic: "questions",
      application_id: 999,
      attempts: 1,
    });
    expect(n).toEqual({
      topic: "questions",
      resource: "/questions/5036111111",
      userId: "123456789",
    });
  });

  it("acepta user_id numérico o string y lo devuelve como string", () => {
    expect(parseNotification({ resource: "/x", topic: "messages", user_id: 42 })?.userId).toBe(
      "42",
    );
    expect(parseNotification({ resource: "/x", topic: "messages", user_id: "42" })?.userId).toBe(
      "42",
    );
  });

  it("rechaza cuerpos sin resource o sin topic", () => {
    expect(parseNotification({ topic: "questions" })).toBeNull();
    expect(parseNotification({ resource: "/questions/1" })).toBeNull();
    expect(parseNotification(null)).toBeNull();
    expect(parseNotification("nope")).toBeNull();
  });
});

describe("mercadolibre · resourceKind", () => {
  it("una pregunta → { kind:question, questionId }", () => {
    expect(resourceKind("/questions/5036111111")).toEqual({
      kind: "question",
      questionId: "5036111111",
    });
  });

  it("un mensaje post-venta → { kind:message, packId, sellerId }", () => {
    expect(resourceKind("/messages/packs/2000003456789/sellers/123456789")).toEqual({
      kind: "message",
      packId: "2000003456789",
      sellerId: "123456789",
    });
  });

  it("ignora query params en el resource de mensajes", () => {
    const r = resourceKind("/messages/packs/PACK1/sellers/SELLER1?mark_as_read=false");
    expect(r).toEqual({ kind: "message", packId: "PACK1", sellerId: "SELLER1" });
  });

  it("devuelve null para un resource no soportado", () => {
    expect(resourceKind("/orders/123")).toBeNull();
    expect(resourceKind("/items/MLA123")).toBeNull();
    expect(resourceKind("")).toBeNull();
  });
});
