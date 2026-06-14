#!/usr/bin/env node
/**
 * set-sf-inbound-token.mjs — provisiona/ROTA el token de ENTRADA per-tenant del
 * webhook SF→Vox (`salesforce-inbound-webhook`). Guarda el token en Secrets
 * Manager bajo `connectview/tenant/<tenantId>/sf-inbound` y lo imprime para
 * pegarlo en el Custom Header `x-vox-token` del Flow de Salesforce del tenant.
 *
 * Reemplaza el secret GLOBAL `SF_WEBHOOK_SECRET` (un token por tenant en vez de
 * uno compartido). Equivalente CLI del botón "Generar token" de Integraciones.
 *
 * Uso:
 *   node scripts/set-sf-inbound-token.mjs t_3176dacd-dfbe-491f-82cf-76ff0b5a9fbb
 *   node scripts/set-sf-inbound-token.mjs t_<uuid> --quiet   # no imprime el token
 *
 * --quiet: escribe el secret pero imprime sólo una confirmación enmascarada
 * (para correrlo sin filtrar el token en logs/transcripts). Recuperá el valor
 * después con `aws secretsmanager get-secret-value --secret-id
 * connectview/tenant/<id>/sf-inbound` o con el botón "Rotar token" en la UI.
 *
 * El formato del token (`voxsf.<tenantId>.<48 hex>`) DEBE coincidir con
 * amplify/functions/_shared/sfInboundToken.ts (mantener en sync).
 */
import { randomBytes } from "node:crypto";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const tenantId = args.find((a) => !a.startsWith("--"));

const TENANT_ID_RE =
  /^t_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!tenantId || !TENANT_ID_RE.test(tenantId)) {
  console.error(
    "Uso: node scripts/set-sf-inbound-token.mjs <tenantId t_<uuid>> [--quiet]"
  );
  console.error("  tenantId debe ser de la forma t_<uuid> (el de un tenant real).");
  process.exit(1);
}

const REGION = process.env.AWS_REGION || "us-east-1";
const sm = new SecretsManagerClient({ region: REGION });
const secretId = `connectview/tenant/${tenantId}/sf-inbound`;

const token = `voxsf.${tenantId}.${randomBytes(24).toString("hex")}`;
const SecretString = JSON.stringify({
  token,
  rotatedAt: new Date().toISOString(),
});

try {
  await sm.send(new CreateSecretCommand({ Name: secretId, SecretString }));
} catch (e) {
  if (e?.name === "ResourceExistsException") {
    await sm.send(new PutSecretValueCommand({ SecretId: secretId, SecretString }));
  } else {
    throw e;
  }
}

console.log(`OK ✓ — token de entrada guardado en ${secretId}`);
if (quiet) {
  const tail = token.slice(-4);
  console.log(`   token: voxsf.${tenantId}.••••${tail} (oculto; usá la UI o get-secret-value para el valor completo)`);
} else {
  console.log("\n  Pegá ESTE valor en el Custom Header x-vox-token del Flow de SF:\n");
  console.log(`    ${token}\n`);
  console.log("  ⚠️ Guardalo ahora: no se vuelve a mostrar. Si lo perdés, volvé a correr este script (rota).");
}
