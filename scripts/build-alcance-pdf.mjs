#!/usr/bin/env node
/**
 * build-alcance-pdf.mjs — arma el documento comercial "Alcance Funcional y
 * Beneficios" (docs/comercial/alcance-funcional.md) en un PDF A4 con portada,
 * usando la misma identidad visual ARIA que el dossier técnico.
 *
 *   node scripts/build-alcance-pdf.mjs
 */
import puppeteer from "puppeteer-core";
import MarkdownIt from "markdown-it";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COM = join(ROOT, "docs", "comercial");
const SRC = join(COM, "alcance-funcional.md");
const OUT = join(COM, "ARIA-Alcance-Funcional.pdf");
const LOGO = pathToFileURL(join(COM, "img", "logo-aria.png")).href;
const TODAY = "2026-06-14";

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) throw new Error("No encontré Chrome/Edge. Definí CHROME_PATH.");

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
const body = md.render(readFileSync(SRC, "utf8"));

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
  @page { margin: 18mm 16mm; }
  *{ box-sizing:border-box; }
  body{ font-family:"Segoe UI",-apple-system,Roboto,sans-serif; color:#0E1525; font-size:12.5px; line-height:1.55; }
  h1{ font-size:21px; margin:22px 0 10px; padding-left:11px; border-left:5px solid #BC5587; color:#0E1525; }
  h2{ font-size:16px; margin:16px 0 7px; color:#7A1E52; }
  h3{ font-size:13.5px; margin:13px 0 5px; color:#1f2a40; }
  p,li{ color:#1f2a40; } a{ color:#0F84A0; text-decoration:none; }
  strong{ color:#0E1525; }
  table{ border-collapse:collapse; width:100%; margin:10px 0; font-size:11px; page-break-inside:avoid; }
  th,td{ border:1px solid #E7EAF0; padding:6px 9px; text-align:left; vertical-align:top; }
  th{ background:#FBF1F5; color:#7A1E52; }
  blockquote{ border-left:3px solid #D98A2B; margin:10px 0; padding:6px 14px; color:#4F5C75; background:#FBF7F1; border-radius:0 6px 6px 0; }
  hr{ border:none; border-top:1px solid #E7EAF0; margin:18px 0; }
  h2{ page-break-after:avoid; } h3{ page-break-after:avoid; }
  .cover{ height:250mm; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; page-break-after:always; }
  .cover img{ height:140px; mix-blend-mode:multiply; }
  .cover .t{ font-size:32px; font-weight:800; margin-top:26px; letter-spacing:-.5px; }
  .cover .s{ font-size:15px; color:#4F5C75; margin-top:12px; max-width:520px; }
  .cover .bar{ width:130px; height:6px; border-radius:999px; margin-top:24px; background:linear-gradient(90deg,#D98A2B,#BC5587,#7A1E52); }
  .cover .d{ font-size:12px; color:#7A879F; margin-top:28px; letter-spacing:2px; text-transform:uppercase; }
</style></head><body>
  <div class="cover">
    <img src="${LOGO}" alt="ARIA">
    <div class="t">Alcance Funcional y Beneficios</div>
    <div class="s">Qué entrega la plataforma ARIA y cómo cubre las necesidades de tu operación de contacto</div>
    <div class="bar"></div>
    <div class="d">ARIA · by Novasys · ${TODAY}</div>
  </div>
  ${body}
</body></html>`;

const tmp = join(COM, "_alcance.html");
writeFileSync(tmp, html);
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});
try {
  const pp = await browser.newPage();
  await pp.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle0", timeout: 60000 });
  await pp.pdf({ path: OUT, format: "A4", printBackground: true, preferCSSPageSize: true });
  console.log("✅ PDF:", OUT);
} finally {
  await browser.close();
  try { rmSync(tmp); } catch { /* noop */ }
}
