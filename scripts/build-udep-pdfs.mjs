#!/usr/bin/env node
/**
 * build-udep-pdfs.mjs — arma los documentos de implementación en UDEP
 * (docs/udep/*.md) como PDFs A4 con portada, índice de la serie y paginación,
 * en la misma identidad visual que el resto de los documentos de ARIA.
 *
 *   node scripts/build-udep-pdfs.mjs            → los cinco
 *   node scripts/build-udep-pdfs.mjs 01 03      → solo esos
 *
 * Los diagramas del plan van en HTML/CSS, no en Mermaid: no hay mermaid-cli en
 * el entorno y un Gantt en grilla imprime mejor que un SVG generado por JS
 * (texto seleccionable, sin depender de que el render termine antes del print).
 */
import puppeteer from "puppeteer-core";
import MarkdownIt from "markdown-it";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "docs", "udep");
const OUT_DIR = join(SRC_DIR, "pdf");
const LOGO = pathToFileURL(join(ROOT, "docs", "comercial", "img", "logo-aria.png")).href;
const FECHA = "22 de julio de 2026";

const DOCS = [
  {
    id: "01",
    file: "01-plan-implementacion.md",
    out: "ARIA-UDEP-01-Plan-de-implementacion.pdf",
    titulo: "Plan de implementación",
    bajada:
      "Cronograma, fases, ruta crítica y alcance diferido de la puesta en marcha de ARIA en la Universidad de Piura",
  },
  {
    id: "02",
    file: "02-matriz-riesgos.md",
    out: "ARIA-UDEP-02-Matriz-de-riesgos.pdf",
    titulo: "Matriz de riesgos",
    bajada: "Diecisiete riesgos con probabilidad, impacto, responsable y plan de mitigación",
  },
  {
    id: "03",
    file: "03-analisis-brechas.md",
    out: "ARIA-UDEP-03-Analisis-de-brechas.pdf",
    titulo: "Análisis de brechas",
    bajada: "Qué distancia hay entre lo que existe hoy y lo que la operación necesita",
  },
  {
    id: "04",
    file: "04-plan-pruebas-uat.md",
    out: "ARIA-UDEP-04-Plan-de-pruebas.pdf",
    titulo: "Plan de pruebas y aceptación",
    bajada: "Treinta y ocho casos de prueba con criterios de aceptación y acta de conformidad",
  },
  {
    id: "05",
    file: "05-acta-compromisos.md",
    out: "ARIA-UDEP-05-Acta-de-compromisos.pdf",
    titulo: "Acta de compromisos",
    bajada: "Quién entrega qué y en qué fecha — el documento que gobierna el go-live",
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

// ── Diagramas del plan ───────────────────────────────────────────────────────
// Quince semanas, del 20 de julio al 26 de octubre. Cada barra se posiciona por
// columna de grilla; el offset es 2 porque la columna 1 es la etiqueta.
const SEMANAS = [
  ["20", "jul"], ["27", "jul"], ["3", "ago"], ["10", "ago"], ["17", "ago"],
  ["24", "ago"], ["31", "ago"], ["7", "sep"], ["14", "sep"], ["21", "sep"],
  ["28", "sep"], ["5", "oct"], ["12", "oct"], ["19", "oct"], ["26", "oct"],
];

/** [fase, tarea, dueño, colInicio, colFin, crítica, hito] */
const FILAS = [
  ["F0 · Cierre de acuerdos · 23–31 jul"],
  ["", "Set final de reportes", "UDEP", 2, 4, false],
  ["", "Sandbox de Salesforce", "UDEP", 2, 4, true],
  ["", "5 programas de ejemplo", "UDEP", 2, 4, false, 4],
  ["F1 · Accesos y credenciales · 3–21 ago"],
  ["", "Campos Vox__c en Salesforce", "UDEP", 4, 6, true],
  ["", "Número Meta de WhatsApp", "AMBOS", 4, 7, true],
  ["", "Metadata del IdP (SSO)", "UDEP", 4, 6, false],
  ["", "Imágenes de carrusel + Meta", "UDEP", 4, 6, false],
  ["", "Permiso de horarios de Connect", "UDEP", 4, 6, false],
  ["", "App de Mercado Libre", "UDEP", 5, 7, false, 7],
  ["F2 · Configuración · 10–28 ago"],
  ["", "Programas y taxonomía", "NOV", 5, 7, false],
  ["", "Usuarios y permisos", "NOV", 5, 6, false],
  ["", "Plantillas de WhatsApp a Meta", "NOV", 6, 8, false],
  ["", "Agente IA y base de conocimiento", "NOV", 6, 8, false],
  ["", "Colas, horarios y flujos", "NOV", 6, 7, false],
  ["F3 · Integración y pruebas técnicas · 24 ago – 11 sep"],
  ["", "Salesforce de punta a punta", "NOV", 7, 9, true],
  ["", "WhatsApp y deliverability", "NOV", 7, 9, true],
  ["", "Ingesta de Meta Lead Ads", "NOV", 8, 9, false],
  ["", "Discador y campañas programadas", "NOV", 8, 9, false],
  ["", "Reportes con datos reales", "NOV", 8, 10, false, 10],
  ["F4 · Pruebas de aceptación · 14–30 sep"],
  ["", "UAT con asesores reales", "UDEP", 10, 12, true],
  ["", "Corrección de hallazgos", "NOV", 10, 13, false],
  ["F5 · Capacitación · 21 sep – 2 oct"],
  ["", "Asesores", "AMBOS", 11, 12, false],
  ["", "Supervisores y administradores", "AMBOS", 12, 13, false, 13],
  ["F6 · Go-live y estabilización · 5–30 oct"],
  ["", "Piloto controlado (1 programa)", "AMBOS", 13, 14, true],
  ["", "Corte de Zapier", "UDEP", 14, 15, false],
  ["", "Producción total", "AMBOS", 14, 15, true, 15],
  ["", "Hypercare", "NOV", 15, 17, false],
];

function ganttHtml() {
  const escala = [
    `<div class="g-lbl">Semana del</div>`,
    ...SEMANAS.map(([d, m]) => `<div class="g-wk"><b>${d}</b>${m}</div>`),
  ].join("");

  const filas = FILAS.map((f) => {
    if (f.length === 1) return `<div class="g-fase">${f[0]}</div>`;
    const [, tarea, quien, ini, fin, critica, hito] = f;
    const celdas = [`<div class="g-task"><i data-o="${quien}">${quien}</i>${tarea}</div>`];
    if (ini > 2) celdas.push(`<div class="g-lane" style="grid-column:2/${ini}"></div>`);
    celdas.push(
      `<div class="g-lane" style="grid-column:${ini}/${fin}"><span class="g-bar" data-o="${quien}"${
        critica ? ' data-crit="1"' : ""
      }></span></div>`,
    );
    if (hito) {
      celdas.push(`<div class="g-lane" style="grid-column:${fin}/${hito + 1}"></div>`);
      celdas.push(`<div class="g-lane" style="grid-column:${hito + 1}/${hito + 2}"><span class="g-hito"></span></div>`);
      if (hito + 2 <= 17) celdas.push(`<div class="g-lane" style="grid-column:${hito + 2}/17"></div>`);
    } else if (fin < 17) {
      celdas.push(`<div class="g-lane" style="grid-column:${fin}/17"></div>`);
    }
    return celdas.join("");
  }).join("");

  return `<div class="gantt-wrap">
    <div class="gantt">${escala}${filas}</div>
    <div class="g-leyenda">
      <span><i class="sw" data-o="UDEP"></i> Responsabilidad de UDEP</span>
      <span><i class="sw" data-o="NOV"></i> Responsabilidad de Novasys</span>
      <span><i class="sw" data-o="AMBOS"></i> Compartida</span>
      <span><i class="sw" data-crit="1"></i> Ruta crítica</span>
      <span><i class="dia"></i> Hito</span>
    </div>
  </div>`;
}

const CADENA = [
  ["31 JUL", "Sandbox Salesforce", "Carlos Olortiga / Julio", "udep"],
  ["14 AGO", "Campos Vox__c", "Admin Salesforce UDEP", "udep"],
  ["21 AGO", "Número Meta activo", "Juan Gallardo", "udep"],
  ["11 SEP", "Integración validada", "Andre Alata", "nov"],
  ["30 SEP", "UAT aceptado", "Paul De Rutte · asesores", "udep"],
  ["16 OCT", "Producción total", "Ambas partes", "fin"],
];

function cadenaHtml() {
  return `<div class="cadena">${CADENA.map(
    ([f, t, o, k], i) =>
      `<div class="link" data-k="${k}"><div class="d">${f}</div><div class="t">${t}</div><div class="o">${o}</div>${
        i < CADENA.length - 1 ? '<span class="arrow"></span>' : ""
      }</div>`,
  ).join("")}</div>`;
}

// ── Markdown → HTML ──────────────────────────────────────────────────────────
const md = new MarkdownIt({ html: true, linkify: false, typographer: false });

function render(markdown, docId) {
  // Normalizar CRLF de entrada: en Windows git entrega los .md con \r\n y toda
  // expresión que busque "\n" después de un marcador falla en silencio — el
  // bloque Mermaid salía impreso como código crudo.
  let src = markdown.replace(/\r\n/g, "\n");

  // Los diagramas Mermaid se sustituyen por marcadores y luego por su HTML.
  const bloques = [];
  src = src.replace(/```mermaid\n([\s\S]*?)```/g, (_, cuerpo) => {
    bloques.push(cuerpo.includes("gantt") ? ganttHtml() : cadenaHtml());
    return `\n@@DIAGRAMA${bloques.length - 1}@@\n`;
  });

  // El título del documento vive en la portada: se quita el H1 del cuerpo para
  // no repetirlo, junto con la regla que suele seguirlo.
  src = src.replace(/^#\s+.*\n/, "");

  let out = md.render(src);
  bloques.forEach((b, i) => {
    out = out.replace(new RegExp(`<p>@@DIAGRAMA${i}@@</p>`), b);
  });

  // Emojis de estado → tipografía. En PDF los cuadros ⬜/✅ salen como glifos
  // sueltos y la palabra que los acompaña ya dice lo mismo.
  out = out
    .replace(/⬜\s*/g, "○ ")
    .replace(/✅\s*/g, "● ")
    .replace(/🔑\s*/g, "")
    .replace(/🔴\s*/g, "")
    .replace(/⚠️\s*/g, "");

  // Los enlaces entre documentos de la serie no navegan en PDF. En vez de dejar
  // el nombre del archivo a la vista, se cita el documento por su número y
  // título, que es como lo va a buscar quien lo lea impreso.
  out = out.replace(/<a href="(0\d)-[^"]*\.md">[^<]*<\/a>/g, (m, id) => {
    const d = DOCS.find((x) => x.id === id);
    return d ? `<em>documento ${id} · ${d.titulo}</em>` : m;
  });
  out = out.replace(/<a href="[^"]*">([^<]*)<\/a>/g, "$1");

  // Marca las celdas de severidad para poder darles color.
  out = out.replace(
    /<td>(Crítica|Alta|Media|Baja)<\/td>/g,
    (_, s) => `<td class="sev" data-s="${s.toLowerCase()}">${s}</td>`,
  );

  return { html: `<div class="doc" data-id="${docId}">${out}</div>`, secciones: seccionesDe(src) };
}

/** Títulos de nivel 2, para el índice de la portada. */
function seccionesDe(src) {
  return [...src.matchAll(/^##\s+(.+)$/gm)]
    .map((m) => m[1].replace(/[*_`]/g, "").trim())
    .filter((t) => !/^\d+\.\s*$/.test(t));
}

// ── Plantilla ────────────────────────────────────────────────────────────────
const CSS = `
  @page { size:A4; margin: 17mm 15mm 16mm; }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{
    font-family:"Segoe UI",-apple-system,Roboto,sans-serif;
    color:#141C2B; font-size:11.5px; line-height:1.55;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }

  /* Portada */
  .cover{ height:252mm; display:flex; flex-direction:column; justify-content:center;
          page-break-after:always; }
  .cover img{ height:96px; align-self:flex-start; mix-blend-mode:multiply; }
  .cover .kicker{ margin-top:34px; font-size:11px; letter-spacing:.22em; text-transform:uppercase;
                  color:#9A3468; font-weight:700; }
  .cover .t{ font-size:39px; font-weight:800; letter-spacing:-.9px; margin-top:9px; line-height:1.08; }
  .cover .s{ font-size:14.5px; color:#4F5C75; margin-top:14px; max-width:135mm; line-height:1.5; }
  .cover .bar{ width:120px; height:5px; border-radius:999px; margin-top:26px;
               background:linear-gradient(90deg,#D98A2B,#BC5587,#7A1E52); }
  .cover .cols{ display:grid; grid-template-columns:1fr 62mm; gap:14mm; margin-top:30px; }
  .toc-h{ font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:#9A3468;
          font-weight:700; margin-bottom:7px; }
  .toc ol{ margin:0; padding-left:15px; }
  .toc li{ font-size:10.5px; color:#28324a; margin:2.5px 0; }
  .serie-i{ font-size:10px; color:#7A879F; padding:3px 0 3px 9px; border-left:2px solid #EEF1F6;
            line-height:1.35; }
  .serie-i b{ color:#C2C9D6; font-weight:700; margin-right:5px; }
  .serie-i[data-actual="1"]{ color:#141C2B; border-left-color:#BC5587; font-weight:600; }
  .serie-i[data-actual="1"] b{ color:#BC5587; }
  .cover .meta{ margin-top:auto; border-top:1px solid #E7EAF0; padding-top:12px;
                display:flex; justify-content:space-between; font-size:10.5px; color:#7A879F; }
  .cover .meta b{ color:#141C2B; font-weight:650; }

  /* Tipografía del cuerpo */
  h2{ font-size:17px; margin:20px 0 8px; color:#7A1E52; padding-left:10px;
      border-left:4px solid #BC5587; page-break-after:avoid; }
  h3{ font-size:13px; margin:15px 0 5px; color:#141C2B; page-break-after:avoid; }
  h4{ font-size:11.8px; margin:12px 0 4px; color:#4F5C75; page-break-after:avoid; }
  p,li{ color:#28324a; } strong{ color:#141C2B; font-weight:650; }
  em{ font-style:normal; color:#7A1E52; font-weight:600; }
  ul,ol{ padding-left:19px; margin:7px 0; }
  li{ margin:3px 0; }
  code{ font-family:"Cascadia Mono",Consolas,monospace; font-size:10px;
        background:#F4F6FA; border:1px solid #E7EAF0; border-radius:3px; padding:0 4px; color:#7A1E52; }
  hr{ border:none; border-top:1px solid #E7EAF0; margin:16px 0; }
  blockquote{ border-left:3px solid #D98A2B; margin:11px 0; padding:8px 14px; color:#4F5C75;
              background:#FDF8F1; border-radius:0 6px 6px 0; page-break-inside:avoid; }
  blockquote p{ margin:0; }

  /* Tablas */
  table{ border-collapse:collapse; width:100%; margin:10px 0; font-size:9.8px;
         page-break-inside:avoid; }
  th,td{ border:1px solid #E7EAF0; padding:5px 7px; text-align:left; vertical-align:top; }
  th{ background:#FBF1F5; color:#7A1E52; font-weight:650; white-space:nowrap; }
  /* La primera columna suele ser un identificador corto (C-01, R-07, P-12): sin
     esto se parte en dos líneas y deja de leerse como una unidad. */
  td:first-child{ white-space:nowrap; }
  td.sev{ font-weight:650; white-space:nowrap; }
  td.sev[data-s="crítica"]{ color:#A8322C; }
  td.sev[data-s="alta"]{ color:#B0741C; }
  td.sev[data-s="media"]{ color:#4F5C75; }
  td.sev[data-s="baja"]{ color:#7A879F; }

  /* Gantt */
  .gantt-wrap{ margin:12px 0 6px; page-break-inside:avoid; }
  .gantt{ display:grid; grid-template-columns:44mm repeat(15,1fr); border:1px solid #E7EAF0;
          border-radius:4px; overflow:hidden; }
  .g-lbl{ grid-column:1; padding:5px 7px; background:#FBF1F5; font-size:8px; font-weight:700;
          letter-spacing:.08em; text-transform:uppercase; color:#9A3468;
          border-bottom:1px solid #DCE0E8; }
  .g-wk{ padding:4px 0 3px; background:#FBF1F5; text-align:center; font-size:7.5px; color:#7A879F;
         border-left:1px solid #EEF1F6; border-bottom:1px solid #DCE0E8; line-height:1.25; }
  .g-wk b{ display:block; font-size:8.5px; color:#4F5C75; }
  .g-fase{ grid-column:1/-1; padding:5px 7px 3px; background:#F7F8FA; font-size:8px;
           letter-spacing:.07em; text-transform:uppercase; color:#7A1E52; font-weight:700;
           border-top:1px solid #E7EAF0; border-bottom:1px solid #E7EAF0; }
  .g-task{ grid-column:1; padding:3px 7px; font-size:8.5px; border-bottom:1px solid #F1F3F7;
           display:flex; align-items:center; gap:5px; line-height:1.25; }
  .g-task i{ font-style:normal; font-size:6.5px; font-weight:700; letter-spacing:.04em;
             padding:1px 3px; border-radius:2px; border:1px solid; flex:0 0 auto; }
  .g-task i[data-o="UDEP"]{ color:#B0741C; border-color:#D98A2B; background:#FDF3E5; }
  .g-task i[data-o="NOV"]{ color:#7A1E52; border-color:#BC5587; background:#FBF1F5; }
  .g-task i[data-o="AMBOS"]{ color:#4F5C75; border-color:#C2C9D6; background:#F4F6FA; }
  .g-lane{ border-bottom:1px solid #F1F3F7; border-left:1px solid #F4F6FA; min-height:15px;
           display:flex; align-items:center; }
  .g-bar{ height:8px; border-radius:2px; width:calc(100% - 3px); margin:0 1.5px; background:#BC5587; }
  .g-bar[data-o="UDEP"]{ background:#D98A2B; }
  .g-bar[data-o="AMBOS"]{ background:repeating-linear-gradient(-45deg,#D98A2B,#D98A2B 3px,#BC5587 3px,#BC5587 6px); }
  /* La ruta crítica se marca con un contorno, no con una sombra: al imprimir,
     una sombra de 1px se pierde y las barras críticas quedaban indistinguibles. */
  .g-bar[data-crit="1"]{ outline:1.2px solid #A8322C; outline-offset:1.2px; }
  .g-hito{ width:7px; height:7px; transform:rotate(45deg); background:#7A1E52; margin-left:-3px; flex:0 0 auto; }
  .g-leyenda{ display:flex; flex-wrap:wrap; gap:5px 14px; margin-top:6px; font-size:8px; color:#4F5C75; }
  .g-leyenda .sw{ display:inline-block; width:14px; height:6px; border-radius:2px;
                  background:#BC5587; vertical-align:middle; margin-right:4px; }
  .g-leyenda .sw[data-o="UDEP"]{ background:#D98A2B; }
  .g-leyenda .sw[data-o="AMBOS"]{ background:repeating-linear-gradient(-45deg,#D98A2B,#D98A2B 3px,#BC5587 3px,#BC5587 6px); }
  .g-leyenda .sw[data-crit="1"]{ outline:1.2px solid #A8322C; outline-offset:1.2px; margin-left:2px; }
  .g-leyenda .dia{ display:inline-block; width:6px; height:6px; transform:rotate(45deg);
                   background:#7A1E52; margin-right:7px; }

  /* Ruta crítica */
  .cadena{ display:grid; grid-template-columns:repeat(3,1fr); gap:7px 16px; margin:12px 0;
           page-break-inside:avoid; }
  .cadena .link{ position:relative; border:1px solid #E7EAF0; border-left:3px solid #D98A2B;
                 border-radius:3px; padding:7px 9px; background:#fff; }
  .cadena .link[data-k="nov"]{ border-left-color:#BC5587; }
  .cadena .link[data-k="fin"]{ border-left-color:#2F7A52; }
  .cadena .d{ font-size:8px; font-weight:700; letter-spacing:.06em; color:#B0741C; }
  .cadena .link[data-k="nov"] .d{ color:#7A1E52; }
  .cadena .link[data-k="fin"] .d{ color:#2F7A52; }
  .cadena .t{ font-size:11px; font-weight:700; margin-top:1px; line-height:1.25; }
  .cadena .o{ font-size:9px; color:#7A879F; margin-top:1px; }
  .cadena .arrow{ position:absolute; right:-11px; top:50%; width:5px; height:5px;
                  border-top:1.4px solid #C2C9D6; border-right:1.4px solid #C2C9D6;
                  transform:translateY(-50%) rotate(45deg); }
  .cadena .link:nth-child(3n) .arrow{ display:none; }
`;

const FOOTER = (doc) => `
  <div style="width:100%;font-family:'Segoe UI',sans-serif;font-size:7.5pt;color:#9AA5B5;
              padding:0 15mm;display:flex;justify-content:space-between;">
    <span>ARIA &middot; Novasys &nbsp;|&nbsp; ${doc.titulo} &nbsp;|&nbsp; Universidad de Piura</span>
    <span>Pág. <span class="pageNumber"></span> de <span class="totalPages"></span></span>
  </div>`;

// ── Generación ───────────────────────────────────────────────────────────────
const filtro = process.argv.slice(2);
const objetivo = filtro.length ? DOCS.filter((d) => filtro.includes(d.id)) : DOCS;
if (!objetivo.length) throw new Error(`Sin documentos que coincidan con: ${filtro.join(", ")}`);
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--force-color-profile=srgb", "--allow-file-access-from-files"],
});

for (const doc of objetivo) {
  const markdown = readFileSync(join(SRC_DIR, doc.file), "utf8");
  const { html: cuerpo, secciones } = render(markdown, doc.id);

  // Índice del documento y ubicación dentro de la serie: convierte la portada
  // en algo que se lee, no en una carátula decorativa.
  const indice = secciones.length
    ? `<div class="toc"><div class="toc-h">En este documento</div><ol>${secciones
        .map((s) => `<li>${s.replace(/^\d+\.\s*/, "")}</li>`)
        .join("")}</ol></div>`
    : "";
  const serie = `<div class="serie"><div class="toc-h">La serie completa</div>${DOCS.map(
    (d) =>
      `<div class="serie-i"${d.id === doc.id ? ' data-actual="1"' : ""}><b>${d.id}</b> ${d.titulo}</div>`,
  ).join("")}</div>`;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>${CSS}</style></head><body>
  <div class="cover">
    <img src="${LOGO}" alt="ARIA">
    <div class="kicker">Implementación en la Universidad de Piura &middot; Documento ${doc.id} de 05</div>
    <div class="t">${doc.titulo}</div>
    <div class="s">${doc.bajada}</div>
    <div class="bar"></div>
    <div class="cols">${indice}${serie}</div>
    <div class="meta">
      <span>Preparado por <b>Novasys</b> para la <b>Universidad de Piura</b></span>
      <span>Versión 1.0 &middot; ${FECHA}</span>
    </div>
  </div>
  ${cuerpo}
</body></html>`;

  const tmp = join(OUT_DIR, `_${doc.id}.html`);
  writeFileSync(tmp, html);
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle0" });
  await page.pdf({
    path: join(OUT_DIR, doc.out),
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: FOOTER(doc),
    margin: { top: "17mm", bottom: "16mm", left: "15mm", right: "15mm" },
  });
  await page.close();
  rmSync(tmp, { force: true });
  console.log(`  ✔ ${doc.out}`);
}

await browser.close();
console.log(`\nListo — ${objetivo.length} PDF(s) en docs/udep/pdf/`);
