#!/usr/bin/env node
/**
 * create-knowledge.mjs — provisiona la base de conocimiento / FAQ del agente IA
 * (Pilar 8 · Fase A2). Idempotente.
 *
 *   · DynamoDB connectview-knowledge-bases               (PK=kbId)
 *   · IAM managed policy connectview-knowledge-access    (DynamoDB CRUD)
 *       adjunta a connectview-campaign-lambda-role + VoxCrmConnectAccess
 *   · Lambda connectview-manage-knowledge                (Function URL)
 *
 * Uso: node scripts/create-knowledge.mjs   (con el sandbox deshabilitado)
 * Tras correrlo: pegar la URL en amplify_outputs.json (manageKnowledge).
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

const TABLE = "connectview-knowledge-bases";
const POLICY_NAME = "connectview-knowledge-access";
const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}`;
const ATTACH_ROLES = ["connectview-campaign-lambda-role", "VoxCrmConnectAccess"];

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const tryjson = (cmd) => { try { return JSON.parse(sh(cmd)); } catch { return null; } };
const quiet = (cmd) => { try { execSync(cmd, { stdio: "ignore" }); return true; } catch { return false; } };
const log = (...a) => console.log(...a);

function writeTmp(name, obj) {
  const p = join(mkdtempSync(join(tmpdir(), "kb-")), name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
}

async function bundle(dir) {
  const entry = join(ROOT, "amplify", "functions", dir, "handler.ts");
  const tmp = mkdtempSync(join(tmpdir(), `kb-${dir}-`));
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
  log("── Pilar 8 · base de conocimiento (FAQ) — provisioning ──\n");

  log("1) DynamoDB connectview-knowledge-bases…");
  if (!quiet(`aws dynamodb describe-table --table-name ${TABLE} --region ${REGION}`)) {
    sh([
      "aws dynamodb create-table",
      `--table-name ${TABLE}`,
      "--attribute-definitions AttributeName=kbId,AttributeType=S",
      "--key-schema AttributeName=kbId,KeyType=HASH",
      "--billing-mode PAY_PER_REQUEST",
      `--region ${REGION} --no-cli-pager`,
    ].join(" "));
    quiet(`aws dynamodb wait table-exists --table-name ${TABLE} --region ${REGION}`);
    log(`   tabla ${TABLE} creada`);
  } else log(`   tabla ${TABLE} ya existe`);

  const tableArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}`;

  log("2) IAM (managed policy CRUD)…");
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

  log("3) Lambda + Function URL…");
  const env = { KB_TABLE: TABLE };
  await ensureLambda("connectview-manage-knowledge", "manage-knowledge", env, 20);
  const url = await functionUrl("connectview-manage-knowledge");

  log("\n╔══════════════════════════════════════════════");
  log(`║ ✅ manage-knowledge: ${url}`);
  log("╚══════════════════════════════════════════════");
  log("→ amplify_outputs.json · custom.apiEndpoints.manageKnowledge = <URL>");
})().catch((e) => { console.error("❌", e.message || e); process.exit(1); });
