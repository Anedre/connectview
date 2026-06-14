#!/usr/bin/env node
/**
 * shoot-app.mjs — captura pantallas de la app (localhost:5173) a archivos PNG,
 * para el manual de usuario. Dos modos:
 *
 *   node scripts/shoot-app.mjs registro
 *     → captura login + "Crear cuenta" (público, sin sesión).
 *
 *   node scripts/shoot-app.mjs logged
 *     → lee la sesión de infra/_session.json (localStorage del usuario logueado,
 *       extraído de su navegador), la inyecta y captura las pantallas internas.
 *
 * Requiere el dev server corriendo + Chrome del sistema.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "manual", "img");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.APP_URL || "http://localhost:5173";
const mode = process.argv[2] || "registro";

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) throw new Error("No encontré Chrome/Edge. Definí CHROME_PATH.");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--force-color-profile=srgb", "--window-size=1440,900"],
});
async function shot(page, name) {
  await page.screenshot({ path: join(OUT, name + ".png") });
  console.log("📸", name + ".png");
}
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  // MODO CLARO para las capturas: fijamos vox-theme=light antes de cargar la app.
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("vox-theme", "light"); } catch (e) { /* noop */ }
  });

  if (mode === "registro") {
    await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(1500);
    await shot(page, "registro-1-login");
    // click la pestaña "Crear cuenta"
    const ok = await page.evaluate(() => {
      const el = [...document.querySelectorAll("button,[role='tab'],a,div")]
        .find((e) => e.textContent && e.textContent.trim() === "Crear cuenta");
      if (el) { el.click(); return true; }
      return false;
    });
    if (!ok) console.warn("⚠️ no encontré la pestaña 'Crear cuenta'");
    await sleep(900);
    await shot(page, "registro-2-crear-cuenta");
  } else if (mode === "logged") {
    const session = JSON.parse(readFileSync(join(ROOT, "infra", "_session.json"), "utf8"));
    // 1) abrir la app para fijar el origen, 2) inyectar localStorage, 3) recargar
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((s) => {
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, session);
    const ROUTES = [
      ["/", "app-1-inicio"],
      ["/agent", "app-2-workspace"],
      ["/campaigns", "app-3-campanas"],
      ["/leads", "app-4-leads"],
      ["/queue", "app-5-monitoreo"],
      ["/reports", "app-6-reportes"],
      ["/admin", "app-7-admin"],
    ];
    for (const [route, name] of ROUTES) {
      await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
      await sleep(2500);
      await shot(page, name);
    }
    // Integraciones (sub-pestaña de Configuración) — para el doc de instalación.
    await page.goto(BASE + "/admin", { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await sleep(2000);
    await page.evaluate(() => {
      const els = [...document.querySelectorAll("button,a,div,li,span")]
        .filter((e) => e.textContent && e.textContent.trim() === "Integraciones" && e.offsetParent !== null);
      const t = els[els.length - 1] || els[0];
      if (t) t.click();
    });
    await sleep(2800);
    await shot(page, "app-8-integraciones");
  } else if (mode === "intdetalle") {
    // Detalle de Salesforce y WhatsApp (tocando "Configurar" en cada tarjeta).
    const session = JSON.parse(readFileSync(join(ROOT, "infra", "_session.json"), "utf8"));
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, session);
    const openInt = async () => {
      await page.goto(BASE + "/admin", { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
      await sleep(2000);
      await page.evaluate(() => {
        const els = [...document.querySelectorAll("button,a,div,li,span")]
          .filter((e) => e.textContent && e.textContent.trim() === "Integraciones" && e.offsetParent !== null);
        (els[els.length - 1] || els[0])?.click();
      });
      await sleep(2200);
    };
    // Busca el botón "Configurar" en la MISMA FILA (≈mismo Y) que el título de la
    // tarjeta, en el área principal (x>250, no el sidebar). Evita subir por el DOM
    // a un contenedor que englobe las 3 tarjetas.
    const clickConfig = (name) => page.evaluate((name) => {
      const titles = [...document.querySelectorAll("*")].filter((e) => {
        if (!e.offsetParent || (e.children && e.children.length > 1)) return false;
        const r = e.getBoundingClientRect();
        return r.left > 250 && e.textContent && e.textContent.trim() === name;
      });
      if (!titles.length) return "no-title";
      const ty = titles[0].getBoundingClientRect().top;
      const btns = [...document.querySelectorAll("button")].filter((b) => /Configurar/i.test(b.textContent || "") && b.offsetParent);
      let best = null, bd = 1e9;
      for (const b of btns) { const d = Math.abs(b.getBoundingClientRect().top - ty); if (d < bd) { bd = d; best = b; } }
      if (best && bd < 70) { best.click(); return "ok"; }
      return "no-btn";
    }, name);
    const scrollTo = (name) => page.evaluate((name) => {
      const t = [...document.querySelectorAll("*")].find((e) => e.offsetParent && e.getBoundingClientRect().left > 250 && e.textContent?.trim() === name);
      if (t) t.scrollIntoView({ block: "start" });
    }, name);
    for (const [name, file] of [["Salesforce", "app-9-salesforce"], ["WhatsApp", "app-10-whatsapp"]]) {
      await openInt();
      const r = await clickConfig(name);
      console.log("  ", name, "→", r);
      await sleep(1600);
      await scrollTo(name);
      await sleep(900);
      await shot(page, file);
    }
  }
  console.log("✅ listo:", OUT);
} finally {
  await browser.close();
}
