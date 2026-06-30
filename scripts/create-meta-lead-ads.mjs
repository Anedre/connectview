#!/usr/bin/env node
/**
 * create-meta-lead-ads.mjs — provisiona el webhook de ingesta de Meta Lead Ads
 * (Pilar 5 · R12). Idempotente.
 *
 *   · Lambda  connectview-meta-lead-ads-webhook  (Function URL pública + CORS)
 *
 * Reusa el rol connectview-campaign-lambda-role (que ya tiene: scan de
 * connections, getTenantConnect/assumeRole, secret del token, escrituras de
 * leadSync — el whatsapp-meta-webhook hace lo mismo). NO necesita IAM nuevo.
 *
 * Uso: node scripts/create-meta-lead-ads.mjs   (con el sandbox deshabilitado)
 * Tras correrlo: pegar la Function URL en amplify_outputs.json → custom.apiEndpoints.metaLeadAdsWebhook
 *   y suscribir el leadgen del Page a esa URL (ver design/pilar-5-ingesta.md §7).
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
const FN = "connectview-meta-lead-ads-webhook";

// Reusa el verify token del webhook de WhatsApp (mismo patrón GET hub.challenge).
const VERIFY_TOKEN = "aria-wa-b8b8564c91e157c421ea4473";
const AUTOMATION_ENGINE_URL = "https://qs6iucpkdm2uashflmlrfvxnha0isdzz.lambda-url.us-east-1.on.aws/";
const VOX_INTERNAL_SECRET = "umv61F1NWO6SMLokllLy9N_2eyI97dC5";

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const tryjson = (cmd) => { try { return JSON.parse(sh(cmd)); } catch { return null; } };
const quiet = (cmd) => { try { execSync(cmd, { stdio: "ignore" }); return true; } catch { return false; } };
const log = (...a) => console.log(...a);

function writeTmp(name, obj) {
  const p = join(mkdtempSync(join(tmpdir(), "mla-")), name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
}

async function bundle(dir) {
  const entry = join(ROOT, "amplify", "functions", dir, "handler.ts");
  const tmp = mkdtempSync(join(tmpdir(), `mla-${dir}-`));
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

async function ensureLambda(name, dir, envObj, timeout = 20) {
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
  log("── Pilar 5 · Meta Lead Ads webhook — provisioning ──\n");
  await ensureLambda(FN, "meta-lead-ads-webhook", {
    META_LEADGEN_VERIFY_TOKEN: VERIFY_TOKEN,
    CONNECTIONS_TABLE: "connectview-connections",
    AUTOMATION_ENGINE_URL,
    VOX_INTERNAL_SECRET,
  }, 20);
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
  log(`║ verify_token: ${VERIFY_TOKEN}`);
  log("╚══════════════════════════════════════════════");
  log("→ Pegar en amplify_outputs.json · custom.apiEndpoints.metaLeadAdsWebhook");
  log("→ Suscribir el leadgen del Page a esta URL (override_callback_uri / App webhook).");
})().catch((e) => { console.error("❌", e.message || e); process.exit(1); });
