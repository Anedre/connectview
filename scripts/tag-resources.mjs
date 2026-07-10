#!/usr/bin/env node
/**
 * tag-resources.mjs — etiqueta TODA la infra de ARIA que NO es Lambda (las Lambdas
 * las cubre `tag-lambdas.mjs`) con la etiqueta de producto, para que el filtro por
 * etiqueta de Cost Explorer capture el gasto COMPLETO de ARIA (no solo cómputo).
 *
 * Cubre: **DynamoDB** (tablas), **Secrets Manager** (el costo fijo más grande),
 * **Cognito** (user pool), **CloudWatch Logs** (log groups de las funciones),
 * **EventBridge** (rules de los crons) y **S3** (buckets de la plataforma).
 *
 * Etiqueta aplicada (no-disruptivo — no renombra nada):
 *   aria:product = ARIA
 *   aria:layer   = core
 *
 * 🔑 El cost allocation tag `aria:product` ya está ACTIVO en Billing. Etiquetar
 * recursos nuevos NO es retroactivo: sus costos aparecen en Cost Explorer desde el
 * momento del etiquetado (~24 h para reflejarse).
 *
 * Uso:  node scripts/tag-resources.mjs            (aplica)
 *       node scripts/tag-resources.mjs --dry-run  (solo reporta)
 *
 * Ver la convención en design/nomenclatura.md.
 */
import { execSync } from "node:child_process";

const REGION = process.env.AWS_REGION || "us-east-1";
const ACCOUNT_ID = process.env.ACCOUNT_ID || "731736972577";
const POOL_ID = process.env.COGNITO_USER_POOL_ID || "us-east-1_csLvANyZo";
const DRY = process.argv.includes("--dry-run");

// Formatos de --tags por servicio. `aria:tier=platform` = infra COMPARTIDA en la
// cuenta de Novasys (lo que NOSOTROS pagamos por operar ARIA). Los recursos BYO que
// el cliente crea en SU cuenta con el CFN llevan `aria:tier=tenant` (ver cfnTemplates.ts).
const TAGS_LIST = "Key=aria:product,Value=ARIA Key=aria:layer,Value=core Key=aria:tier,Value=platform"; // dynamodb, secrets, events
const TAGS_MAP = "aria:product=ARIA,aria:layer=core,aria:tier=platform"; // cognito, logs

const sh = (cmd) => execSync(cmd, { encoding: "utf8", env: { ...process.env, AWS_REGION: REGION } });
const j = (cmd) => JSON.parse(sh(cmd));

// ¿Es un recurso de ARIA? connectview-* (hand-managed) o amplify-...-connectview-...
const isAria = (name) => /connectview/i.test(name);

const summary = [];
function section(title, fn) {
  try {
    const n = fn();
    summary.push(`  ${title}: ${n} etiquetado(s)`);
  } catch (e) {
    summary.push(`  ${title}: ⚠️ ${String(e.message || e).split("\n")[0].slice(0, 80)}`);
  }
}

// ───────── DynamoDB ─────────
section("DynamoDB (tablas)", () => {
  const names = [];
  let start = null;
  do {
    const r = j(
      `aws dynamodb list-tables --region ${REGION} --output json` +
        (start ? ` --exclusive-start-table-name "${start}"` : ""),
    );
    names.push(...(r.TableNames || []));
    start = r.LastEvaluatedTableName || null;
  } while (start);
  const aria = names.filter(isAria);
  let n = 0;
  for (const name of aria) {
    const arn = `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${name}`;
    if (DRY) console.log(`[dry] dynamodb ${name}`);
    else sh(`aws dynamodb tag-resource --region ${REGION} --resource-arn "${arn}" --tags ${TAGS_LIST}`);
    n++;
  }
  return n;
});

