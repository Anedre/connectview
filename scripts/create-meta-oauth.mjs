#!/usr/bin/env node
/**
 * create-meta-oauth.mjs — provisiona el "Login con Facebook" (Meta multi-cuenta,
 * auto-servicio) como DOS Lambdas hand-managed con Function URL pública, calcado
 * del patrón de create-meta-messaging.mjs / create-lambda.mjs. Idempotente.
 *
 *   · Lambda connectview-meta-oauth-start     (Function URL — el frontend la llama;
 *       devuelve { authUrl } a la que redirige "Conectar con Facebook")
 *   · Lambda connectview-meta-oauth-callback  (Function URL — Meta redirige acá con
 *       ?code&state; intercambia el code, lista las páginas/IG y las deja `pending`
 *       en el secret del tenant para que el usuario elija cuáles traer)
 *   · IAM managed policy connectview-meta-oauth-access (secretsmanager sobre el
 *       secret maestro connectview/meta + connectview/tenant/*) → campaign-lambda-role
 *
 * 🔴 ESTE SCRIPT ES BUILD-AHEAD: NO lo corras hasta el go-live. Antes de correrlo:
 *   1. Crear el secret maestro:
 *        aws secretsmanager create-secret --name connectview/meta \
 *          --secret-string '{"appId":"932893188309221","appSecret":"<APP_SECRET>"}'
 *   2. En la App de Meta (developers.facebook.com): activar *Facebook Login for
 *      Business*, y registrar el Function URL de meta-oauth-callback (lo imprime
 *      este script) como "Valid OAuth Redirect URI".
 *   3. Ajustar APP_URL abajo si el front no corre en el default.
 *
 * Tras correrlo: pegar las dos URLs en amplify_outputs.json →
 *   custom.apiEndpoints.metaOAuthStart / metaOAuthCallback  (y commitear).
 *
 * Uso: node scripts/create-meta-oauth.mjs   (con el sandbox de amplify deshabilitado)
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

// A dónde vuelve el navegador tras el callback (Configuración → Integraciones).
// Ajustar al host donde corre el front en producción; localhost para dev.
const APP_URL = process.env.APP_URL || "https://master.drmn5d76emst6.amplifyapp.com";
const META_SECRET_NAME = "connectview/meta";

const POLICY_NAME = "connectview-meta-oauth-access";
const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}`;

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const tryjson = (cmd) => {
  try {
    return JSON.parse(sh(cmd));
  } catch {
    return null;
  }
};
const quiet = (cmd) => {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const log = (...a) => console.log(...a);

function writeTmp(name, obj) {
  const p = join(mkdtempSync(join(tmpdir(), "mo-")), name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
}

async function bundle(dir) {
  const entry = join(ROOT, "amplify", "functions", dir, "handler.ts");
  const tmp = mkdtempSync(join(tmpdir(), `mo-${dir}-`));
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
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${outFile}' -DestinationPath '${zipPath}' -Force"`,
    { stdio: "ignore" },
  );
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

async function functionUrl(name) {
  let furl = tryjson(`aws lambda get-function-url-config --function-name ${name} --region ${REGION}`);
  if (!furl) {
    furl = tryjson(
      `aws lambda create-function-url-config --function-name ${name} --auth-type NONE --cors "AllowOrigins=*,AllowMethods=*,AllowHeaders=*" --region ${REGION}`,
    );
    // Function URL público requiere DOS permisos (gotcha conocido).
    quiet(`aws lambda add-permission --function-name ${name} --statement-id FunctionURLAllowPublicAccess --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE --region ${REGION}`);
    quiet(`aws lambda add-permission --function-name ${name} --statement-id AllowInvokeFromURL --action lambda:InvokeFunction --principal "*" --region ${REGION}`);
  }
  return furl?.FunctionUrl || "(re-correr)";
}

(async () => {
  log("── Meta multi-cuenta · Login con Facebook — provisioning ──\n");

  // 1) IAM managed policy (secretsmanager sobre el master + los per-tenant).
  log("1) IAM (managed policy secretsmanager)…");
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:CreateSecret",
          "secretsmanager:PutSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        Resource: [
          `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:${META_SECRET_NAME}*`,
          `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:connectview/tenant/*`,
        ],
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
  log("   ✅ adjunta a connectview-campaign-lambda-role");

  // 2) Crear ambos Lambdas. El callback primero para conocer su Function URL
  //    (que es el redirect_uri que ambos usan). Env se re-actualiza en el paso 4.
  log("2) Lambdas…");
  const baseCbEnv = { META_SECRET_NAME, VOX_APP_URL: APP_URL };
  await ensureLambda("connectview-meta-oauth-callback", "meta-oauth-callback", baseCbEnv, 20);
  await ensureLambda("connectview-meta-oauth-start", "meta-oauth-start", { META_SECRET_NAME }, 15);

  // 3) Function URLs.
  log("3) Function URLs…");
  const callbackUrl = await functionUrl("connectview-meta-oauth-callback");
  const startUrl = await functionUrl("connectview-meta-oauth-start");

  // 4) Ahora que sabemos el callback URL, lo seteamos como redirect_uri en AMBOS.
  //    (start lo pone como redirect_uri del dialog; callback lo repite en el
  //    intercambio del code — Meta exige que coincidan exactamente.)
  log("4) Re-set del redirect_uri (META_OAUTH_CALLBACK_URL)…");
  for (const [name, env] of [
    ["connectview-meta-oauth-start", { META_SECRET_NAME, META_OAUTH_CALLBACK_URL: callbackUrl }],
    [
      "connectview-meta-oauth-callback",
      { META_SECRET_NAME, VOX_APP_URL: APP_URL, META_OAUTH_CALLBACK_URL: callbackUrl },
    ],
  ]) {
    const envFile = writeTmp("env.json", { Variables: env });
    quiet(`aws lambda wait function-updated --function-name ${name} --region ${REGION}`);
    sh(`aws lambda update-function-configuration --function-name ${name} --environment file://${envFile} --region ${REGION} --no-cli-pager`);
    log(`   ✅ ${name}`);
  }

  log("\n╔══════════════════════════════════════════════");
  log(`║ ✅ start   (frontend):  ${startUrl}`);
  log(`║ ✅ callback (Meta):     ${callbackUrl}`);
  log("╚══════════════════════════════════════════════");
  log("→ amplify_outputs.json · custom.apiEndpoints.metaOAuthStart    = <start URL>");
  log("→ amplify_outputs.json · custom.apiEndpoints.metaOAuthCallback = <callback URL>");
  log("→ Registrar el callback URL como 'Valid OAuth Redirect URI' en la App de Meta");
  log("→ Verificar el secret maestro connectview/meta { appId, appSecret }");
})().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
