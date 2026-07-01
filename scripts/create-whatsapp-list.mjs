#!/usr/bin/env node
/**
 * create-whatsapp-list.mjs — provisiona el sender de WhatsApp LIST interactivo
 * (Fase 4 · F4.2a). Idempotente. Espeja a connectview-send-whatsapp-flow.
 *   · Lambda connectview-send-whatsapp-list-interactive (rol campaign-lambda-role)
 *   · Function URL pública (auth NONE + 2 permisos) — el composer manda JWT
 *   · Env copiado del send-whatsapp-flow (ORIGINATION_IDENTITY + VOX_INTERNAL_SECRET,
 *       sin hardcodear el secreto)
 *
 * Uso: node scripts/create-whatsapp-list.mjs   (con el sandbox deshabilitado).
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
const FN = "connectview-send-whatsapp-list-interactive";
const DIR = "send-whatsapp-list-interactive";
const FLOW = "connectview-send-whatsapp-flow";

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
const tmpF = (n, d) => {
  const p = join(mkdtempSync(join(tmpdir(), "wl-")), n);
  writeFileSync(p, d);
  return p;
};

async function bundle() {
  const tmp = mkdtempSync(join(tmpdir(), "wl-b-"));
  const outFile = join(tmp, "index.js");
  await esbuild.build({
    entryPoints: [join(ROOT, "amplify", "functions", DIR, "handler.ts")],
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
  log(`  📦 ${(statSync(zipPath).size / 1024).toFixed(1)} KB`);
  return zipPath;
}

(async () => {
  log("── Fase 4 · F4.2a send-whatsapp-list-interactive — provisioning ──\n");
  const zip = await bundle();
  // Env copiado del flow sender (mismo número + secreto interno).
  const flowEnv = JSON.parse(
    sh(`aws lambda get-function-configuration --function-name ${FLOW} --region ${REGION} --query "Environment.Variables" --output json`),
  );
  const envFile = tmpF("env.json", JSON.stringify({ Variables: flowEnv }));

  if (quiet(`aws lambda get-function --function-name ${FN} --region ${REGION}`)) {
    sh(`aws lambda update-function-code --function-name ${FN} --zip-file fileb://${zip} --region ${REGION} --no-cli-pager`);
    quiet(`aws lambda wait function-updated --function-name ${FN} --region ${REGION}`);
    sh(`aws lambda update-function-configuration --function-name ${FN} --environment file://${envFile} --region ${REGION} --no-cli-pager`);
    log(`   ✅ ${FN} (actualizado)`);
  } else {
    sh(`aws lambda create-function --function-name ${FN} --runtime nodejs20.x --role ${ROLE} --handler index.handler --zip-file fileb://${zip} --timeout 15 --memory-size 256 --environment file://${envFile} --region ${REGION} --no-cli-pager`);
    quiet(`aws lambda wait function-active --function-name ${FN} --region ${REGION}`);
    log(`   ✅ ${FN} (creado)`);
  }

  // Function URL pública (auth NONE) + 2 permisos.
  quiet(`aws lambda create-function-url-config --function-name ${FN} --auth-type NONE --region ${REGION}`);
  quiet(`aws lambda add-permission --function-name ${FN} --statement-id FnUrlPublic --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE --region ${REGION}`);
  quiet(`aws lambda add-permission --function-name ${FN} --statement-id FnUrlInvoke --action lambda:InvokeFunction --principal "*" --region ${REGION}`);
  const url = sh(`aws lambda get-function-url-config --function-name ${FN} --region ${REGION} --query FunctionUrl --output text`);
  log(`\nListo. Endpoint: ${url}`);
  log("  Agregá sendWhatsAppList a amplify_outputs / api.ts si el frontend lo va a llamar.");
})();
