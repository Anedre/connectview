#!/usr/bin/env node
/**
 * setup-warmer.mjs — Crea (idempotente) una regla de EventBridge que "despierta"
 * los Lambdas de Grabaciones cada 5 minutos con un payload {warmup:true}, para
 * matar el cold start (la 1ª carga pasaba de ~6s a ~0.7s con el container ya
 * caliente). Cada handler corta en warmup y devuelve 200 sin trabajar.
 *
 * Costo: ~$0 (≈43k invocaciones vacías/mes + reglas EventBridge programadas).
 *
 * Uso (necesita AWS CLI con credenciales de la cuenta Novasys 731736972577):
 *   node scripts/setup-warmer.mjs
 * Para desactivar:
 *   node scripts/setup-warmer.mjs --disable
 */
import { execSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGION = process.env.AWS_REGION || "us-east-1";
const RULE = "connectview-recordings-warmer";
const DISABLE = process.argv.includes("--disable");

// Lambdas que alimentan la pantalla de Grabaciones (nombres reales en AWS).
const FUNCTIONS = [
  "amplify-connectview-andre-getcontacthistorylambda8-8RaahiJ62sav", // get-contact-history (amplify-managed)
  "connectview-get-contact-detail",
  "connectview-get-customer-thread",
  "connectview-get-customer-attachments",
  "connectview-manage-leads",
];

const aws = (args) =>
  execSync(`aws ${args} --region ${REGION} --no-cli-pager --output json`, {
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
const tryAws = (args) => { try { return aws(args); } catch { return null; } };

const account = JSON.parse(execSync("aws sts get-caller-identity --output json").toString()).Account;
const ruleArn = `arn:aws:events:${REGION}:${account}:rule/${RULE}`;
console.log(`Cuenta AWS: ${account} · región: ${REGION}`);

if (DISABLE) {
  console.log(`\n→ Desactivando warmer (${RULE})…`);
  tryAws(`events remove-targets --rule ${RULE} --ids ${FUNCTIONS.map((_, i) => i + 1).join(" ")}`);
  tryAws(`events delete-rule --name ${RULE}`);
  FUNCTIONS.forEach((fn) => tryAws(`lambda remove-permission --function-name ${fn} --statement-id warmer-invoke`));
  console.log("✅ Warmer desactivado.");
  process.exit(0);
}

// 1. Regla programada (rate 5 min).
console.log(`\n→ put-rule ${RULE} (rate 5 minutes)`);
const r = JSON.parse(
  aws(`events put-rule --name ${RULE} --schedule-expression "rate(5 minutes)" --state ENABLED --description "Warmer Grabaciones: mantiene los Lambdas calientes (#perf)"`)
);
console.log(`  RuleArn: ${r.RuleArn}`);

// 2. Permiso EventBridge→Lambda + arma los targets.
const targets = [];
FUNCTIONS.forEach((fn, i) => {
  const cfg = JSON.parse(aws(`lambda get-function-configuration --function-name ${fn}`));
  console.log(`\n→ ${fn}`);
  // Permiso idempotente: borra el viejo (si existe) y re-crea.
  tryAws(`lambda remove-permission --function-name ${fn} --statement-id warmer-invoke`);
  aws(`lambda add-permission --function-name ${fn} --statement-id warmer-invoke --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn ${ruleArn}`);
  console.log("  permiso de invocación ✓");
  targets.push({ Id: String(i + 1), Arn: cfg.FunctionArn, Input: JSON.stringify({ warmup: true }) });
});

// 3. Targets (vía archivo temporal — el JSON anidado es frágil inline en la CLI).
const tf = join(ROOT, ".warmer-targets.json").replace(/\\/g, "/");
writeFileSync(tf, JSON.stringify(targets));
console.log(`\n→ put-targets (${targets.length} Lambdas)`);
try {
  aws(`events put-targets --rule ${RULE} --targets file://${tf}`);
} finally {
  rmSync(tf, { force: true });
}

console.log(`\n✅ Warmer activo: los ${FUNCTIONS.length} Lambdas de Grabaciones se pinguean cada 5 min.`);
console.log("   Para desactivar: node scripts/setup-warmer.mjs --disable");