// ───────── Secrets Manager (el costo fijo más grande) ─────────
section("Secrets Manager", () => {
  const secrets = [];
  let token = null;
  do {
    const r = j(
      `aws secretsmanager list-secrets --region ${REGION} --max-results 100 --output json` +
        (token ? ` --next-token "${token}"` : ""),
    );
    secrets.push(...(r.SecretList || []));
    token = r.NextToken || null;
  } while (token);
  // Secrets de ARIA: connectview/* (incl. connectview/tenant/<id>/*) y connectview/meta/salesforce.
  const aria = secrets.filter((s) => /^connectview\//i.test(s.Name) || isAria(s.Name));
  let n = 0;
  for (const s of aria) {
    if (DRY) console.log(`[dry] secret ${s.Name}`);
    else sh(`aws secretsmanager tag-resource --region ${REGION} --secret-id "${s.ARN}" --tags ${TAGS_LIST}`);
    n++;
  }
  return n;
});

// ───────── Cognito (user pool) ─────────
section("Cognito (user pool)", () => {
  const arn = `arn:aws:cognito-idp:${REGION}:${ACCOUNT_ID}:userpool/${POOL_ID}`;
  if (DRY) console.log(`[dry] cognito ${POOL_ID}`);
  else sh(`aws cognito-idp tag-resource --region ${REGION} --resource-arn "${arn}" --tags ${TAGS_MAP}`);
  return 1;
});

// ───────── CloudWatch Logs (log groups de las funciones) ─────────
section("CloudWatch Logs", () => {
  const groups = [];
  for (const prefix of ["/aws/lambda/connectview-", "/aws/lambda/amplify-connectview"]) {
    let token = null;
    do {
      const r = j(
        `aws logs describe-log-groups --region ${REGION} --log-group-name-prefix "${prefix}" --output json` +
          (token ? ` --next-token "${token}"` : ""),
      );
      groups.push(...(r.logGroups || []));
      token = r.nextToken || null;
    } while (token);
  }
  let n = 0;
  for (const g of groups) {
    // tag-resource necesita el ARN SIN el sufijo ":*"
    const arn = (g.arn || `arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:${g.logGroupName}`).replace(/:\*$/, "");
    if (DRY) console.log(`[dry] loggroup ${g.logGroupName}`);
    else sh(`aws logs tag-resource --region ${REGION} --resource-arn "${arn}" --tags ${TAGS_MAP}`);
    n++;
  }
  return n;
});

// ───────── EventBridge (rules de los crons) ─────────
section("EventBridge (rules)", () => {
  const rules = [];
  let token = null;
  do {
    const r = j(
      `aws events list-rules --region ${REGION} --output json` + (token ? ` --next-token "${token}"` : ""),
    );
    rules.push(...(r.Rules || []));
    token = r.NextToken || null;
  } while (token);
  // Rules de ARIA por nombre o por apuntar a un Lambda connectview-*.
  const aria = rules.filter((r) => {
    if (isAria(r.Name)) return true;
    try {
      const t = j(`aws events list-targets-by-rule --region ${REGION} --rule "${r.Name}" --output json`);
      return (t.Targets || []).some((tg) => isAria(tg.Arn || ""));
    } catch {
      return false;
    }
  });
  let n = 0;
  for (const r of aria) {
    if (DRY) console.log(`[dry] rule ${r.Name}`);
    else sh(`aws events tag-resource --region ${REGION} --resource-arn "${r.Arn}" --tags ${TAGS_LIST}`);
    n++;
  }
  return n;
});

// ───────── S3 (buckets de la plataforma) ─────────
section("S3 (buckets)", () => {
  const r = j(`aws s3api list-buckets --output json`);
  const aria = (r.Buckets || []).filter((b) => isAria(b.Name) || /^vox-/i.test(b.Name));
  let n = 0;
  for (const b of aria) {
    if (DRY) console.log(`[dry] s3 ${b.Name}`);
    else {
      // put-bucket-tagging REEMPLAZA todo el tag set → merge con lo existente.
      let existing = [];
      try {
        const cur = j(`aws s3api get-bucket-tagging --bucket "${b.Name}" --output json`);
        existing = (cur.TagSet || []).filter((t) => !t.Key.startsWith("aria:"));
      } catch {
        /* sin tags previos */
      }
      const tagSet = [
        ...existing,
        { Key: "aria:product", Value: "ARIA" },
        { Key: "aria:layer", Value: "core" },
      ];
      const payload = JSON.stringify({ TagSet: tagSet }).replace(/"/g, '\\"');
      sh(`aws s3api put-bucket-tagging --bucket "${b.Name}" --tagging "${payload}"`);
    }
    n++;
  }
  return n;
});

console.log(
  (DRY ? "\n=== DRY-RUN (nada aplicado) ===\n" : "\n=== APLICADO ===\n") + summary.join("\n"),
);
if (!DRY)
  console.log(
    "\n🔑 El cost allocation tag 'aria:product' ya está activo. Los recursos recién\n" +
      "   etiquetados aparecerán en el 'Real' de Cost Explorer en ~24 h (no retroactivo).",
  );
