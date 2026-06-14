#!/usr/bin/env node
/**
 * shoot-html.mjs — renderiza un archivo HTML local a PNG (retina) con el Chrome
 * del sistema. Útil para generar gráficos de marketing/arquitectura embebibles.
 *
 *   node scripts/shoot-html.mjs <input.html> <output.png> [width] [selector]
 *
 * - width: ancho del viewport (default 1600). El alto se ajusta al contenido.
 * - selector: si se da, recorta a ese elemento; si no, captura la página completa.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [inArg, outArg, widthArg, arg4] = process.argv.slice(2);
if (!inArg || !outArg) {
  console.error("Uso: node scripts/shoot-html.mjs <input.html> <output.png> [width] [selector]");
  console.error("     PDF de páginas fijas (deck): <input.html> <output.pdf> <width> <pageHeight>");
  process.exit(1);
}
const input = resolve(inArg);
const output = resolve(outArg);
const width = Number(widthArg) || 1600;
mkdirSync(dirname(output), { recursive: true });

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) throw new Error("No encontré Chrome/Edge. Definí CHROME_PATH.");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(input).href, { waitUntil: "networkidle0", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 400)); // fuentes/emoji
  if (output.toLowerCase().endsWith(".pdf")) {
    await page.emulateMediaType("screen");
    // arg4 = alto de página fijo (deck de slides). Si no, alto = contenido (one-pager).
    const fixed = Number(arg4);
    const h = fixed && fixed > 0
      ? fixed
      : await page.evaluate(() => Math.ceil(document.body.scrollHeight));
    await page.pdf({ path: output, width: `${width}px`, height: `${h}px`, printBackground: true });
  } else if (arg4) {
    const el = await page.$(arg4); // arg4 = selector CSS para recortar
    if (!el) throw new Error("No encontré el selector: " + arg4);
    await el.screenshot({ path: output });
  } else {
    await page.screenshot({ path: output, fullPage: true });
  }
  console.log("✅", output);
} finally {
  await browser.close();
}
