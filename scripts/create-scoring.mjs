#!/usr/bin/env node
/**
 * create-scoring.mjs — provisiona la infra de Fase 2 (lead scoring + grading).
 * Idempotente: crea-o-deja-como-está.
 *
 *   · DynamoDB connectview-scoring-rules   (PK=tenantId — reglas por tenant)
 *   · IAM managed policy connectview-scoring-access (dynamodb sobre la tabla),
 *       adjunta a los roles que la tocan en runtime:
 *         - VoxCrmConnectAccess              (rol ASUMIDO del tenant — hace las DB calls)
 *         - connectview-campaign-lambda-role (exec role compartido)
 *         - connectview-admin-lambda-role    (exec role compartido)
 *
 * El motor (`_shared/scoring.ts`) recomputa el score/grade en cada golpe (hook en
 * leadSync.appendLeadHistory). Sin reglas guardadas usa DEFAULT_SCORING_RULES →
 * NO requiere correr esto para funcionar (la tabla solo guarda overrides del
 * tenant). Uso: node scripts/create-scoring.mjs   (con el sandbox deshabilitado).
 *
 * ⚠️ Gotcha IAM (ver reference_new_lambda_iam): en runtime las DB calls corren
 * bajo el rol ASUMIDO del tenant (VoxCrmConnectAccess), no el exec role.
 */
import { execSync } from "node:child_process";

const REGION = "us-east-1";
const ACCOUNT = "731736972577";
const TABLE = "connectview-scoring-rules";
const POLICY_NAME = "connectview-scoring-access";
const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}`;
const ATTACH_ROLES = [
  "VoxCrmConnectAccess",
  "connectview-campaign-lambda-role",
  "connectview-admin-lambda-role",
];

const quiet = (cmd) => {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const log = (...a) => console.log(...a);

// 1. Tabla (PK=tenantId, on-demand).
log(`· Tabla ${TABLE}…`);
const created = quiet(
  `aws dynamodb create-table --region ${REGION} --table-name ${TABLE} ` +
    `--attribute-definitions AttributeName=tenantId,AttributeType=S ` +
    `--key-schema AttributeName=tenantId,KeyType=HASH --billing-mode PAY_PER_REQUEST`,
);
log(created ? "  creada" : "  (ya existía)");

// 2. Managed policy (dynamodb sobre la tabla).
log(`· Policy ${POLICY_NAME}…`);
const doc = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"],
      Resource: `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}`,
    },
  ],
});
const pol = quiet(
  `aws iam create-policy --policy-name ${POLICY_NAME} --policy-document '${doc}'`,
);
log(pol ? "  creada" : "  (ya existía)");

// 3. Attach a los roles que tocan la tabla en runtime.
for (const role of ATTACH_ROLES) {
  const ok = quiet(`aws iam attach-role-policy --role-name ${role} --policy-arn ${POLICY_ARN}`);
  log(`  ${ok ? "✅" : "⚠️ "} ${role}`);
}
log("Listo. La tabla es opcional (los defaults del motor funcionan sin ella).");
