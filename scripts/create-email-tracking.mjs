#!/usr/bin/env node
/**
 * create-email-tracking.mjs — provisiona el tracking de email 1:1 (Fase 4 · F4.4).
 * Idempotente.
 *   · DynamoDB connectview-email-tracking (PK=token, TTL en expiresAt)
 *   · IAM managed policy connectview-email-tracking-access → VoxCrmConnectAccess +
 *       admin-lambda-role
 *   · Lambda pública connectview-email-tracking (Function URL auth NONE + 2 permisos)
 *   · Fija el env EMAIL_TRACKING_URL + EMAIL_TRACKING_TABLE en el journey-runner
 *       (MERGE — preserva el resto del env)
 *
 * 🔑 GOTCHA: `connectview-campaign-lambda-role` (rol del runner + de esta Lambda)
 * está SATURADO (10 managed policies + 10KB inline). No admite el managed policy →
 * el acceso a la tabla se folded en su inline `LeadsAccess` (se agregó el ARN de
 * connectview-email-tracking a su Resource). Si recreás el rol, replicá ese fold.
 *
 * Uso: node scripts/create-email-tracking.mjs   (con el sandbox deshabilitado).
 */
import { execSync } from "node:child_process";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REGION = "us-east-1";
const ACCOUNT = "731736972577";
const ROLE = `arn:aws:iam::${ACCOUNT}:role/connectview-campaign-lambda-role`;
const FN = "connectview-email-tracking";
const TABLE = "connectview-email-tracking";
const POLICY_NAME = "connectview-email-tracking-access";
const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}`;
const RUNNER = "connectview-journey-runner";
// campaign-lambda-role NO va acá (saturado): su acceso a la tabla vive en el
// inline LeadsAccess (fold del ARN). Ver el 🔑 GOTCHA del encabezado.
const ATTACH_ROLES = ["VoxCrmConnectAccess", "connectview-admin-lambda-role"];

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const quiet = (cmd) => {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const log = (...a) => console.log(...a);
const tmpFile = (name, data) => {
  const p = join(mkdtempSync(join(tmpdir(), "et-")), name);
  writeFileSync(p, data);
  return p;
};

async function bundle(dir) {
  const tmp = mkdtempSync(join(tmpdir(), `et-${dir}-`));
  const outFile = join(tmp, "index.js");
  await esbuild.build({
    entryPoints: [join(ROOT, "amplify", "functions", dir, "handler.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: outFile,
    external: ["@aws-sdk/*", "aws-sdk", "node:*"],
    logLevel: "warning",
  });
  const zipPath = join(tmp, "bundle.zip");
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${outFile}' -DestinationPath '${zipPath}' -Force"`,
    { stdio: "ignore" },
  );
  log(`  📦 ${dir}: ${(statSync(zipPath).size / 1024).toFixed(1)} KB`);
  return zipPath;
}

(async () => {
  log("── Fase 4 · F4.4 email-tracking — provisioning ──\n");

  // 1) Tabla (PK=token, on-demand) + TTL.
  log(`1) Tabla ${TABLE}…`);
  const created = quiet(
    `aws dynamodb create-table --region ${REGION} --table-name ${TABLE} ` +
      `--attribute-definitions AttributeName=token,AttributeType=S ` +
      `--key-schema AttributeName=token,KeyType=HASH --billing-mode PAY_PER_REQUEST`,
  );
  if (created) quiet(`aws dynamodb wait table-exists --table-name ${TABLE} --region ${REGION}`);
  quiet(
    `aws dynamodb update-time-to-live --region ${REGION} --table-name ${TABLE} ` +
      `--time-to-live-specification "Enabled=true,AttributeName=expiresAt"`,
  );
  log(created ? "   ✅ creada + TTL" : "   (ya existía)");

  // 2) Managed policy (dynamodb sobre la tabla) + attach.
  log(`2) Policy ${POLICY_NAME}…`);
  const doc = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
        Resource: `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}`,
      },
    ],
  });
  quiet(`aws iam create-policy --policy-name ${POLICY_NAME} --policy-document file://${tmpFile("pol.json", doc)}`);
  for (const role of ATTACH_ROLES) {
    const ok = quiet(`aws iam attach-role-policy --role-name ${role} --policy-arn ${POLICY_ARN}`);
    log(`   ${ok ? "✅" : "⚠️ "} ${role}`);
  }

  // 3) Lambda pública email-tracking.
  log("3) Lambda email-tracking…");
  const zip = await bundle("email-tracking");
  const envJson = JSON.stringify({
    Variables: { EMAIL_TRACKING_TABLE: TABLE, LEADS_TABLE: "connectview-leads" },
  });
  const envFile = tmpFile("env.json", envJson);
  if (quiet(`aws lambda get-function --function-name ${FN} --region ${REGION}`)) {
    sh(`aws lambda update-function-code --function-name ${FN} --zip-file fileb://${zip} --region ${REGION} --no-cli-pager`);
    quiet(`aws lambda wait function-updated --function-name ${FN} --region ${REGION}`);
    sh(`aws lambda update-function-configuration --function-name ${FN} --environment file://${envFile} --region ${REGION} --no-cli-pager`);
    log(`   ✅ ${FN} (actualizado)`);
  } else {
    sh(`aws lambda create-function --function-name ${FN} --runtime nodejs20.x --role ${ROLE} --handler index.handler --zip-file fileb://${zip} --timeout 30 --memory-size 256 --environment file://${envFile} --region ${REGION} --no-cli-pager`);
    quiet(`aws lambda wait function-active --function-name ${FN} --region ${REGION}`);
    log(`   ✅ ${FN} (creado)`);
  }

  // 4) Function URL pública (auth NONE) + 2 permisos.
  log("4) Function URL pública…");
  quiet(`aws lambda create-function-url-config --function-name ${FN} --auth-type NONE --region ${REGION}`);
  quiet(
    `aws lambda add-permission --function-name ${FN} --statement-id FnUrlPublic --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE --region ${REGION}`,
  );
  quiet(
    `aws lambda add-permission --function-name ${FN} --statement-id FnUrlInvoke --action lambda:InvokeFunction --principal "*" --region ${REGION}`,
  );
  const url = sh(
    `aws lambda get-function-url-config --function-name ${FN} --region ${REGION} --query FunctionUrl --output text`,
  ).replace(/\/$/, "");
  log(`   ✅ ${url}`);

  // 5) Cablear EMAIL_TRACKING_URL + EMAIL_TRACKING_TABLE en el journey-runner (MERGE).
  log("5) Env del journey-runner (EMAIL_TRACKING_URL)…");
  const cur = JSON.parse(
    sh(`aws lambda get-function-configuration --function-name ${RUNNER} --region ${REGION} --query "Environment.Variables" --output json`) || "{}",
  );
  const merged = { ...cur, EMAIL_TRACKING_URL: url, EMAIL_TRACKING_TABLE: TABLE };
  const runnerEnvFile = tmpFile("runner-env.json", JSON.stringify({ Variables: merged }));
  sh(`aws lambda update-function-configuration --function-name ${RUNNER} --environment file://${runnerEnvFile} --region ${REGION} --no-cli-pager`);
  quiet(`aws lambda wait function-updated --function-name ${RUNNER} --region ${REGION}`);
  log("   ✅ runner cableado");

  log(`\nListo. Endpoint de tracking: ${url}`);
  log("  Pixel:  GET {url}/pixel?t=<token>");
  log("  Click:  GET {url}/click?t=<token>&u=<url>");
})();
