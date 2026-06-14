#!/usr/bin/env node
/**
 * build-tech-pdf.mjs — arma el dossier técnico (docs/tecnico/01..05) en un PDF
 * con portada y los diagramas Mermaid renderizados como imagen.
 *
 *   node scripts/build-tech-pdf.mjs
 *
 * Pipeline: extrae los bloques ```mermaid```, los renderiza a PNG con la lib
 * mermaid en Chrome (sistema, vía puppeteer-core), reemplaza por imágenes,
 * convierte Markdown→HTML (markdown-it) y exporta a PDF (A4).
 */
import puppeteer from "puppeteer-core";
import MarkdownIt from "markdown-it";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEC = join(ROOT, "docs", "tecnico");
const IMGDIR = join(TEC, "_pdfimg");
const OUT = join(TEC, "ARIA-Documentacion-Tecnica.pdf");
const LOGO = pathToFileURL(join(ROOT, "docs", "comercial", "img", "logo-aria.png")).href;
const TEC_IMG = pathToFileURL(join(TEC, "img")).href + "/";
mkdirSync(IMGDIR, { recursive: true });

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean).find((p) => existsSync(p));
if (!CHROME) throw new Error("No encontré Chrome/Edge. Definí CHROME_PATH.");

const DOCS = [
  "01-arquitectura-aplicacion.md",
  "02-arquitectura-fisica.md",
  "03-flujo-procesos.md",
  "04-manual-usuario-instalacion.md",
  "05-costos.md",
];

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

// 1) extraer mermaid + reemplazar por imágenes (absolutas)
const diagrams = [];
let counter = 0;
function stripMermaid(text) {
  return text.replace(/```mermaid\s*\n([\s\S]*?)```/g, (_m, code) => {
    const id = ++counter;
    diagrams.push({ id, code: code.trim() });
    const abs = pathToFileURL(join(IMGDIR, `diagram-${id}.png`)).href;
    return `\n![Diagrama ${id}](${abs})\n`;
  });
}

const sections = DOCS.map((f) => {
  const raw = readFileSync(join(TEC, f), "utf8");
  let html = md.render(stripMermaid(raw));
  html = html.split('src="img/').join('src="' + TEC_IMG); // capturas relativas → absolutas
  return `<section class="doc">${html}</section>`;
}).join("\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});
try {
  // 2) renderizar cada diagrama Mermaid a PNG
  const mermaidUrl = pathToFileURL(join(ROOT, "node_modules/mermaid/dist/mermaid.min.js")).href;
  const renderHtml = `<!doctype html><html><head><meta charset="utf-8">
    <style>body{margin:0;background:#fff;font-family:"Segoe UI",sans-serif} #out{display:inline-block;padding:8px}</style>
    <script src="${mermaidUrl}"></script></head><body><div id="out"></div></body></html>`;
  const tmpHtml = join(IMGDIR, "_render.html");
  writeFileSync(tmpHtml, renderHtml);
  const rp = await browser.newPage();
  await rp.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 2 });
  await rp.goto(pathToFileURL(tmpHtml).href, { waitUntil: "load" });
  await rp.evaluate(() => window.mermaid.initialize({ startOnLoad: false, theme: "default", flowchart: { useMaxWidth: false }, sequence: { useMaxWidth: false } }));

  for (const d of diagrams) {
    try {
      await rp.evaluate(async (code, id) => {
        const { svg } = await window.mermaid.render("m" + id, code);
        document.getElementById("out").innerHTML = svg;
      }, d.code, d.id);
      await sleep(120);
      const el = await rp.$("#out svg");
      await el.screenshot({ path: join(IMGDIR, `diagram-${d.id}.png`) });
      console.log("🖼️  diagrama", d.id);
    } catch (e) {
      console.warn("⚠️ diagrama", d.id, "falló:", e.message);
    }
  }

  // 3) ensamblar HTML final + portada
  const today = "2026-06-04";
  const finalHtml = `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    @page { margin: 18mm 16mm; }
    *{ box-sizing:border-box; }
    body{ font-family:"Segoe UI",-apple-system,Roboto,sans-serif; color:#0E1525; font-size:12.5px; line-height:1.5; }
    h1{ font-size:22px; border-bottom:2px solid #E7EAF0; padding-bottom:6px; margin:18px 0 10px; }
    h2{ font-size:17px; margin:16px 0 8px; color:#0E1525; }
    h3{ font-size:14px; margin:12px 0 6px; color:#4F5C75; }
    p,li{ color:#1f2a40; } a{ color:#0F84A0; text-decoration:none; }
    code{ background:#F1F3F7; padding:1px 5px; border-radius:4px; font-family:"Cascadia Code",Consolas,monospace; font-size:11px; }
    pre{ background:#F6F7F9; border:1px solid #E7EAF0; border-radius:8px; padding:10px 12px; overflow:hidden; font-size:10.5px; white-space:pre-wrap; }
    pre code{ background:none; padding:0; }
    table{ border-collapse:collapse; width:100%; margin:10px 0; font-size:11px; }
    th,td{ border:1px solid #E7EAF0; padding:6px 9px; text-align:left; vertical-align:top; }
    th{ background:#F1F3F7; }
    blockquote{ border-left:3px solid #D98A2B; margin:10px 0; padding:4px 14px; color:#4F5C75; background:#FBF7F1; }
    img{ max-width:100%; display:block; margin:12px auto; }
    .doc{ page-break-before: always; }
    .cover{ height:250mm; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; }
    .cover img{ height:150px; mix-blend-mode:multiply; }
    .cover .t{ font-size:30px; font-weight:800; margin-top:26px; letter-spacing:-.5px; }
    .cover .s{ font-size:16px; color:#4F5C75; margin-top:10px; }
    .cover .d{ font-size:13px; color:#7A879F; margin-top:30px; letter-spacing:2px; text-transform:uppercase; }
    .cover .bar{ width:120px; height:6px; border-radius:999px; margin-top:24px; background:linear-gradient(90deg,#D98A2B,#BC5587,#7A1E52); }
  </style></head><body>
    <div class="cover">
      <img src="${LOGO}" alt="ARIA">
      <div class="t">Documentación Técnica</div>
      <div class="s">Plataforma de Contact Center / CRM multi-tenant sobre Amazon Connect</div>
      <div class="bar"></div>
      <div class="d">ARIA · by Novasys · ${today}</div>
    </div>
    ${sections}
  </body></html>`;
  const finalPath = join(IMGDIR, "_dossier.html");
  writeFileSync(finalPath, finalHtml);

  // 4) HTML → PDF
  const pp = await browser.newPage();
  await pp.goto(pathToFileURL(finalPath).href, { waitUntil: "networkidle0", timeout: 60000 });
  await pp.pdf({ path: OUT, format: "A4", printBackground: true, preferCSSPageSize: true });
  console.log("✅ PDF:", OUT, "·", diagrams.length, "diagramas");
} finally {
  await browser.close();
  // limpieza de temporales (deja los PNG de diagramas por si se quieren reusar)
  try { rmSync(join(IMGDIR, "_render.html")); rmSync(join(IMGDIR, "_dossier.html")); } catch { /* noop */ }
}
