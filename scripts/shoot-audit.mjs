#!/usr/bin/env node
/**
 * shoot-audit.mjs — auditoría visual: captura cada ruta de la app en modo
 * CLARO y OSCURO, e informa errores de consola (Fase 3 + 4 juntas).
 * Requiere: dev server en :5173 + infra/_session.json (sesión logueada).
 *
 *   node scripts/shoot-audit.mjs
 *
 * Salidas → docs/_audit/<ruta>-<tema>.png  + lista de errores de consola.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "_audit");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.APP_URL || "http://localhost:5173";

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) throw new Error("No encontré Chrome/Edge. Definí CHROME_PATH.");

const sessionPath = join(ROOT, "infra", "_session.json");
const session = existsSync(sessionPath)
  ? JSON.parse(readFileSync(sessionPath, "utf8"))
  : null;
if (!session) console.warn("⚠️  sin infra/_session.json — solo rutas públicas tendrán contenido.");

const ROUTES = [
  ["/", "inicio"],
  ["/agent", "workspace"],
  ["/campaigns", "campanas"],
  ["/leads", "leads"],
  ["/queue", "monitoreo"],
  ["/reports", "reportes"],
  ["/admin", "admin"],
  ["/appointments", "citas"],
  ["/recordings", "grabaciones"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--force-color-profile=srgb", "--window-size=1440,900"],
});
const issues = [];
try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
    await page.evaluateOnNewDocument((t) => {
      try { localStorage.setItem("vox-theme", t); } catch { /* noop */ }
    }, theme);
    page.on("console", (m) => {
      if (m.type() === "error") issues.push(`[${theme}] console: ${m.text().slice(0, 180)}`);
    });
    page.on("pageerror", (e) => issues.push(`[${theme}] PAGEERROR: ${String(e).slice(0, 180)}`));

    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    if (session) {
      await page.evaluate((s) => {
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
      }, session);
    }
    for (const [route, name] of ROUTES) {
      await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
      await sleep(2200);
      await page.screenshot({ path: join(OUT, `${name}-${theme}.png`) });
      console.log("📸", `${name}-${theme}.png`);
    }
    await page.close();
  }
  console.log("\n" + "=".repeat(50));
  if (issues.length) {
    console.log(`⚠️  ${issues.length} errores de consola/página:`);
    [...new Set(issues)].forEach((e) => console.log("  • " + e));
  } else {
    console.log("✅ sin errores de consola en ninguna ruta/tema");
  }
  console.log("📁 capturas en:", OUT);
} finally {
  await browser.close();
}
