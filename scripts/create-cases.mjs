#!/usr/bin/env node
/**
 * create-cases.mjs — provisiona la infra de la primitiva Case/Ticket (eje C · B1).
 * Idempotente. Ver design/case-primitiva.md §9.
 *   · DynamoDB connectview-cases   (PK=tenantId, SK=caseId)
 *       - los casos van con SK=<uuid>; el correlativo por tenant es el item
 *         SK="__counter__" (atributo caseSeq, UpdateItem ADD).
 *   · IAM managed policy connectview-cases-access (dynamodb CRUD+Query sobre la
 *       tabla), adjunta a los roles que la tocan.
 *
 * El CRUD/transiciones viven en la Lambda `manage-cases` (Function URL) — se
 * despliega aparte con deploy-lambda.mjs. OJO (reference_new_lambda_iam): el rol
 * campaign-lambda-role está lleno → manage-cases usa su propio rol; acá adjuntamos
 * la policy a VoxCrmConnectAccess + admin-lambda-role (y al rol de manage-cases
 * cuando exista). Uso: node scripts/create-cases.mjs
 */
import { execSync } from "node:child_process";

const REGION = "us-east-1";
const ACCOUNT = "731736972577";
const TABLE = "connectview-cases";
const POLICY_NAME = "connectview-cases-access";
const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}`;
const ATTACH_ROLES = ["VoxCrmConnectAccess", "connectview-admin-lambda-role"];

const quiet = (cmd) => {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const log = (...a) => console.log(...a);

log(`· Tabla ${TABLE} (PK=tenantId, SK=caseId)…`);
log(
  quiet(
    `aws dynamodb create-table --region ${REGION} --table-name ${TABLE} ` +
      `--attribute-definitions AttributeName=tenantId,AttributeType=S AttributeName=caseId,AttributeType=S ` +
      `--key-schema AttributeName=tenantId,KeyType=HASH AttributeName=caseId,KeyType=RANGE ` +
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
      Action: [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
      ],
      Resource: `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}`,
    },
  ],
});
log(
  quiet(`aws iam create-policy --policy-name ${POLICY_NAME} --policy-document '${doc}'`)
    ? "  creada"
    : "  (ya existía)",
);

for (const role of ATTACH_ROLES) {
  log(
    `  ${quiet(`aws iam attach-role-policy --role-name ${role} --policy-arn ${POLICY_ARN}`) ? "✅" : "⚠️ "} ${role}`,
  );
}
log("Listo. El CRUD/transiciones viven en la Lambda manage-cases (deploy-lambda.mjs).");
