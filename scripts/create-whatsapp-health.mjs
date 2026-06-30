#!/usr/bin/env node
/**
 * create-whatsapp-health.mjs — provisiona el monitor de salud de WhatsApp
 * (Pilar 4 · #13). Idempotente.
 *
 *   · Lambda   connectview-get-whatsapp-health  (Function URL pública + CORS)
 *   · IAM managed policy connectview-whatsapp-health-access (social-messaging read)
 *       adjunta a connectview-campaign-lambda-role + VoxCrmConnectAccess.
 *
 * Uso: node scripts/create-whatsapp-health.mjs   (con el sandbox deshabilitado)
 * Tras correrlo: pegar la Function URL en amplify_outputs.json → custom.apiEndpoints.getWhatsAppHealth
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

const FN = "connectview-get-whatsapp-health";
const POLICY_NAME = "connectview-whatsapp-health-access";
const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}`;
const ATTACH_ROLES = ["connectview-campaign-lambda-role", "VoxCrmConnectAccess"];

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const tryjson = (cmd) => { try { return JSON.parse(sh(cmd)); } catch { return null; } };
const quiet = (cmd) => { try { execSync(cmd, { stdio: "ignore" }); return true; } catch { return false; } };
const log = (...a) => console.log(...a);

function writeTmp(name, obj) {
  const p = join(mkdtempSync(join(tmpdir(), "wah-")), name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
}

async function bundle(dir) {
  const entry = join(ROOT, "amplify", "functions", dir, "handler.ts");
  const tmp = mkdtempSync(join(tmpdir(), `wah-${dir}-`));
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
  log("── Pilar 4 · salud de WhatsApp — provisioning ──\n");

  // 1) IAM managed policy (social-messaging read) + attach
  log("1) IAM (managed policy social-messaging read)…");
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "social-messaging:ListLinkedWhatsAppBusinessAccounts",
          "social-messaging:GetLinkedWhatsAppBusinessAccount",
        ],
        Resource: "*",
      },
      {
        // Token Meta del tenant (meta-mode) para pullear el quality rating de Graph.
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:connectview/tenant/*`,
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
  for (const role of ATTACH_ROLES) {
    const okAttach = quiet(`aws iam attach-role-policy --role-name ${role} --policy-arn ${POLICY_ARN}`);
    log(`   ${okAttach ? "✅" : "⚠️ "} adjunta a ${role}`);
  }

  // 2) Lambda + Function URL pública
  log("2) Lambda connectview-get-whatsapp-health…");
  await ensureLambda(FN, "get-whatsapp-health", {}, 15);
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
  log("→ Pegar en amplify_outputs.json · custom.apiEndpoints.getWhatsAppHealth");
})().catch((e) => { console.error("❌", e.message || e); process.exit(1); });
