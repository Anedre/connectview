#!/usr/bin/env node
/**
 * create-workflow-engine.mjs — provisiona el MOTOR UNIFICADO de Flujos (Fase 2),
 * en modo BUILD-AHEAD INERTE. Idempotente.
 *
 *   · DynamoDB connectview-workflows              (PK=tenantId, SK=workflowId)
 *   · DynamoDB connectview-workflow-enrollments   (PK=workflowId, SK=leadId)
 *   · IAM managed policy connectview-workflows-access (dynamodb sobre las 2
 *       tablas + leads + segments).
 *   · IAM rol PROPIO connectview-workflow-engine-role (trust lambda) con esa
 *       policy + logs. Rol propio porque connectview-campaign-lambda-role está
 *       LLENO (10/10 managed + 10KB inline) — ver [[reference_new_lambda_iam]].
 *   · Lambda connectview-workflow-engine desde amplify/functions/workflow-engine.
 *
 * ⚠️ INERTE a propósito: SIN Function URL (nadie lo invoca por HTTP), SIN tick de
 * EventBridge (no corre solo), y con DRY_RUN=true (no envía nada aunque se invoque
 * a mano). Ningún producer lo conoce. Se prueba con `aws lambda invoke`. El
 * switchover (Function URL + tick + DRY_RUN=false + redirigir producers) es un
 * paso posterior GATEADO tras la verificación E2E de la Fase 1.
 *
 * Uso: node scripts/create-workflow-engine.mjs
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REGION = "us-east-1";
const ACCOUNT = "731736972577";
const FN = "connectview-workflow-engine";
const T_WORKFLOWS = "connectview-workflows";
const T_ENROLLMENTS = "connectview-workflow-enrollments";
const POLICY_NAME = "connectview-workflows-access";
const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}`;
const ENGINE_ROLE = "connectview-workflow-engine-role";
const ROLE_ARN = `arn:aws:iam::${ACCOUNT}:role/${ENGINE_ROLE}`;
const LEADS_ARN = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/connectview-leads`;
const SEGMENTS_ARN = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/connectview-segments`;

const quiet = (cmd) => {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const capture = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const log = (...a) => console.log(...a);

// ── 1. Tablas ────────────────────────────────────────────────────────────────
log(`· Tabla ${T_WORKFLOWS} (PK=tenantId, SK=workflowId)…`);
log(
  quiet(
    `aws dynamodb create-table --region ${REGION} --table-name ${T_WORKFLOWS} ` +
      `--attribute-definitions AttributeName=tenantId,AttributeType=S AttributeName=workflowId,AttributeType=S ` +
      `--key-schema AttributeName=tenantId,KeyType=HASH AttributeName=workflowId,KeyType=RANGE ` +
      `--billing-mode PAY_PER_REQUEST`,
  )
    ? "  creada"
    : "  (ya existía)",
);
log(`· Tabla ${T_ENROLLMENTS} (PK=workflowId, SK=leadId)…`);
log(
  quiet(
    `aws dynamodb create-table --region ${REGION} --table-name ${T_ENROLLMENTS} ` +
      `--attribute-definitions AttributeName=workflowId,AttributeType=S AttributeName=leadId,AttributeType=S ` +
      `--key-schema AttributeName=workflowId,KeyType=HASH AttributeName=leadId,KeyType=RANGE ` +
      `--billing-mode PAY_PER_REQUEST`,
  )
    ? "  creada"
    : "  (ya existía)",
);

// ── 2. IAM policy + rol propio (docs por file:// → robusto en cualquier shell) ─
const scratch = mkdtempSync(join(tmpdir(), "wf-iam-"));
const DDB_ACTIONS = [
  "dynamodb:GetItem",
  "dynamodb:PutItem",
  "dynamodb:DeleteItem",
  "dynamodb:Query",
  "dynamodb:Scan",
  "dynamodb:UpdateItem",
];
const TABLES_ARN = [
  `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${T_WORKFLOWS}`,
  `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${T_ENROLLMENTS}`,
  LEADS_ARN,
  SEGMENTS_ARN,
];
const docPath = join(scratch, "policy.json");
writeFileSync(
  docPath,
  JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Action: DDB_ACTIONS, Resource: TABLES_ARN }],
  }),
);
log(`· Policy ${POLICY_NAME} (workflows + enrollments + leads + segments)…`);
if (quiet(`aws iam create-policy --policy-name ${POLICY_NAME} --policy-document file://${docPath}`)) {
  log("  creada");
} else {
  // Ya existe → asegurar que la versión default cubra las 4 tablas.
  quiet(
    `aws iam create-policy-version --policy-arn ${POLICY_ARN} --policy-document file://${docPath} --set-as-default`,
  );
  log("  (actualizada)");
}

// Rol PROPIO (campaign-lambda-role está lleno). Trust = lambda.
log(`· Rol ${ENGINE_ROLE}…`);
const trustPath = join(scratch, "trust.json");
writeFileSync(
  trustPath,
  JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" },
    ],
  }),
);
log(
  quiet(
    `aws iam create-role --role-name ${ENGINE_ROLE} --assume-role-policy-document file://${trustPath}`,
  )
    ? "  creado"
    : "  (ya existía)",
);
quiet(`aws iam attach-role-policy --role-name ${ENGINE_ROLE} --policy-arn ${POLICY_ARN}`);
quiet(
  `aws iam attach-role-policy --role-name ${ENGINE_ROLE} --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`,
);
log("  policies adjuntas (tablas + logs)");

// ── 3. Lambda (bundle + create/update), INERTE ───────────────────────────────
async function bundle() {
  const entry = join(ROOT, "amplify", "functions", "workflow-engine", "handler.ts");
  if (!existsSync(entry)) throw new Error(`No existe: ${entry}`);
  const tmp = mkdtempSync(join(tmpdir(), "wf-engine-"));
  const outFile = join(tmp, "index.js");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: outFile,
    external: ["@aws-sdk/*", "aws-sdk", "node:*"],
    logLevel: "warning",
  });
  const zipPath = join(tmp, "bundle.zip");
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${outFile}' -DestinationPath '${zipPath}' -Force"`,
      { stdio: "ignore" },
    );
  } else {
    execSync(`cd ${tmp} && zip -j ${zipPath} ${outFile}`, { stdio: "ignore" });
  }
  return { zipPath, size: statSync(zipPath).size, tmp };
}

let tmpDir = null;
try {
  log(`📦 Bundling workflow-engine…`);
  const { zipPath, size, tmp } = await bundle();
  tmpDir = tmp;
  log(`   bundle: ${(size / 1024).toFixed(1)} KB`);

  const exists = quiet(`aws lambda get-function --function-name ${FN} --region ${REGION}`);
  if (exists) {
    log(`♻️  ${FN} ya existe → update-function-code + config (DRY_RUN=true)…`);
    capture(
      `aws lambda update-function-code --region ${REGION} --function-name ${FN} --zip-file fileb://${zipPath} --no-cli-pager --output json`,
    );
    // Espera a que el update de código asiente antes de tocar la config.
    quiet(`aws lambda wait function-updated --region ${REGION} --function-name ${FN}`);
    capture(
      `aws lambda update-function-configuration --region ${REGION} --function-name ${FN} ` +
        `--timeout 300 --memory-size 256 --environment "Variables={DRY_RUN=true}" --no-cli-pager --output json`,
    );
    log(`   ✅ actualizado (INERTE, DRY_RUN=true)`);
  } else {
    log(`🚀 create-function ${FN} (INERTE: sin Function URL, sin tick, DRY_RUN=true)…`);
    const created = JSON.parse(
      capture(
        `aws lambda create-function --region ${REGION} --function-name ${FN} ` +
          `--runtime nodejs20.x --role ${ROLE_ARN} --handler index.handler ` +
          `--zip-file fileb://${zipPath} --timeout 300 --memory-size 256 ` +
          `--environment "Variables={DRY_RUN=true}" --no-cli-pager --output json`,
      ),
    );
    log(`   ✅ ${created.FunctionArn} (${created.State})`);
  }
  log("\n╔══════════════════════════════════════════════");
  log(`║ ✅ ${FN} — BUILD-AHEAD INERTE`);
  log(`║ Sin Function URL · sin tick · DRY_RUN=true`);
  log(`║ Probar: aws lambda invoke con {event:{...}} o {} (tick)`);
  log("╚══════════════════════════════════════════════");
} catch (err) {
  console.error("❌ Falló:", err.message || err);
  process.exitCode = 1;
} finally {
  if (tmpDir) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
