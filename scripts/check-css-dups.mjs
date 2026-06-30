#!/usr/bin/env node
/**
 * check-css-dups — detecta clases CSS definidas en 2+ archivos .css (colisiones
 * cross-file que rompen por orden de cascada, como el bug `.exec-insights` que
 * tenía estilos en index.css Y exec.css y ganaba el equivocado).
 *
 * Regla: cada clase debe definirse en UN solo archivo. Falla (exit 1) si no.
 * Uso: `npm run css:dups`  (o en CI antes del build).
 *
 * Heurística: cuenta clases que ABREN una regla a inicio de línea
 * (`.foo {`, `.foo__bar {`, `.foo:hover {`, `.foo, .bar {`…). No mira selectores
 * anidados/indentados (variantes en media queries) — alcanza para cazar el
 * patrón peligroso de "mismo componente estilado en dos archivos".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (entry.endsWith(".css")) files.push(p);
  }
})(ROOT);

/** clase -> Set(archivos donde abre una regla) */
const byClass = new Map();
for (const f of files) {
  const css = readFileSync(f, "utf8");
  const here = new Set();
  for (const m of css.matchAll(/^\.([A-Za-z_][A-Za-z0-9_-]*)/gm)) here.add(m[1]);
  for (const c of here) {
    if (!byClass.has(c)) byClass.set(c, new Set());
    byClass.get(c).add(f);
  }
}

const dups = [...byClass.entries()]
  .filter(([, fs]) => fs.size > 1)
  .sort(([a], [b]) => a.localeCompare(b));

if (dups.length === 0) {
  console.log(`✓ Sin clases CSS duplicadas entre archivos (${files.length} archivos .css revisados).`);
  process.exit(0);
}

console.error(`✗ ${dups.length} clase(s) CSS definidas en 2+ archivos (colisión de cascada):\n`);
for (const [c, fs] of dups) {
  console.error(`  .${c}  →  ${[...fs].join("   ")}`);
}
console.error(`\nConsolidá cada clase en UN solo archivo (la copia "perdedora" de la cascada queda muerta o, peor, pisa a la buena).`);
process.exit(1);
