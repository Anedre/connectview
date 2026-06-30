#!/usr/bin/env node
/**
 * create-whatsapp-analytics.mjs — provisiona el pull de analytics de Meta
 * (Pilar 4 · Fase C). Idempotente.
 *
 *   · Lambda   connectview-get-whatsapp-analytics  (Function URL pública + CORS)
 *   · IAM managed policy connectview-whatsapp-analytics-access (secretsmanager read
 *       del token Meta) adjunta a connectview-campaign-lambda-role.
 *
 * Env del Lambda: WHATSAPP_ANALYTICS_WABA_ID (WABA Cloud API de Novasys),
 *                 WHATSAPP_TOKEN_SECRET (default "WhatsAppKeyPin").
 *
 * Uso: node scripts/create-whatsapp-analytics.mjs   (con el sandbox deshabilitado)
 * Tras correrlo: pegar la Function URL en amplify_outputs.json → custom.apiEndpoints.getWhatsAppAnalytics
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

const FN = "connectview-get-whatsapp-analytics";
const POLICY_NAME = "connectview-whatsapp-analytics-access";
const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}`;
const TOKEN_SECRET = "WhatsAppKeyPin";
const WABA_ID = "422335910956659"; // WABA Cloud API de Novasys (+51 908 825 660)

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const tryjson = (cmd) => { try { return JSON.parse(sh(cmd)); } catch { return null; } };
const quiet = (cmd) => { try { execSync(cmd, { stdio: "ignore" }); return true; } catch { return false; } };
const log = (...a) => console.log(...a);

function writeTmp(name, obj) {
  const p = join(mkdtempSync(join(tmpdir(), "waa-")), name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
}

async function bundle(dir) {
  const entry = join(ROOT, "amplify", "functions", dir, "handler.ts");
  const tmp = mkdtempSync(join(tmpdir(), `waa-${dir}-`));
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

async function ensureLambda(name, dir, envObj, timeout = 30) {
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
  log("── Pilar 4 · analytics de WhatsApp (Meta pull) — provisioning ──\n");

  // 1) IAM managed policy (secretsmanager read del token) + attach
  log("1) IAM (secretsmanager read)…");
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:${TOKEN_SECRET}*`,
      },
    ],
  };
  const polFile = writeTmp("policy.json", policy);
  if (quiet(`aws iam get-policy --policy-arn ${POLICY_ARN}`)) {
    const vers = tryjson(`aws iam list-policy-versions --policy-arn ${POLICY_ARN}`);
    const nonDefault = (vers?.Versions || []).filter((v) => !v.IsDefaultVersion);
    if (nonDefault.length >= 4) {
      const oldest = nonDefault.sort((a, b) => new Date(a.CreateDate) - new Date(b.CreateDate))[0];
      quiet(`aws iam delete-policy-version --policy-arn ${POLICY_ARN} --version-id ${oldest.VersionId}`);
    }
    sh(`aws iam create-policy-version --policy-arn ${POLICY_ARN} --policy-document file://${polFile} --set-as-default`);
    log("   managed policy actualizada");
  } else {
    sh(`aws iam create-policy --policy-name ${POLICY_NAME} --policy-document file://${polFile}`);
    log("   managed policy creada");
  }
  quiet(`aws iam attach-role-policy --role-name connectview-campaign-lambda-role --policy-arn ${POLICY_ARN}`);
  log("   adjunta a connectview-campaign-lambda-role");

  // 2) Lambda + Function URL pública
  log("2) Lambda connectview-get-whatsapp-analytics…");
  await ensureLambda(FN, "get-whatsapp-analytics", { WHATSAPP_ANALYTICS_WABA_ID: WABA_ID, WHATSAPP_TOKEN_SECRET: TOKEN_SECRET }, 30);
  let furl = tryjson(`aws lambda get-function-url-config --function-name ${FN} --region ${REGION}`);
  if (!furl) {
    furl = tryjson(`aws lambda create-function-url-config --function-name ${FN} --auth-type NONE --cors "AllowOrigins=*,AllowMethods=*,AllowHeaders=*" --region ${REGION}`);
    quiet(`aws lambda add-permission --function-name ${FN} --statement-id FunctionURLAllowPublicAccess --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE --region ${REGION}`);
    quiet(`aws lambda add-permission --function-name ${FN} --statement-id AllowInvokeFromURL --action lambda:InvokeFunction --principal "*" --region ${REGION}`);
  }
  const url = furl?.FunctionUrl || "(re-correr para ver la URL)";

  log("\n╔══════════════════════════════════════════════");
  log(`║ ✅ ${FN}`);
  log(`║ URL: ${url}`);
  log("╚══════════════════════════════════════════════");
  log("→ Pegar en amplify_outputs.json · custom.apiEndpoints.getWhatsAppAnalytics");
})().catch((e) => { console.error("❌", e.message || e); process.exit(1); });
