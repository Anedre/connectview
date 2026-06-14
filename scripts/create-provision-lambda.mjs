#!/usr/bin/env node
/**
 * create-provision-lambda.mjs — crea (o actualiza) la Lambda
 * connectview-provision-contact-flows con su Function URL. La llama el admin
 * desde el wizard (authedFetch con JWT); el handler verifica el token + grupo
 * Admins. Idempotente: si ya existe, actualiza el código.
 *
 * Uso: node scripts/create-provision-lambda.mjs
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REGION = "us-east-1";
const FN = "connectview-provision-contact-flows";
const ROLE = "arn:aws:iam::731736972577:role/connectview-campaign-lambda-role";

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const shQuiet = (cmd) => { try { execSync(cmd, { stdio: "ignore" }); return true; } catch { return false; } };

const entry = join(ROOT, "amplify", "functions", "provision-contact-flows", "handler.ts");
const tmp = mkdtempSync(join(tmpdir(), "provision-"));
const outFile = join(tmp, "index.js");
await esbuild.build({
  entryPoints: [entry], bundle: true, platform: "node", target: "node20",
  format: "cjs", outfile: outFile, external: ["@aws-sdk/*", "aws-sdk", "node:*"],
  logLevel: "warning",
});
const zipPath = join(tmp, "bundle.zip");
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${outFile}' -DestinationPath '${zipPath}' -Force"`, { stdio: "ignore" });
console.log(`📦 bundle: ${(statSync(zipPath).size / 1024).toFixed(1)} KB`);

const envFile = join(tmp, "env.json");
writeFileSync(envFile, JSON.stringify({ Variables: { CONNECTIONS_TABLE: "connectview-connections" } }));

const exists = shQuiet(`aws lambda get-function --function-name ${FN} --region ${REGION}`);
if (exists) {
  console.log("ℹ️  ya existe → actualizo código…");
  sh(`aws lambda update-function-code --function-name ${FN} --zip-file fileb://${zipPath} --region ${REGION} --no-cli-pager`);
} else {
  console.log("🚀 creando función…");
  sh(`aws lambda create-function --function-name ${FN} --runtime nodejs20.x --role ${ROLE} --handler index.handler --timeout 60 --memory-size 256 --zip-file fileb://${zipPath} --environment file://${envFile} --region ${REGION} --no-cli-pager --output json`);
  shQuiet(`aws lambda wait function-active-v2 --function-name ${FN} --region ${REGION}`);
}

// Function URL (con CORS para el browser).
let url = "";
try {
  url = JSON.parse(sh(`aws lambda get-function-url-config --function-name ${FN} --region ${REGION} --output json`)).FunctionUrl;
} catch {
  url = JSON.parse(sh(`aws lambda create-function-url-config --function-name ${FN} --auth-type NONE --cors "AllowOrigins=*,AllowMethods=*,AllowHeaders=*" --region ${REGION} --no-cli-pager --output json`)).FunctionUrl;
}
// permisos públicos (esta cuenta requiere AMBOS statements para Function URL pública).
shQuiet(`aws lambda add-permission --function-name ${FN} --statement-id FunctionURLPublic --action lambda:InvokeFunctionUrl --principal * --function-url-auth-type NONE --region ${REGION} --no-cli-pager`);
shQuiet(`aws lambda add-permission --function-name ${FN} --statement-id AllowInvokeFromURL --action lambda:InvokeFunction --principal * --region ${REGION} --no-cli-pager`);

rmSync(tmp, { recursive: true, force: true });
console.log("\n✅ provision-contact-flows listo");
console.log("   Function URL:", url);
