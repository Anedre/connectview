#!/usr/bin/env node
/**
 * create-programs.mjs — provisiona la infra del Pilar 1 ("Programa" como objeto
 * operativo). Idempotente: crea-o-actualiza. Recursos (connectview-*, us-east-1,
 * rol compartido connectview-campaign-lambda-role):
 *
 *   · DynamoDB connectview-programs        (PK=programId)
 *   · DynamoDB connectview-lead-programs   (PK=programId, SK=leadId, GSI byLead) — membership N:N
 *   · Lambda   connectview-manage-programs (Function URL pública + CORS)
 *   · IAM inline policy (dynamodb sobre ambas tablas + índices) en el rol compartido
 *
 * Uso: node scripts/create-programs.mjs
 * Tras correrlo: pegar la Function URL en amplify_outputs.json → custom.apiEndpoints.managePrograms
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
const ROLE_NAME = "connectview-campaign-lambda-role";

const PROGRAMS = "connectview-programs";
const MEMBERSHIP = "connectview-lead-programs";
const FN = "connectview-manage-programs";

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const tryjson = (cmd) => { try { return JSON.parse(sh(cmd)); } catch { return null; } };
const quiet = (cmd) => { try { execSync(cmd, { stdio: "ignore" }); return true; } catch { return false; } };
const log = (...a) => console.log(...a);

function writeTmp(name, obj) {
  const p = join(mkdtempSync(join(tmpdir(), "prg-")), name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
}

async function bundle(dir) {
  const entry = join(ROOT, "amplify", "functions", dir, "handler.ts");
  const tmp = mkdtempSync(join(tmpdir(), `prg-${dir}-`));
  const outFile = join(tmp, "index.js");
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: "node", target: "node20",
    format: "cjs", outfile: outFile, external: ["@aws-sdk/*", "aws-sdk", "node:*"],
    logLevel: "warning",
  });
  const zipPath = join(tmp, "bundle.zip");
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${outFile}' -DestinationPath '${zipPath}' -Force"`, { stdio: "ignore" });
  log(`  📦 ${dir}: ${(statSync(zipPath).size / 1024).toFixed(1)} KB`);
  return zipPath;
}

async function ensureLambda(name, dir, envObj, timeout = 15) {
  const zip = await bundle(dir);
  const exists = quiet(`aws lambda get-function --function-name ${name} --region ${REGION}`);
  const envFile = writeTmp("env.json", { Variables: envObj });
  if (exists) {
    sh(`aws lambda update-function-code --function-name ${name} --zip-file fileb://${zip} --region ${REGION} --no-cli-pager`);
    quiet(`aws lambda wait function-updated --function-name ${name} --region ${REGION}`);
    sh(`aws lambda update-function-configuration --function-name ${name} --environment file://${envFile} --timeout ${timeout} --region ${REGION} --no-cli-pager`);
    log(`  ✅ ${name} (actualizado)`);
  } else {
    sh(`aws lambda create-function --function-name ${name} --runtime nodejs20.x --role ${ROLE} --handler index.handler --zip-file fileb://${zip} --timeout ${timeout} --memory-size 256 --environment file://${envFile} --region ${REGION} --no-cli-pager`);
    quiet(`aws lambda wait function-active --function-name ${name} --region ${REGION}`);
    log(`  ✅ ${name} (creado)`);
  }
}

(async () => {
  log("── Pilar 1 · programas — provisioning ──\n");

  // 1) tabla connectview-programs (PK=programId)
  log("1) DynamoDB connectview-programs…");
  if (!quiet(`aws dynamodb describe-table --table-name ${PROGRAMS} --region ${REGION}`)) {
    sh([
      "aws dynamodb create-table",
      `--table-name ${PROGRAMS}`,
      "--attribute-definitions AttributeName=programId,AttributeType=S",
      "--key-schema AttributeName=programId,KeyType=HASH",
      "--billing-mode PAY_PER_REQUEST",
      `--region ${REGION} --no-cli-pager`,
    ].join(" "));
    quiet(`aws dynamodb wait table-exists --table-name ${PROGRAMS} --region ${REGION}`);
    log(`   tabla ${PROGRAMS} creada`);
  } else {
    log(`   tabla ${PROGRAMS} ya existe`);
  }

  // 2) tabla membership connectview-lead-programs (PK=programId, SK=leadId, GSI byLead)
  log("2) DynamoDB connectview-lead-programs (membership N:N)…");
  if (!quiet(`aws dynamodb describe-table --table-name ${MEMBERSHIP} --region ${REGION}`)) {
    sh([
      "aws dynamodb create-table",
      `--table-name ${MEMBERSHIP}`,
      "--attribute-definitions AttributeName=programId,AttributeType=S AttributeName=leadId,AttributeType=S",
      "--key-schema AttributeName=programId,KeyType=HASH AttributeName=leadId,KeyType=RANGE",
      "--billing-mode PAY_PER_REQUEST",
      `--global-secondary-indexes "IndexName=byLead,KeySchema=[{AttributeName=leadId,KeyType=HASH}],Projection={ProjectionType=ALL}"`,
      `--region ${REGION} --no-cli-pager`,
    ].join(" "));
    quiet(`aws dynamodb wait table-exists --table-name ${MEMBERSHIP} --region ${REGION}`);
    log(`   tabla ${MEMBERSHIP} creada`);
  } else {
    log(`   tabla ${MEMBERSHIP} ya existe`);
  }

  const programsArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${PROGRAMS}`;
  const membershipArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${MEMBERSHIP}`;

  // 3) IAM: managed policy (el rol compartido ya llegó al límite de 10KB de
  //    políticas INLINE; una managed adjunta no cuenta contra ese límite).
  log("3) IAM (managed policy)…");
  const POLICY_NAME = "connectview-programs-access";
  const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}`;
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchWriteItem"],
        Resource: [programsArn, `${programsArn}/index/*`, membershipArn, `${membershipArn}/index/*`],
      },
    ],
  };
  const polFile = writeTmp("policy.json", policy);
  if (quiet(`aws iam get-policy --policy-arn ${POLICY_ARN}`)) {
    // ya existe → nueva versión default (IAM permite máx 5 versiones; podamos la más vieja)
    const vers = tryjson(`aws iam list-policy-versions --policy-arn ${POLICY_ARN}`);
    const nonDefault = (vers?.Versions || []).filter((v) => !v.IsDefaultVersion);
    if (nonDefault.length >= 4) {
      const oldest = nonDefault.sort((a, b) => new Date(a.CreateDate) - new Date(b.CreateDate))[0];
      quiet(`aws iam delete-policy-version --policy-arn ${POLICY_ARN} --version-id ${oldest.VersionId}`);
    }
    sh(`aws iam create-policy-version --policy-arn ${POLICY_ARN} --policy-document file://${polFile} --set-as-default`);
    log("   managed policy actualizada (nueva versión default)");
  } else {
    sh(`aws iam create-policy --policy-name ${POLICY_NAME} --policy-document file://${polFile}`);
    log("   managed policy creada");
  }
  quiet(`aws iam attach-role-policy --role-name ${ROLE_NAME} --policy-arn ${POLICY_ARN}`);
  // ⚠️ En runtime, las llamadas a DynamoDB las hace el rol ASUMIDO del tenant
  // (VoxCrmConnectAccess vía resolveDynamo), no el rol de ejecución del Lambda.
  // Sin esto, el navegador autenticado da AccessDenied (el curl anónimo lo enmascara).
  quiet(`aws iam attach-role-policy --role-name VoxCrmConnectAccess --policy-arn ${POLICY_ARN}`);
  log("   managed policy adjunta a connectview-campaign-lambda-role + VoxCrmConnectAccess");

  // 4) Lambda manage-programs + Function URL pública
  log("4) Lambda connectview-manage-programs…");
  await ensureLambda(FN, "manage-programs", { PROGRAMS_TABLE: PROGRAMS, LEAD_PROGRAMS_TABLE: MEMBERSHIP }, 15);
  let furl = tryjson(`aws lambda get-function-url-config --function-name ${FN} --region ${REGION}`);
  if (!furl) {
    furl = tryjson(`aws lambda create-function-url-config --function-name ${FN} --auth-type NONE --cors "AllowOrigins=*,AllowMethods=*,AllowHeaders=*" --region ${REGION}`);
    // Function URL pública requiere AMBOS statements (gotcha de la cuenta): si falta el 2º → 403.
    quiet(`aws lambda add-permission --function-name ${FN} --statement-id FunctionURLAllowPublicAccess --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE --region ${REGION}`);
    quiet(`aws lambda add-permission --function-name ${FN} --statement-id AllowInvokeFromURL --action lambda:InvokeFunction --principal "*" --region ${REGION}`);
  }
  const url = furl?.FunctionUrl || "(re-correr para ver la URL)";

  // 5) Lambda program-tick + EventBridge (auto-archivado de programas vencidos)
  log("5) Lambda connectview-program-tick (auto-archive, EventBridge 1h)…");
  await ensureLambda("connectview-program-tick", "program-tick", { PROGRAMS_TABLE: PROGRAMS }, 30);
  const TICK_RULE = "connectview-program-tick-rule";
  sh(`aws events put-rule --name ${TICK_RULE} --schedule-expression "rate(1 hour)" --region ${REGION} --no-cli-pager`);
  quiet(`aws lambda add-permission --function-name connectview-program-tick --statement-id ${TICK_RULE} --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn arn:aws:events:${REGION}:${ACCOUNT}:rule/${TICK_RULE} --region ${REGION}`);
  const tgt = writeTmp("tick-targets.json", [{ Id: "tick", Arn: `arn:aws:lambda:${REGION}:${ACCOUNT}:function:connectview-program-tick`, Input: "{}" }]);
  sh(`aws events put-targets --rule ${TICK_RULE} --targets file://${tgt} --region ${REGION} --no-cli-pager`);
  log("   tick EventBridge (1h) → program-tick");

  log("\n╔══════════════════════════════════════════════");
  log(`║ ✅ ${FN}`);
  log(`║ URL: ${url}`);
  log("╚══════════════════════════════════════════════");
  log("→ Pegar en amplify_outputs.json · custom.apiEndpoints.managePrograms");
})().catch((e) => { console.error("❌", e.message || e); process.exit(1); });
