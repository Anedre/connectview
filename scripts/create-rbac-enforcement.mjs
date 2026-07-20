#!/usr/bin/env node
/**
 * create-rbac-enforcement.mjs — habilita el gate RBAC server-side
 * (`_shared/rbac.ts` → `requireCapability`) para que los Function URLs
 * privilegiados (auth=NONE) validen el rol contra la matriz por-tenant.
 * Idempotente.
 *
 *   · IAM managed policy connectview-permissions-read (dynamodb:GetItem sobre
 *       la tabla POOLED connectview-permissions), adjunta a los roles de
 *       ejecución de los Lambdas gateados: campaign-lambda-role + admin-lambda-role.
 *
 * El gate lee `connectview-permissions` con el ROL DE EJECUCIÓN del Lambda (no el
 * rol asumido del tenant: la matriz es pooled, misma cuenta que manage-permissions).
 *
 * IMPORTANTE (fail-safe): el gate YA funciona sin este permiso — si no puede leer
 * la matriz cae a DEFAULT_MATRIX (los `manage_*` = Admins), así que la seguridad se
 * cumple igual. Este script solo hace falta para HONRAR las personalizaciones de
 * Configuración → Seguridad (p. ej. relajar `manage_campaigns` a Supervisors).
 *
 * Uso: node scripts/create-rbac-enforcement.mjs
 */
import { execSync } from "node:child_process";

const REGION = "us-east-1";
const ACCOUNT = "731736972577";
const TABLE = "connectview-permissions";
const POLICY_NAME = "connectview-permissions-read";
const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}`;
const ATTACH_ROLES = [
  "connectview-campaign-lambda-role", // create/control/update/relaunch/clone/edit-campaign-contacts/assign-campaign-agents, manage-leads/suppression/taxonomy/catalog
  "connectview-admin-lambda-role", // por si algún manage-* corre bajo el rol admin
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

log(`· Policy ${POLICY_NAME} (GetItem sobre ${TABLE})…`);
const doc = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: ["dynamodb:GetItem"],
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
log(
  "Listo. Redeploy los Lambdas gateados (deploy-lambda.mjs) para que bundleen _shared/rbac.ts.",
);
