import { describe, it, expect } from "vitest";
import { parseCsvText, normalizePhone } from "../lib/csvParser";

/**
 * Red de seguridad para el import de CSV de campañas (CampaignCreatePage).
 * Cubre dos bugs reportados:
 *  1. La columna auto-detectada como nombre (p.ej. "nombre") se consume en
 *     `nameColumn` y NO queda en `attributes` — pero SÍ en `originalRow`. El
 *     desplegable "Nombre desde columna" debe leer de `originalRow` para poder
 *     ofrecerla (antes leía de `attributes` y la escondía).
 *  2. `normalizePhone` (reusada al editar el teléfono en la tabla) lleva a E.164
 *     lo que el usuario escriba, para que el backend no lo descarte en silencio.
 */
describe("parseCsvText — columnas y detección", () => {
  it("consume 'nombre' como nombre pero la conserva en originalRow", async () => {
    const csv = "telefono,nombre,programa\n+51987654321,Juan Perez,Ingenieria";
    const res = await parseCsvText(csv, "PE");

    expect(res.detected.phoneColumn).toBe("telefono");
    // "nombre" cae en FIRST_NAME_KEYWORDS → se detecta como firstNameColumn (por
    // eso queda fuera de attributes; el fix lee de originalRow que la conserva).
    expect(res.detected.firstNameColumn).toBe("nombre");
    expect(res.contacts).toHaveLength(1);

    const c = res.contacts[0];
    expect(c.customerName).toBe("Juan Perez");
    // BUG 1: "nombre" (y "telefono") NO están en attributes…
    expect(Object.keys(c.attributes)).toEqual(["programa"]);
    expect(c.attributes.nombre).toBeUndefined();
    // …pero SÍ en originalRow → de ahí sale la lista completa del desplegable.
    expect(Object.keys(c.originalRow).sort()).toEqual(["nombre", "programa", "telefono"]);
    expect(c.originalRow.nombre).toBe("Juan Perez");
  });

  it("normaliza el teléfono del CSV a E.164", async () => {
    const csv = "telefono,nombre\n987 654 321,Ana";
    const res = await parseCsvText(csv, "PE");
    expect(res.contacts[0]?.phone).toBe("+51987654321");
  });
});

describe("normalizePhone — edición inline del teléfono (BUG 2)", () => {
  it("agrega el código de país a un móvil peruano de 9 dígitos", () => {
    expect(normalizePhone("987654321", "PE")).toBe("+51987654321");
  });

  it("limpia espacios y guiones de un número ya con prefijo", () => {
    expect(normalizePhone("+51 987 654 321", "PE")).toBe("+51987654321");
    expect(normalizePhone("+51-987-654-321", "PE")).toBe("+51987654321");
  });

  it("devuelve null para basura no normalizable", () => {
    expect(normalizePhone("", "PE")).toBeNull();
    expect(normalizePhone("abc", "PE")).toBeNull();
  });
});
