#!/usr/bin/env node
/**
 * create-journeys.mjs — provisiona el motor de Journeys (Fase 3 · 3A). Idempotente.
 *   · DynamoDB connectview-journeys (PK=tenantId, SK=journeyId)
 *   · DynamoDB connectview-journey-enrollments (PK=journeyId, SK=leadId)
 *   · IAM connectview-journeys-access → VoxCrmConnectAccess + campaign/admin-lambda-role
 *   · Lambda connectview-journey-runner (rol campaign-lambda-role, EventBridge-driven)
 *   · EventBridge rule connectview-journey-tick rate(5 min) → journey-runner
 *
 * El CRUD de journeys + el enrol manual están FOLDED en manage-leads. Uso:
 * node scripts/create-journeys.mjs  (con el sandbox deshabilitado).
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
const FN = "connectview-journey-runner";
const RULE = "connectview-journey-tick";

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

async function bundle(dir) {
  const tmp = mkdtempSync(join(tmpdir(), `jr-${dir}-`));
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
  log("── Fase 3 · journey-runner — provisioning ──\n");

  // 1) Lambda journey-runner
  log("1) Lambda journey-runner…");
  const zip = await bundle("journey-runner");
  if (quiet(`aws lambda get-function --function-name ${FN} --region ${REGION}`)) {
    sh(`aws lambda update-function-code --function-name ${FN} --zip-file fileb://${zip} --region ${REGION} --no-cli-pager`);
    quiet(`aws lambda wait function-updated --function-name ${FN} --region ${REGION}`);
    log(`   ✅ ${FN} (actualizado)`);
  } else {
    sh(`aws lambda create-function --function-name ${FN} --runtime nodejs20.x --role ${ROLE} --handler index.handler --zip-file fileb://${zip} --timeout 300 --memory-size 256 --region ${REGION} --no-cli-pager`);
    quiet(`aws lambda wait function-active --function-name ${FN} --region ${REGION}`);
    log(`   ✅ ${FN} (creado)`);
  }
  const fnArn = sh(`aws lambda get-function --function-name ${FN} --region ${REGION} --query Configuration.FunctionArn --output text`);

  // 1b) Env (Fase 3C): el runner ahora ENVÍA de verdad. Copiamos la Function URL
  //     del send-whatsapp-template + el secreto interno del automation-engine (así
  //     no hardcodeamos el secreto acá) y fijamos FROM_EMAIL para el canal email.
  //     El gate de supresión lo aplica send-whatsapp-template; SES ya está en el rol.
  log("1b) Env del runner (SEND_WHATSAPP_TEMPLATE_URL + VOX_INTERNAL_SECRET + FROM_EMAIL)…");
  const autoEnv = JSON.parse(
    sh(`aws lambda get-function-configuration --function-name connectview-automation-engine --region ${REGION} --query "Environment.Variables" --output json`),
  );
  const runnerVars = {
    SEND_WHATSAPP_TEMPLATE_URL: autoEnv.SEND_WHATSAPP_TEMPLATE_URL || "",
    VOX_INTERNAL_SECRET: autoEnv.VOX_INTERNAL_SECRET || "",
    FROM_EMAIL: "ARIA <notificaciones@novasys.com.pe>",
  };
  const envFile = join(mkdtempSync(join(tmpdir(), "jr-env-")), "env.json");
  writeFileSync(envFile, JSON.stringify({ Variables: runnerVars }));
  sh(`aws lambda update-function-configuration --function-name ${FN} --environment file://${envFile} --region ${REGION} --no-cli-pager`);
  quiet(`aws lambda wait function-updated --function-name ${FN} --region ${REGION}`);
  log(`   ✅ env fijado (WA url ${runnerVars.SEND_WHATSAPP_TEMPLATE_URL ? "ok" : "FALTA"})`);

  // 2) EventBridge rule rate(5 min) → journey-runner
  log("2) EventBridge rule connectview-journey-tick (rate 5 min)…");
  sh(`aws events put-rule --name ${RULE} --schedule-expression "rate(5 minutes)" --state ENABLED --region ${REGION} --no-cli-pager`);
  const ruleArn = sh(`aws events describe-rule --name ${RULE} --region ${REGION} --query Arn --output text`);
  quiet(`aws lambda add-permission --function-name ${FN} --statement-id ${RULE}-invoke --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn ${ruleArn} --region ${REGION} --no-cli-pager`);
  sh(`aws events put-targets --rule ${RULE} --targets "Id"="1","Arn"="${fnArn}" --region ${REGION} --no-cli-pager`);
  log(`   ✅ rule → ${FN}`);

  log("\nListo. El runner corre cada 5 min; forzá un tick con:");
  log(`  aws lambda invoke --function-name ${FN} --payload '{"nowMs":<ms>}' --cli-binary-format raw-in-base64-out out.json --region ${REGION}`);
})();
