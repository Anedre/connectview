#!/usr/bin/env node
/**
 * create-segments.mjs — provisiona la infra de Fase 2 · F2.3 (segmentos dinámicos).
 * Idempotente.
 *   · DynamoDB connectview-segments   (PK=tenantId, SK=segmentId)
 *   · IAM managed policy connectview-segments-access (dynamodb sobre la tabla),
 *       adjunta a VoxCrmConnectAccess + campaign-lambda-role + admin-lambda-role.
 *
 * El CRUD + el eval (?segment=) están FOLDED en `manage-leads` (no hay Lambda
 * nueva → sin Function URL nueva ni drift de amplify_outputs). El predicado vive
 * en `_shared/leadFilter.ts`. Uso: node scripts/create-segments.mjs (sandbox off).
 */
import { execSync } from "node:child_process";

const REGION = "us-east-1";
const ACCOUNT = "731736972577";
const TABLE = "connectview-segments";
const POLICY_NAME = "connectview-segments-access";
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

log(`· Tabla ${TABLE} (PK=tenantId, SK=segmentId)…`);
log(
  quiet(
    `aws dynamodb create-table --region ${REGION} --table-name ${TABLE} ` +
      `--attribute-definitions AttributeName=tenantId,AttributeType=S AttributeName=segmentId,AttributeType=S ` +
      `--key-schema AttributeName=tenantId,KeyType=HASH AttributeName=segmentId,KeyType=RANGE ` +
      `--billing-mode PAY_PER_REQUEST`,
  )
    ? "  creada"
    : "  (ya existía)",
);

log(`· Policy ${POLICY_NAME}…`);
const doc = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"],
      Resource: `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}`,
    },
  ],
});
log(quiet(`aws iam create-policy --policy-name ${POLICY_NAME} --policy-document '${doc}'`) ? "  creada" : "  (ya existía)");

for (const role of ATTACH_ROLES) {
  log(`  ${quiet(`aws iam attach-role-policy --role-name ${role} --policy-arn ${POLICY_ARN}`) ? "✅" : "⚠️ "} ${role}`);
}
log("Listo. El CRUD/eval vive en manage-leads (?segments=1 / ?segment=<id> / saveSegment / deleteSegment).");
