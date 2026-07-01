import { describe, it, expect } from "vitest";
import { buildTrackedHtml } from "../../amplify/functions/_shared/emailTracking";

/**
 * Red de seguridad para la parte PURA del tracking de email (F4.4): inyección del
 * pixel + reescritura de links. Sin AWS.
 */
const BASE = "https://track.example.com";

describe("buildTrackedHtml", () => {
  it("inyecta el pixel antes de </body>", () => {
    const out = buildTrackedHtml("<html><body><p>hola</p></body></html>", {
      token: "abc123",
      base: BASE,
    });
    expect(out).toContain(`${BASE}/pixel?t=abc123`);
    expect(out).toMatch(/<img[^>]+pixel\?t=abc123[^>]*><\/body>/);
  });

  it("envuelve los links http(s) preservando el destino en ?u=", () => {
    const out = buildTrackedHtml('<a href="https://udep.edu.pe/admision">Ver</a>', {
      token: "tok",
      base: BASE,
    });
    expect(out).toContain(
      `${BASE}/click?t=tok&u=${encodeURIComponent("https://udep.edu.pe/admision")}`,
    );
    expect(out).not.toContain('href="https://udep.edu.pe/admision"');
  });

  it("no toca links no-http (mailto:, #, etc.)", () => {
    const out = buildTrackedHtml('<a href="mailto:x@y.com">mail</a>', { token: "t", base: BASE });
    expect(out).toContain('href="mailto:x@y.com"');
  });

  it("sin base → devuelve el HTML intacto (no trackea)", () => {
    const html = '<a href="https://x.com">x</a>';
    expect(buildTrackedHtml(html, { token: "t", base: "" })).toBe(html);
  });

  it("agrega el pixel al final si no hay </body>", () => {
    const out = buildTrackedHtml("<p>sin body</p>", { token: "t", base: BASE });
    expect(out).toMatch(/<p>sin body<\/p><img[^>]+pixel\?t=t/);
  });
});
