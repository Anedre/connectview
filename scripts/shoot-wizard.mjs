#!/usr/bin/env node
/**
 * shoot-wizard.mjs — captura el paso a paso del ConnectSetupWizard para el
 * manual de usuario. Requiere el dev server corriendo (vite, /wizard-demo) y
 * Chrome instalado. Usa puppeteer-core con el Chrome del sistema (sin descargar
 * Chromium).
 *
 *   node scripts/shoot-wizard.mjs
 *
 * Salida: docs/tecnico/img/wizard-N-*.png (retina, tema oscuro).
 */
import puppeteer from "puppeteer-core";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTDIR = join(ROOT, "docs", "tecnico", "img");
mkdirSync(OUTDIR, { recursive: true });

const CHROMES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
const CHROME = CHROMES.find((p) => existsSync(p));
if (!CHROME) throw new Error("No encontré Chrome/Edge. Definí CHROME_PATH.");

const PORT = process.env.PORT || "5173";
const URL = `http://localhost:${PORT}/wizard-demo`;

const STEPS = [
  "wizard-1-intro",
  "wizard-2-instancia",
  "wizard-3-origenes",
  "wizard-4-rol",
  "wizard-5-datos",
  "wizard-6-listo",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1320, height: 940, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  // Forzar MODO CLARO antes de que cargue la app (ThemeProvider lee localStorage "vox-theme").
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("vox-theme", "light"); } catch (e) { /* noop */ }
  });
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => {
    try { localStorage.setItem("vox-theme", "light"); } catch (e) { /* noop */ }
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "light";
  });
  await sleep(1400);

  for (let i = 0; i < STEPS.length; i++) {
    await sleep(500);
    const out = join(OUTDIR, STEPS[i] + ".png");
    await page.screenshot({ path: out });
    console.log("📸", STEPS[i] + ".png");
    if (i < STEPS.length - 1) {
      const clicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) =>
          /Siguiente/i.test(x.textContent || "")
        );
        if (b && !b.disabled) { b.click(); return true; }
        return false;
      });
      if (!clicked) console.warn("⚠️  no pude avanzar desde el paso", i + 1);
      await sleep(800);
    }
  }
  console.log("✅ Capturas en", OUTDIR);
} finally {
  await browser.close();
}
