#!/usr/bin/env node
/**
 * create-meta-messaging.mjs — provisiona el inbox omnicanal (Pilar 6 · R13).
 * Idempotente.
 *
 *   · DynamoDB connectview-conversations           (PK=conversationId)
 *   · IAM managed policy connectview-conversations-access (DynamoDB CRUD)
 *       adjunta a connectview-campaign-lambda-role + VoxCrmConnectAccess
 *   · IAM managed policy connectview-conversation-media-access (S3 put/get sobre
 *       el bucket de media) adjunta a connectview-campaign-lambda-role
 *   · Lambda connectview-meta-messaging-webhook     (Function URL — Meta postea acá)
 *   · Lambda connectview-manage-conversations       (Function URL — el inbox lo llama)
 *   · Lambda connectview-upload-conversation-media   (Function URL — presigned S3 PUT)
 *
 * Uso: node scripts/create-meta-messaging.mjs   (con el sandbox deshabilitado)
 * Tras correrlo: pegar las URLs en amplify_outputs.json (manageConversations,
 *   uploadConversationMedia) y suscribir el Page/IG al webhook (messages +
 *   messaging_postbacks, override).
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

const TABLE = "connectview-conversations";
const POLICY_NAME = "connectview-conversations-access";
const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}`;
const ATTACH_ROLES = ["connectview-campaign-lambda-role", "VoxCrmConnectAccess"];
const VERIFY_TOKEN = "aria-wa-b8b8564c91e157c421ea4473";

// Bucket de media (reusa el de plantillas WhatsApp) + policy S3 para el uploader.
const MEDIA_BUCKET = "connectview-wa-media-731736972577";
const MEDIA_POLICY_NAME = "connectview-conversation-media-access";
const MEDIA_POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${MEDIA_POLICY_NAME}`;

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const tryjson = (cmd) => { try { return JSON.parse(sh(cmd)); } catch { return null; } };
const quiet = (cmd) => { try { execSync(cmd, { stdio: "ignore" }); return true; } catch { return false; } };
const log = (...a) => console.log(...a);

function writeTmp(name, obj) {
  const p = join(mkdtempSync(join(tmpdir(), "mm-")), name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
}

async function bundle(dir) {
  const entry = join(ROOT, "amplify", "functions", dir, "handler.ts");
  const tmp = mkdtempSync(join(tmpdir(), `mm-${dir}-`));
  const outFile = join(tmp, "index.js");
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: "node", target: "node20",
    format: "cjs", outfile: outFile, external: ["@aws-sdk/*", "aws-sdk", "node:*"], logLevel: "warning",
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

async function functionUrl(name) {
  let furl = tryjson(`aws lambda get-function-url-config --function-name ${name} --region ${REGION}`);
  if (!furl) {
    furl = tryjson(`aws lambda create-function-url-config --function-name ${name} --auth-type NONE --cors "AllowOrigins=*,AllowMethods=*,AllowHeaders=*" --region ${REGION}`);
    quiet(`aws lambda add-permission --function-name ${name} --statement-id FunctionURLAllowPublicAccess --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE --region ${REGION}`);
    quiet(`aws lambda add-permission --function-name ${name} --statement-id AllowInvokeFromURL --action lambda:InvokeFunction --principal "*" --region ${REGION}`);
  }
  return furl?.FunctionUrl || "(re-correr)";
}

(async () => {
  log("── Pilar 6 · inbox omnicanal — provisioning ──\n");

  // 1) tabla connectview-conversations
  log("1) DynamoDB connectview-conversations…");
  if (!quiet(`aws dynamodb describe-table --table-name ${TABLE} --region ${REGION}`)) {
    sh([
      "aws dynamodb create-table",
      `--table-name ${TABLE}`,
      "--attribute-definitions AttributeName=conversationId,AttributeType=S",
      "--key-schema AttributeName=conversationId,KeyType=HASH",
      "--billing-mode PAY_PER_REQUEST",
      `--region ${REGION} --no-cli-pager`,
    ].join(" "));
    quiet(`aws dynamodb wait table-exists --table-name ${TABLE} --region ${REGION}`);
    log(`   tabla ${TABLE} creada`);
  } else log(`   tabla ${TABLE} ya existe`);

  const tableArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}`;

  // 2) IAM managed policy + attach
  log("2) IAM (managed policy)…");
  const policy = {
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Action: ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan"],
      Resource: [tableArn, `${tableArn}/index/*`],
    }],
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

  // 2b) IAM managed policy S3 para el uploader de adjuntos (put + get sobre el
  //     bucket de media). El GET presignado exige que el firmante tenga s3:GetObject.
  log("2b) IAM S3 (uploader de adjuntos)…");
  const mediaPolicy = {
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Action: ["s3:PutObject", "s3:GetObject"],
      Resource: [`arn:aws:s3:::${MEDIA_BUCKET}/conversation-media/*`],
    }],
  };
  const mediaPolFile = writeTmp("media-policy.json", mediaPolicy);
  if (quiet(`aws iam get-policy --policy-arn ${MEDIA_POLICY_ARN}`)) {
    const vers = tryjson(`aws iam list-policy-versions --policy-arn ${MEDIA_POLICY_ARN}`);
    const nonDefault = (vers?.Versions || []).filter((v) => !v.IsDefaultVersion);
    if (nonDefault.length >= 4) {
      const oldest = nonDefault.sort((a, b) => new Date(a.CreateDate) - new Date(b.CreateDate))[0];
      quiet(`aws iam delete-policy-version --policy-arn ${MEDIA_POLICY_ARN} --version-id ${oldest.VersionId}`);
    }
    sh(`aws iam create-policy-version --policy-arn ${MEDIA_POLICY_ARN} --policy-document file://${mediaPolFile} --set-as-default`);
    log("   managed policy S3 actualizada");
  } else {
    sh(`aws iam create-policy --policy-name ${MEDIA_POLICY_NAME} --policy-document file://${mediaPolFile}`);
    log("   managed policy S3 creada");
  }
  {
    const okAttach = quiet(`aws iam attach-role-policy --role-name connectview-campaign-lambda-role --policy-arn ${MEDIA_POLICY_ARN}`);
    log(`   ${okAttach ? "✅" : "⚠️ "} adjunta a connectview-campaign-lambda-role`);
  }

  // 3) Lambdas + Function URLs
  log("3) Lambdas…");
  // El Page tiene 1 solo override_callback_uri → este webhook reenvía los leadgen
  // (Pilar 5) al webhook de leads. Resolvemos su Function URL en vivo.
  const leadAdsUrl = (tryjson(`aws lambda get-function-url-config --function-name connectview-meta-lead-ads-webhook --region ${REGION}`) || {}).FunctionUrl || "";
  const env = { META_LEADGEN_VERIFY_TOKEN: VERIFY_TOKEN, CONNECTIONS_TABLE: "connectview-connections", CONVERSATIONS_TABLE: TABLE, LEADGEN_WEBHOOK_URL: leadAdsUrl };
  await ensureLambda("connectview-meta-messaging-webhook", "meta-messaging-webhook", env, 20);
  await ensureLambda("connectview-manage-conversations", "manage-conversations", env, 20);
  // Uploader de adjuntos: solo necesita el bucket de media (presigned PUT/GET).
  await ensureLambda(
    "connectview-upload-conversation-media",
    "upload-conversation-media",
    { MEDIA_BUCKET },
    20,
  );
  if (leadAdsUrl) log(`   ↪ leadgen se reenvía a ${leadAdsUrl}`);
  const webhookUrl = await functionUrl("connectview-meta-messaging-webhook");
  const manageUrl = await functionUrl("connectview-manage-conversations");
  const uploadUrl = await functionUrl("connectview-upload-conversation-media");

  log("\n╔══════════════════════════════════════════════");
  log(`║ ✅ webhook (Meta):     ${webhookUrl}`);
  log(`║ ✅ manage (inbox):     ${manageUrl}`);
  log(`║ ✅ upload (adjuntos):  ${uploadUrl}`);
  log(`║ verify_token: ${VERIFY_TOKEN}`);
  log("╚══════════════════════════════════════════════");
  log("→ amplify_outputs.json · custom.apiEndpoints.manageConversations = <manage URL>");
  log("→ amplify_outputs.json · custom.apiEndpoints.uploadConversationMedia = <upload URL>");
  log("→ suscribir el Page/IG al webhook (messages, messaging_postbacks).");
})().catch((e) => { console.error("❌", e.message || e); process.exit(1); });
