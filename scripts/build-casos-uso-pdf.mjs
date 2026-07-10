#!/usr/bin/env node
/**
 * build-casos-uso-pdf.mjs — arma los documentos de "Casos de Uso" (UDEP,
 * Catálogo Funcional y Técnico/QA) en PDF A4 con portada, usando la misma
 * identidad visual ARIA que el resto de entregables (build-alcance-pdf.mjs).
 *
 *   node scripts/build-casos-uso-pdf.mjs
 */
import puppeteer from "puppeteer-core";
import MarkdownIt from "markdown-it";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOGO = pathToFileURL(join(ROOT, "docs", "comercial", "img", "logo-aria.png")).href;
const TODAY = "2026-07-10";

// Los 3 documentos a generar (fuente Markdown → PDF con portada).
const DOCS = [
  {
    src: join(ROOT, "docs", "comercial", "casos-uso-udep.md"),
    out: join(ROOT, "docs", "comercial", "ARIA-Casos-de-Uso-UDEP.pdf"),
    title: "Casos de Uso — UDEP",
    subtitle:
      "Cómo ARIA resuelve la captación y matrícula de posgrado, caso por caso",
    kicker: "Documento comercial",
  },
  {
    src: join(ROOT, "docs", "comercial", "casos-uso-funcional.md"),
    out: join(ROOT, "docs", "comercial", "ARIA-Casos-de-Uso-Funcional.pdf"),
    title: "Casos de Uso — Catálogo Funcional",
    subtitle: "Todo lo que ARIA puede hacer por tu operación, módulo por módulo",
    kicker: "Documento funcional",
  },
  {
    src: join(ROOT, "docs", "tecnico", "casos-uso-tecnico.md"),
    out: join(ROOT, "docs", "tecnico", "ARIA-Casos-de-Uso-Tecnico.pdf"),
    title: "Casos de Uso — Técnico / QA",
    subtitle:
      "Actores, flujos, excepciones y componentes de cada proceso de la plataforma",
    kicker: "Documento técnico",
  },
];

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!CHROME) throw new Error("No encontré Chrome/Edge. Definí CHROME_PATH.");

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

const CSS = `
  @page { margin: 18mm 16mm; }
  *{ box-sizing:border-box; }
  body{ font-family:"Segoe UI",-apple-system,Roboto,sans-serif; color:#0E1525; font-size:12.5px; line-height:1.55; }
  h1{ font-size:21px; margin:22px 0 10px; padding-left:11px; border-left:5px solid #BC5587; color:#0E1525; }
  h2{ font-size:16px; margin:16px 0 7px; color:#7A1E52; page-break-after:avoid; }
  h3{ font-size:13.5px; margin:13px 0 5px; color:#1f2a40; page-break-after:avoid; }
  p,li{ color:#1f2a40; } a{ color:#0F84A0; text-decoration:none; }
  strong{ color:#0E1525; }
  code{ font-family:"Cascadia Code",Consolas,monospace; font-size:11px; background:#F5F1F4; color:#7A1E52; padding:1px 5px; border-radius:4px; }
  table{ border-collapse:collapse; width:100%; margin:10px 0; font-size:11px; page-break-inside:avoid; }
  th,td{ border:1px solid #E7EAF0; padding:6px 9px; text-align:left; vertical-align:top; }
  th{ background:#FBF1F5; color:#7A1E52; }
  blockquote{ border-left:3px solid #D98A2B; margin:10px 0; padding:6px 14px; color:#4F5C75; background:#FBF7F1; border-radius:0 6px 6px 0; }
  hr{ border:none; border-top:1px solid #E7EAF0; margin:18px 0; }
  h2{ border-bottom:1px solid #F0E4EC; padding-bottom:3px; }
  .cover{ height:250mm; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; page-break-after:always; }
  .cover img{ height:132px; mix-blend-mode:multiply; }
  .cover .k{ font-size:12px; color:#BC5587; margin-top:20px; letter-spacing:3px; text-transform:uppercase; font-weight:700; }
  .cover .t{ font-size:30px; font-weight:800; margin-top:10px; letter-spacing:-.5px; }
  .cover .s{ font-size:15px; color:#4F5C75; margin-top:12px; max-width:540px; }
  .cover .bar{ width:130px; height:6px; border-radius:999px; margin-top:24px; background:linear-gradient(90deg,#D98A2B,#BC5587,#7A1E52); }
  .cover .d{ font-size:12px; color:#7A879F; margin-top:28px; letter-spacing:2px; text-transform:uppercase; }
`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});
try {
  for (const doc of DOCS) {
    if (!existsSync(doc.src)) {
      console.warn("⚠️  Falta fuente, se omite:", doc.src);
      continue;
    }
    const body = md.render(readFileSync(doc.src, "utf8"));
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
      <div class="cover">
        <img src="${LOGO}" alt="ARIA">
        <div class="k">${doc.kicker}</div>
        <div class="t">${doc.title}</div>
        <div class="s">${doc.subtitle}</div>
        <div class="bar"></div>
        <div class="d">ARIA · by Novasys · ${TODAY}</div>
      </div>
      ${body}
    </body></html>`;
    const tmp = join(dirname(doc.out), "_casos_tmp.html");
    writeFileSync(tmp, html);
    try {
      const pp = await browser.newPage();
      await pp.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle0", timeout: 60000 });
      await pp.pdf({ path: doc.out, format: "A4", printBackground: true, preferCSSPageSize: true });
      await pp.close();
      console.log("✅ PDF:", doc.out);
    } finally {
      try { rmSync(tmp); } catch { /* noop */ }
    }
  }
} finally {
  await browser.close();
}
