#!/usr/bin/env node
/**
 * create-webhook-lambda.mjs — crea (one-shot) la Lambda whatsapp-meta-webhook
 * con su Function URL PÚBLICA. Meta la llama sin auth de AWS; la seguridad es el
 * verify token (que Meta refleja en la verificación). Idempotente-ish: si la
 * función ya existe, actualiza el código en vez de crearla.
 *
 * Uso: node scripts/create-webhook-lambda.mjs
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REGION = "us-east-1";
const FN = "connectview-whatsapp-meta-webhook";
const ROLE = "arn:aws:iam::731736972577:role/connectview-campaign-lambda-role";
const BOT_RUNTIME_URL = "https://gvkvnc3sipgybseeqjnixv4h6a0xpkpa.lambda-url.us-east-1.on.aws/";
const VERIFY_TOKEN = "aria-wa-" + randomBytes(12).toString("hex");

const sh = (cmd, opts = {}) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], ...opts }).toString();
const shQuiet = (cmd) => { try { execSync(cmd, { stdio: "ignore" }); return true; } catch { return false; } };

// 1) bundle
const entry = join(ROOT, "amplify", "functions", "whatsapp-meta-webhook", "handler.ts");
const tmp = mkdtempSync(join(tmpdir(), "wa-webhook-"));
const outFile = join(tmp, "index.js");
await esbuild.build({
  entryPoints: [entry], bundle: true, platform: "node", target: "node20",
  format: "cjs", outfile: outFile, external: ["@aws-sdk/*", "aws-sdk", "node:*"],
  logLevel: "warning",
});
const zipPath = join(tmp, "bundle.zip");
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${outFile}' -DestinationPath '${zipPath}' -Force"`, { stdio: "ignore" });
console.log(`📦 bundle: ${(statSync(zipPath).size / 1024).toFixed(1)} KB`);

// env vars via JSON file (evita líos de comillas/comas en CLI).
const envFile = join(tmp, "env.json");
writeFileSync(envFile, JSON.stringify({
  Variables: {
    WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
    BOT_RUNTIME_URL,
    CONNECTIONS_TABLE: "connectview-connections",
    BOTS_TABLE: "connectview-bots",
    CONV_TABLE: "connectview-ai-conversations",
  },
}));

// 2) create or update
const exists = shQuiet(`aws lambda get-function --function-name ${FN} --region ${REGION}`);
let verifyToken = VERIFY_TOKEN;
if (exists) {
  console.log("ℹ️  ya existe → actualizo código…");
  sh(`aws lambda update-function-code --function-name ${FN} --zip-file fileb://${zipPath} --region ${REGION} --no-cli-pager`);
  // preservamos el verify token existente si lo hay
  try {
    const cfg = JSON.parse(sh(`aws lambda get-function-configuration --function-name ${FN} --region ${REGION} --output json`));
    verifyToken = cfg?.Environment?.Variables?.WHATSAPP_VERIFY_TOKEN || VERIFY_TOKEN;
  } catch { /* noop */ }
} else {
  console.log("🚀 creando función…");
  sh(`aws lambda create-function --function-name ${FN} --runtime nodejs20.x --role ${ROLE} --handler index.handler --timeout 30 --memory-size 256 --zip-file fileb://${zipPath} --environment file://${envFile} --region ${REGION} --no-cli-pager --output json`);
  // esperar a que esté Active antes de la Function URL
  shQuiet(`aws lambda wait function-active-v2 --function-name ${FN} --region ${REGION}`);
}

// 3) Function URL (crea si no existe)
let url = "";
try {
  url = JSON.parse(sh(`aws lambda get-function-url-config --function-name ${FN} --region ${REGION} --output json`)).FunctionUrl;
} catch {
  url = JSON.parse(sh(`aws lambda create-function-url-config --function-name ${FN} --auth-type NONE --region ${REGION} --no-cli-pager --output json`)).FunctionUrl;
}

// 4) permisos públicos. OJO: esta cuenta requiere AMBOS statements para que la
//    Function URL pública funcione (InvokeFunctionUrl + InvokeFunction).
shQuiet(`aws lambda add-permission --function-name ${FN} --statement-id FunctionURLPublic --action lambda:InvokeFunctionUrl --principal * --function-url-auth-type NONE --region ${REGION} --no-cli-pager`);
shQuiet(`aws lambda add-permission --function-name ${FN} --statement-id AllowInvokeFromURL --action lambda:InvokeFunction --principal * --region ${REGION} --no-cli-pager`);

rmSync(tmp, { recursive: true, force: true });

console.log("\n╔══════════════════════════════════════════════════════════");
console.log("║ whatsapp-meta-webhook · LISTO");
console.log("╠══════════════════════════════════════════════════════════");
console.log(`║ Webhook URL : ${url}`);
console.log(`║ Verify token: ${verifyToken}`);
console.log("╚══════════════════════════════════════════════════════════");
