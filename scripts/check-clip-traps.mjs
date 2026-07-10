#!/usr/bin/env node
/**
 * check-clip-traps — caza el bug "clip por transform + overflow:hidden".
 *
 * Un contenedor con `overflow:hidden` recorta a sus hijos `position:absolute`
 * SOLO cuando el contenedor tiene un `transform` (un transform lo vuelve el
 * bloque contenedor de sus absolutos). Si el transform es CONDICIONAL
 * (`:hover`/`:active`/`:focus`), el hijo se ve completo en reposo y recortado
 * en ese estado → bug intermitente. Es lo que le pasó a `.fb-node` recortando
 * al conector `.fb-out` (ver design/audit-css-clip-traps-2026-07-10.md).
 *
 * Regla: si un mismo selector base tiene `overflow:hidden` Y una variante
 * `:hover/:active/:focus` con `transform` (≠ none), se marca. Falla (exit 1).
 *
 * Opt-out: si verificaste que NINGÚN hijo sobresale (el overflow solo redondea
 * o recorta un glow inset), agrega un comentario `clip-ok` dentro de la regla
 * del `overflow:hidden`. Queda documentado y el chequeo lo ignora.
 *
 * Límite conocido: solo correlaciona el MISMO selector base. No detecta cuando
 * el transform llega por una clase global compartida (`.card:hover` de
 * motion.css) sobre un elemento que gana `overflow:hidden` por otra vía. Es un
 * tripwire del patrón de autoría más común, no una prueba exhaustiva.
 *
 * Uso: `npm run css:traps` (corre en CI antes del build).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const STATE_RE = /:(?:hover|active|focus|focus-visible|focus-within)\b/g;

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (entry.endsWith(".css")) files.push(p);
  }
})(ROOT);

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** base selector -> { overflow:[{file,line}], transform:[{file,line}], clipOk:bool } */
const bySel = new Map();
const get = (sel) => {
  if (!bySel.has(sel)) bySel.set(sel, { overflow: [], transform: [], clipOk: false });
  return bySel.get(sel);
};

function hasTransform(body) {
  const m = body.match(/(?<![\w-])transform\s*:\s*([^;}]+)/i);
  if (!m) return false;
  return !/^\s*none\s*$/i.test(m[1]);
}
function hasOverflowHidden(body) {
  const m = body.match(/(?<![\w-])overflow(?:-[xy])?\s*:\s*([^;}]+)/i);
  return m ? /\b(hidden|clip)\b/i.test(m[1]) : false;
}

for (const f of files) {
  const css = readFileSync(f, "utf8");
  // Reglas hoja: `selector { body }` sin llaves anidadas (incluye reglas dentro
  // de @media, que matchean como hoja). match[1]=preludio+selector, match[2]=body.
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const raw = m[0];
    const line = css.slice(0, m.index).split("\n").length;
    const selectorText = stripComments(m[1]).trim();
    const body = stripComments(m[2]);
    if (!selectorText) continue;
    const clipOk = /clip-ok/i.test(raw);
    const overflow = hasOverflowHidden(body);
    const transform = hasTransform(body);
    if (!overflow && !transform) continue;

    for (let sel of selectorText.split(",")) {
      sel = sel.trim();
      if (!sel || /^(?:\d|from\b|to\b|@|%)/.test(sel)) continue; // keyframes / at-rules
      if (!sel.includes(".")) continue; // solo selectores con clase
      const isState = STATE_RE.test(sel);
      STATE_RE.lastIndex = 0;
      const base = sel.replace(STATE_RE, "").replace(/\s+/g, " ").trim();
      STATE_RE.lastIndex = 0;
      if (!base) continue;
      const rec = get(base);
      if (overflow) {
        rec.overflow.push({ file: f, line });
        if (clipOk) rec.clipOk = true;
      }
      if (transform && isState) {
        rec.transform.push({ file: f, line });
        if (clipOk) rec.clipOk = true;
      }
    }
  }
}

const hits = [...bySel.entries()]
  .filter(([, r]) => r.overflow.length && r.transform.length && !r.clipOk)
  .sort(([a], [b]) => a.localeCompare(b));

if (hits.length === 0) {
  console.log(`✓ Sin traps de clip (overflow:hidden + transform en :hover/estado) — ${files.length} archivos .css.`);
  process.exit(0);
}

console.error(`✗ ${hits.length} selector(es) con overflow:hidden + transform condicional (posible "clip por transform"):\n`);
for (const [sel, r] of hits) {
  const ov = r.overflow.map((x) => `${x.file}:${x.line}`).join(", ");
  const tf = r.transform.map((x) => `${x.file}:${x.line}`).join(", ");
  console.error(`  ${sel}`);
  console.error(`      overflow:hidden → ${ov}`);
  console.error(`      transform (:hover/estado) → ${tf}`);
}
console.error(
  `\nSi el contenedor tiene un hijo que SOBRESALE (conector/badge/anillo/tooltip), se recortará solo en ese estado.` +
    `\nArréglalo (quitá el transform, o poné el clip en un wrapper interno, o colgá el hijo fuera del overflow).` +
    `\nSi verificaste que NINGÚN hijo sobresale, agregá un comentario /* clip-ok: motivo */ dentro de la regla del overflow:hidden.`,
);
process.exit(1);
