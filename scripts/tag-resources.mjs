#!/usr/bin/env node
/**
 * tag-resources.mjs — etiqueta los recursos de ARIA que NO son Lambda (las Lambdas
 * ya las cubre `tag-lambdas.mjs`) con la misma etiqueta de producto, para que el
 * filtro por etiqueta de Cost Explorer capture el gasto de ARIA completo (no solo
 * el cómputo). Hoy cubre **DynamoDB** (las tablas `connectview-*`, el otro costo
 * grande de la plataforma). Cognito, Secrets y CloudWatch son chicos y se pueden
 * agregar igual (misma etiqueta) cuando haga falta.
 *
 * Etiqueta aplicada (no-disruptivo — no renombra nada):
 *   aria:product = ARIA
 *   aria:layer   = core
 *
 * 🔑 Después de etiquetar, hay que **activar `aria:product` como cost allocation tag**
 * en la consola de Facturación de AWS (Billing → Cost allocation tags). No es
 * retroactivo y tarda ~24 h en poblar Cost Explorer.
 *
 * Uso:  node scripts/tag-resources.mjs            (aplica)
 *       node scripts/tag-resources.mjs --dry-run  (solo reporta)
 *
 * Ver la convención en design/nomenclatura.md.
 */
import { execSync } from "node:child_process";

const REGION = process.env.AWS_REGION || "us-east-1";
const ACCOUNT_ID = process.env.ACCOUNT_ID || "731736972577";
const DRY = process.argv.includes("--dry-run");

const sh = (cmd) => execSync(cmd, { encoding: "utf8", env: { ...process.env, AWS_REGION: REGION } });

// Lista TODAS las tablas (auto-paginado con LastEvaluatedTableName).
function listTables() {
  const out = [];
  let start = null;
  do {
    const cmd =
      `aws dynamodb list-tables --region ${REGION} --output json` +
      (start ? ` --exclusive-start-table-name "${start}"` : "");
    const j = JSON.parse(sh(cmd));
    out.push(...(j.TableNames || []));
    start = j.LastEvaluatedTableName || null;
  } while (start);
  return out;
}

// Tablas de ARIA: `connectview-*` (hand-managed) o `amplify-...-connectview-...`.
const isAria = (t) => t.startsWith("connectview-") || /connectview/i.test(t);

const all = listTables();
const aria = all.filter(isAria);
console.log(`Tablas en la cuenta: ${all.length} · de ARIA: ${aria.length}`);

let tagged = 0;
for (const name of aria) {
  const arn = `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${name}`;
  const tags = "Key=aria:product,Value=ARIA Key=aria:layer,Value=core";
  if (DRY) {
    console.log(`[dry] ${name} → aria:product=ARIA, aria:layer=core`);
  } else {
    sh(`aws dynamodb tag-resource --region ${REGION} --resource-arn "${arn}" --tags ${tags}`);
    tagged++;
  }
}
console.log(
  DRY
    ? "\n(dry-run — nada aplicado)"
    : `\n✅ ${tagged} tablas DynamoDB de ARIA etiquetadas.\n` +
        "🔑 Falta: activar 'aria:product' como cost allocation tag en Billing (~24h, no retroactivo).",
);
