#!/usr/bin/env node
/**
 * create-suppression.mjs — provisiona la infra del Pilar 3 (motor de supresión /
 * consentimiento / frecuencia, R6). Idempotente: crea-o-actualiza.
 *
 *   · DynamoDB connectview-suppression          (PK=phone — dígitos normalizados)
 *   · IAM managed policy connectview-suppression-access (dynamodb sobre la tabla)
 *       adjunta a los roles que tocan la tabla en runtime:
 *         - VoxCrmConnectAccess            (rol ASUMIDO del tenant — hace las DB calls)
 *         - connectview-campaign-lambda-role (send-whatsapp-flow, whatsapp-meta-webhook, manage-suppression)
 *         - connectview-admin-lambda-role    (send-whatsapp-template)
 *   · Lambda   connectview-manage-suppression  (Function URL pública + CORS)
 *
 * Uso: node scripts/create-suppression.mjs   (con el sandbox deshabilitado)
 * Tras correrlo: pegar la Function URL en amplify_outputs.json → custom.apiEndpoints.manageSuppression
 *
 * ⚠️ Gotcha IAM (ver reference_new_lambda_iam): en runtime las DB calls corren
 * bajo el rol ASUMIDO del tenant (VoxCrmConnectAccess), no el exec role. Un curl
 * anónimo da {entries:[]} y enmascara el AccessDenied → verificar en el browser
 * autenticado (la propagación STS tarda ~1 min). Los SENDERS leen la tabla con su
 * default `SUPPRESSION_TABLE || "connectview-suppression"` (no requieren env).
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

const TABLE = "connectview-suppression";
const RULES_TABLE = "connectview-suppression-rules";
const HSM_TABLE = "connectview-hsm-sends"; // GSI byPhone para frecuencia/anti-doble-envío (Fase B)
const FN = "connectview-manage-suppression";
const POLICY_NAME = "connectview-suppression-access";
const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}`;
// Roles que tocan connectview-suppression en runtime (assumed tenant + exec roles).
const ATTACH_ROLES = [
  "VoxCrmConnectAccess",
  "connectview-campaign-lambda-role",
  "connectview-admin-lambda-role",
];

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const tryjson = (cmd) => { try { return JSON.parse(sh(cmd)); } catch { return null; } };
const quiet = (cmd) => { try { execSync(cmd, { stdio: "ignore" }); return true; } catch { return false; } };
const log = (...a) => console.log(...a);

function writeTmp(name, obj) {
  const p = join(mkdtempSync(join(tmpdir(), "sup-")), name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
}

async function bundle(dir) {
  const entry = join(ROOT, "amplify", "functions", dir, "handler.ts");
  const tmp = mkdtempSync(join(tmpdir(), `sup-${dir}-`));
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
  log("── Pilar 3 · supresión — provisioning ──\n");

  // 1) tabla connectview-suppression (PK=phone)
  log("1) DynamoDB connectview-suppression…");
  if (!quiet(`aws dynamodb describe-table --table-name ${TABLE} --region ${REGION}`)) {
    sh([
      "aws dynamodb create-table",
      `--table-name ${TABLE}`,
      "--attribute-definitions AttributeName=phone,AttributeType=S",
      "--key-schema AttributeName=phone,KeyType=HASH",
      "--billing-mode PAY_PER_REQUEST",
      `--region ${REGION} --no-cli-pager`,
    ].join(" "));
    quiet(`aws dynamodb wait table-exists --table-name ${TABLE} --region ${REGION}`);
    log(`   tabla ${TABLE} creada`);
  } else {
    log(`   tabla ${TABLE} ya existe`);
  }

  // 1b) tabla de reglas connectview-suppression-rules (PK=tenantId, 1 doc/tenant)
  log("1b) DynamoDB connectview-suppression-rules…");
  if (!quiet(`aws dynamodb describe-table --table-name ${RULES_TABLE} --region ${REGION}`)) {
    sh([
      "aws dynamodb create-table",
      `--table-name ${RULES_TABLE}`,
      "--attribute-definitions AttributeName=tenantId,AttributeType=S",
      "--key-schema AttributeName=tenantId,KeyType=HASH",
      "--billing-mode PAY_PER_REQUEST",
      `--region ${REGION} --no-cli-pager`,
    ].join(" "));
    quiet(`aws dynamodb wait table-exists --table-name ${RULES_TABLE} --region ${REGION}`);
    log(`   tabla ${RULES_TABLE} creada`);
  } else {
    log(`   tabla ${RULES_TABLE} ya existe`);
  }

  // 1c) GSI byPhone en connectview-hsm-sends (phoneDigits HASH + sentAt RANGE) →
  //     conteo en ventana para anti-doble-envío (R6) + frecuencia. Idempotente.
  log("1c) GSI byPhone en connectview-hsm-sends…");
  const hsmDesc = tryjson(`aws dynamodb describe-table --table-name ${HSM_TABLE} --region ${REGION}`);
  const hasGsi = (hsmDesc?.Table?.GlobalSecondaryIndexes || []).some((g) => g.IndexName === "byPhone");
  if (!hsmDesc) {
    log(`   ⚠️  ${HSM_TABLE} no existe (se omite el GSI)`);
  } else if (hasGsi) {
    log(`   GSI byPhone ya existe`);
  } else {
    const gsi = [{
      Create: {
        IndexName: "byPhone",
        KeySchema: [
          { AttributeName: "phoneDigits", KeyType: "HASH" },
          { AttributeName: "sentAt", KeyType: "RANGE" },
        ],
        Projection: { ProjectionType: "INCLUDE", NonKeyAttributes: ["status", "campaignId", "templateName"] },
      },
    }];
    const gsiFile = writeTmp("gsi.json", gsi);
    sh([
      "aws dynamodb update-table",
      `--table-name ${HSM_TABLE}`,
      "--attribute-definitions AttributeName=phoneDigits,AttributeType=S AttributeName=sentAt,AttributeType=S",
      `--global-secondary-index-updates file://${gsiFile}`,
      `--region ${REGION} --no-cli-pager`,
    ].join(" "));
    log(`   GSI byPhone en creación (backfill async; los HSM nuevos llevan phoneDigits)`);
  }

  const tableArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}`;
  const rulesArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${RULES_TABLE}`;
  const hsmArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${HSM_TABLE}`;

  // 2) IAM managed policy + attach a los 3 roles (el campaign-role ya llegó al
  //    límite de inline → managed; ver gotcha en la cabecera). Cubre las 2 tablas
  //    de Pilar 3 + Query/GetItem sobre hsm-sends (GSI byPhone) para la frecuencia.
  log("2) IAM (managed policy)…");
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchWriteItem"],
        Resource: [tableArn, `${tableArn}/index/*`, rulesArn, `${rulesArn}/index/*`],
      },
      {
        // Query/GetItem para la frecuencia (Pilar 3) + UpdateItem para el ciclo
        // de estado delivered/read/failed (Pilar 4 · whatsapp-status pipeline).
        Effect: "Allow",
        Action: ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:UpdateItem"],
        Resource: [hsmArn, `${hsmArn}/index/*`],
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
    log("   managed policy actualizada (nueva versión default)");
  } else {
    sh(`aws iam create-policy --policy-name ${POLICY_NAME} --policy-document file://${polFile}`);
    log("   managed policy creada");
  }
  for (const role of ATTACH_ROLES) {
    const okAttach = quiet(`aws iam attach-role-policy --role-name ${role} --policy-arn ${POLICY_ARN}`);
    log(`   ${okAttach ? "✅" : "⚠️ "} adjunta a ${role}`);
  }

  // 3) Lambda manage-suppression + Function URL pública
  log("3) Lambda connectview-manage-suppression…");
  await ensureLambda(
    FN,
    "manage-suppression",
    { SUPPRESSION_TABLE: TABLE, SUPPRESSION_RULES_TABLE: RULES_TABLE, HSM_SENDS_TABLE: HSM_TABLE },
    20
  );
  let furl = tryjson(`aws lambda get-function-url-config --function-name ${FN} --region ${REGION}`);
  if (!furl) {
    furl = tryjson(`aws lambda create-function-url-config --function-name ${FN} --auth-type NONE --cors "AllowOrigins=*,AllowMethods=*,AllowHeaders=*" --region ${REGION}`);
    // Function URL pública requiere AMBOS statements (gotcha de la cuenta): si falta el 2º → 403.
    quiet(`aws lambda add-permission --function-name ${FN} --statement-id FunctionURLAllowPublicAccess --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE --region ${REGION}`);
    quiet(`aws lambda add-permission --function-name ${FN} --statement-id AllowInvokeFromURL --action lambda:InvokeFunction --principal "*" --region ${REGION}`);
  }
  const url = furl?.FunctionUrl || "(re-correr para ver la URL)";

  log("\n╔══════════════════════════════════════════════");
  log(`║ ✅ ${FN}`);
  log(`║ URL: ${url}`);
  log("╚══════════════════════════════════════════════");
  log("→ Pegar en amplify_outputs.json · custom.apiEndpoints.manageSuppression");
})().catch((e) => { console.error("❌", e.message || e); process.exit(1); });
