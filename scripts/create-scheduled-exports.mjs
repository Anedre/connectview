#!/usr/bin/env node
/**
 * create-scheduled-exports.mjs — provisiona la infra de #7 (exports programados).
 * Idempotente. Recursos (connectview-*, us-east-1, rol compartido):
 *
 *   · DynamoDB connectview-scheduled-exports (PK exportId)
 *   · Lambda connectview-scheduled-export-runner  (tick EventBridge 1h + runNow)
 *   · Lambda connectview-manage-scheduled-exports (Function URL pública · CRUD)
 *   · IAM inline policy (ses:SendEmail + dynamodb + lambda:InvokeFunction)
 *
 * Uso: node scripts/create-scheduled-exports.mjs
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

const TABLE = "connectview-scheduled-exports";
const RUNNER = "connectview-scheduled-export-runner";
const MANAGER = "connectview-manage-scheduled-exports";
const TICK_RULE = "connectview-scheduled-exports-tick";
const FROM_EMAIL = "ARIA Reportes <reportes@novasys.com.pe>";

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const tryjson = (cmd) => { try { return JSON.parse(sh(cmd)); } catch { return null; } };
const quiet = (cmd) => { try { execSync(cmd, { stdio: "ignore" }); return true; } catch { return false; } };
const log = (...a) => console.log(...a);
function writeTmp(name, obj) {
  const p = join(mkdtempSync(join(tmpdir(), "se-")), name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
}
async function bundle(dir) {
  const entry = join(ROOT, "amplify", "functions", dir, "handler.ts");
  const tmp = mkdtempSync(join(tmpdir(), `se-${dir}-`));
  const outFile = join(tmp, "index.js");
  // exceljs se BUNDLEA (no es @aws-sdk); los @aws-sdk los provee el runtime.
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: "node", target: "node20",
    format: "cjs", outfile: outFile, external: ["@aws-sdk/*", "aws-sdk", "node:*"],
    logLevel: "error",
  });
  const zipPath = join(tmp, "bundle.zip");
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${outFile}' -DestinationPath '${zipPath}' -Force"`, { stdio: "ignore" });
  log(`  📦 ${dir}: ${(statSync(zipPath).size / 1024).toFixed(1)} KB`);
  return zipPath;
}
async function ensureLambda(name, dir, envObj, timeout, memory) {
  const zip = await bundle(dir);
  const exists = quiet(`aws lambda get-function --function-name ${name} --region ${REGION}`);
  const envFile = writeTmp("env.json", { Variables: envObj });
  if (exists) {
    sh(`aws lambda update-function-code --function-name ${name} --zip-file fileb://${zip} --region ${REGION} --no-cli-pager`);
    quiet(`aws lambda wait function-updated --function-name ${name} --region ${REGION}`);
    sh(`aws lambda update-function-configuration --function-name ${name} --environment file://${envFile} --timeout ${timeout} --memory-size ${memory} --region ${REGION} --no-cli-pager`);
    log(`  ✅ ${name} (actualizado)`);
  } else {
    sh(`aws lambda create-function --function-name ${name} --runtime nodejs20.x --role ${ROLE} --handler index.handler --zip-file fileb://${zip} --timeout ${timeout} --memory-size ${memory} --environment file://${envFile} --region ${REGION} --no-cli-pager`);
    quiet(`aws lambda wait function-active --function-name ${name} --region ${REGION}`);
    log(`  ✅ ${name} (creado)`);
  }
}

(async () => {
  log("── #7 exports programados — provisioning ──\n");

  // 1) tabla
  log("1) DynamoDB…");
  if (!quiet(`aws dynamodb describe-table --table-name ${TABLE} --region ${REGION}`)) {
    sh(`aws dynamodb create-table --table-name ${TABLE} --attribute-definitions AttributeName=exportId,AttributeType=S --key-schema AttributeName=exportId,KeyType=HASH --billing-mode PAY_PER_REQUEST --region ${REGION} --no-cli-pager`);
    quiet(`aws dynamodb wait table-exists --table-name ${TABLE} --region ${REGION}`);
    log(`   ${TABLE} creada`);
  } else log(`   ${TABLE} ya existe`);
  const tableArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}`;
  const leadsArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/connectview-leads`;
  const runnerArn = `arn:aws:lambda:${REGION}:${ACCOUNT}:function:${RUNNER}`;

  // 2) IAM
  log("2) IAM…");
  const policy = {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["ses:SendEmail", "ses:SendRawEmail"], Resource: "*" },
      { Effect: "Allow", Action: ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Scan"], Resource: [tableArn, leadsArn] },
      { Effect: "Allow", Action: ["lambda:InvokeFunction"], Resource: [runnerArn] },
    ],
  };
  sh(`aws iam put-role-policy --role-name ${ROLE_NAME} --policy-name connectview-scheduled-exports --policy-document file://${writeTmp("p.json", policy)}`);
  log("   policy connectview-scheduled-exports adjunta");

  // 3) runner (+ tick)
  log("3) runner…");
  await ensureLambda(RUNNER, "scheduled-export-runner", { EXPORTS_TABLE: TABLE, LEADS_TABLE: "connectview-leads", FROM_EMAIL }, 120, 512);
  sh(`aws events put-rule --name ${TICK_RULE} --schedule-expression "rate(1 hour)" --region ${REGION} --no-cli-pager`);
  quiet(`aws lambda add-permission --function-name ${RUNNER} --statement-id ${TICK_RULE} --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn arn:aws:events:${REGION}:${ACCOUNT}:rule/${TICK_RULE} --region ${REGION}`);
  sh(`aws events put-targets --rule ${TICK_RULE} --targets file://${writeTmp("t.json", [{ Id: "runner", Arn: runnerArn, Input: "{}" }])} --region ${REGION} --no-cli-pager`);
  log("   tick EventBridge (1 h) → runner");

  // 4) manager (+ Function URL)
  log("4) manager…");
  await ensureLambda(MANAGER, "manage-scheduled-exports", { EXPORTS_TABLE: TABLE, RUNNER_FUNCTION: RUNNER }, 30, 256);
  let furl = tryjson(`aws lambda get-function-url-config --function-name ${MANAGER} --region ${REGION}`);
  if (!furl) {
    furl = tryjson(`aws lambda create-function-url-config --function-name ${MANAGER} --auth-type NONE --cors "AllowOrigins=*,AllowMethods=*,AllowHeaders=*" --region ${REGION}`);
    // 2 permisos para la Function URL pública (gotcha de la cuenta).
    quiet(`aws lambda add-permission --function-name ${MANAGER} --statement-id FunctionURLAllowPublicAccess --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE --region ${REGION}`);
    quiet(`aws lambda add-permission --function-name ${MANAGER} --statement-id AllowInvokeFromURL --action lambda:InvokeFunction --principal "*" --region ${REGION}`);
  }
  const url = furl?.FunctionUrl || "(re-correr para ver la URL)";

  log("\n✅ Provisioning completo.");
  log(`   manageScheduledExports URL → ${url}`);
})().catch((e) => { console.error("❌", e.message || e); process.exit(1); });
