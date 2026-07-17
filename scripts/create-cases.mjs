#!/usr/bin/env node
/**
 * create-cases.mjs — provisiona la infra de la primitiva Case/Ticket (eje C · B1).
 * Idempotente: crea-o-actualiza. Ver design/case-primitiva.md §9.
 *
 *   · DynamoDB connectview-cases        (PK=tenantId, SK=caseId; item SK="__counter__" = correlativo)
 *   · IAM managed policy connectview-cases-access (dynamodb sobre la tabla), adjunta a:
 *       - VoxCrmConnectAccess            (rol ASUMIDO del tenant — hace las DB calls en BYO)
 *       - connectview-admin-lambda-role  (exec role de manage-cases; ya trae la resolución de tenant)
 *   · Lambda   connectview-manage-cases  (Function URL pública + CORS), rol = admin-lambda-role
 *
 * Uso: node scripts/create-cases.mjs   (con el sandbox deshabilitado)
 * Tras correrlo: pegar la Function URL en amplify_outputs.json → custom.apiEndpoints.manageCases
 *
 * ⚠️ Gotcha IAM (reference_new_lambda_iam): el campaign-lambda-role está lleno (10/10) →
 * manage-cases usa admin-lambda-role (6/10, y YA trae VoxTenantResolve+VoxCrmTenantResolve =
 * connections-read + sts:AssumeRole que necesita tenantConnect). En runtime las DB calls de un
 * tenant BYO corren bajo VoxCrmConnectAccess (por eso cases-access va también a ese rol). Un curl
 * anónimo da 401 (auth gate) y NO ejerce DynamoDB → verificar el path real en el browser logueado.
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
const ROLE = `arn:aws:iam::${ACCOUNT}:role/connectview-admin-lambda-role`;

const TABLE = "connectview-cases";
const FN = "connectview-manage-cases";
const POLICY_NAME = "connectview-cases-access";
const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}`;
const ATTACH_ROLES = ["VoxCrmConnectAccess", "connectview-admin-lambda-role"];

const sh = (cmd) =>
  execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
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
  const p = join(mkdtempSync(join(tmpdir(), "cases-")), name);
  writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
}

async function bundle(dir) {
  const entry = join(ROOT, "amplify", "functions", dir, "handler.ts");
  const tmp = mkdtempSync(join(tmpdir(), `cases-${dir}-`));
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
    sh(
      `aws lambda update-function-code --function-name ${name} --zip-file fileb://${zip} --region ${REGION} --no-cli-pager`,
    );
    quiet(`aws lambda wait function-updated --function-name ${name} --region ${REGION}`);
    sh(
      `aws lambda update-function-configuration --function-name ${name} --environment file://${envFile} --timeout ${timeout} --region ${REGION} --no-cli-pager`,
    );
    log(`  ✅ ${name} (actualizado)`);
  } else {
    sh(
      `aws lambda create-function --function-name ${name} --runtime nodejs20.x --role ${ROLE} --handler index.handler --zip-file fileb://${zip} --timeout ${timeout} --memory-size 256 --environment file://${envFile} --region ${REGION} --no-cli-pager`,
    );
    quiet(`aws lambda wait function-active --function-name ${name} --region ${REGION}`);
    log(`  ✅ ${name} (creado)`);
  }
}

(async () => {
  log("── Primitiva Case/Ticket (eje C · B1) — provisioning ──\n");

  // 1) Tabla connectview-cases (PK=tenantId, SK=caseId)
  log("1) DynamoDB connectview-cases…");
  if (!quiet(`aws dynamodb describe-table --table-name ${TABLE} --region ${REGION}`)) {
    sh(
      [
        "aws dynamodb create-table",
        `--table-name ${TABLE}`,
        "--attribute-definitions AttributeName=tenantId,AttributeType=S AttributeName=caseId,AttributeType=S",
        "--key-schema AttributeName=tenantId,KeyType=HASH AttributeName=caseId,KeyType=RANGE",
        "--billing-mode PAY_PER_REQUEST",
        `--region ${REGION} --no-cli-pager`,
      ].join(" "),
    );
    quiet(`aws dynamodb wait table-exists --table-name ${TABLE} --region ${REGION}`);
    log(`   tabla ${TABLE} creada`);
  } else {
    log(`   tabla ${TABLE} ya existe`);
  }

  const tableArn = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}`;

  // 2) IAM managed policy + attach a los roles que tocan la tabla en runtime.
  log("2) IAM (managed policy connectview-cases-access)…");
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
        ],
        Resource: [tableArn, `${tableArn}/index/*`],
      },
    ],
  };
  const polFile = writeTmp("policy.json", policy);
  if (quiet(`aws iam get-policy --policy-arn ${POLICY_ARN}`)) {
    const vers = tryjson(`aws iam list-policy-versions --policy-arn ${POLICY_ARN}`);
    const nonDefault = (vers?.Versions || []).filter((v) => !v.IsDefaultVersion);
    if (nonDefault.length >= 4) {
      const oldest = nonDefault.sort((a, b) => new Date(a.CreateDate) - new Date(b.CreateDate))[0];
      quiet(
        `aws iam delete-policy-version --policy-arn ${POLICY_ARN} --version-id ${oldest.VersionId}`,
      );
    }
    sh(
      `aws iam create-policy-version --policy-arn ${POLICY_ARN} --policy-document file://${polFile} --set-as-default`,
    );
    log("   managed policy actualizada (nueva versión default)");
  } else {
    sh(`aws iam create-policy --policy-name ${POLICY_NAME} --policy-document file://${polFile}`);
    log("   managed policy creada");
  }
  // Attach managed donde haya cupo; si el rol está lleno (10/10 managed, p.ej.
  // VoxCrmConnectAccess) → policy INLINE (no cuenta contra el quota de managed).
  const inlineDoc = writeTmp("cases-inline.json", policy);
  for (const role of ATTACH_ROLES) {
    if (quiet(`aws iam attach-role-policy --role-name ${role} --policy-arn ${POLICY_ARN}`)) {
      log(`   ✅ managed adjunta a ${role}`);
    } else {
      const okInline = quiet(
        `aws iam put-role-policy --role-name ${role} --policy-name ${POLICY_NAME}-inline --policy-document file://${inlineDoc}`,
      );
      log(`   ${okInline ? "✅ inline adjunta a" : "⚠️  no se pudo adjuntar a"} ${role}`);
    }
  }

  // 3) Lambda manage-cases + Function URL pública
  log("3) Lambda connectview-manage-cases…");
  await ensureLambda(FN, "manage-cases", { CASES_TABLE: TABLE }, 20);
  let furl = tryjson(`aws lambda get-function-url-config --function-name ${FN} --region ${REGION}`);
  if (!furl) {
    furl = tryjson(
      `aws lambda create-function-url-config --function-name ${FN} --auth-type NONE --cors "AllowOrigins=*,AllowMethods=*,AllowHeaders=*" --region ${REGION}`,
    );
    // Function URL pública requiere AMBOS statements (gotcha de la cuenta): si falta el 2º → 403.
    quiet(
      `aws lambda add-permission --function-name ${FN} --statement-id FunctionURLAllowPublicAccess --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE --region ${REGION}`,
    );
    quiet(
      `aws lambda add-permission --function-name ${FN} --statement-id AllowInvokeFromURL --action lambda:InvokeFunction --principal "*" --region ${REGION}`,
    );
  }
  const url = furl?.FunctionUrl || "(re-correr para ver la URL)";

  log("\n╔══════════════════════════════════════════════");
  log(`║ ✅ ${FN}`);
  log(`║ URL: ${url}`);
  log("╚══════════════════════════════════════════════");
  log("→ Pegar en amplify_outputs.json · custom.apiEndpoints.manageCases");
})().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
