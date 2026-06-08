/**
 * sfInboundToken — token de ENTRADA per-tenant para el webhook SF→Vox
 * (`salesforce-inbound-webhook`).
 *
 * PROBLEMA que resuelve: el webhook es un Function URL público que antes
 * autenticaba con UN secret GLOBAL (`SF_WEBHOOK_SECRET`, el mismo pegado en el
 * Flow de Salesforce de TODOS los tenants) y derivaba el tenant del `tenantId`
 * del BODY. Como el secret es global, NO prueba quién es dueño del tenantId →
 * un holder del secret podía mandar el tenantId de OTRO tenant y escribir en su
 * data plane (DynamoDB + Customer Profiles + su Salesforce). Leak de ESCRITURA
 * cross-tenant.
 *
 * SOLUCIÓN: un token DISTINTO por tenant, guardado en Secrets Manager bajo
 * `connectview/tenant/<id>/sf-inbound` (misma convención que el SF OAuth
 * per-tenant en [[tenantSalesforce]]). El webhook resuelve el tenant DESDE el
 * token (comparación constant-time contra el secret guardado) y FUERZA ese
 * tenantId — el body se ignora.
 *
 * Formato del token: `voxsf.<tenantId>.<48 hex>`. El `<tenantId>` va embebido
 * como ROUTING HINT (saber qué secret cargar en O(1), sin escanear todos los
 * secrets). NO es la pieza de seguridad: el tenantId no es secreto (ya viaja en
 * JWTs/DynamoDB) y es atacable. La seguridad son los 24 bytes aleatorios
 * (192 bits) + la verificación constant-time del token COMPLETO contra el
 * guardado del tenant — un atacante que cambie el prefijo a la víctima choca
 * contra el secret de la víctima (que no conoce) y falla. Es el patrón estándar
 * "key-id público + secret" (Stripe `sk_…`, GitHub `ghp_…`, AWS access key id).
 */
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isLegacyTenant } from "./cognitoAuth";

const secrets = new SecretsManagerClient({});

/** Prefijo/scheme del token. También ayuda a que un scanner de secretos
 *  reconozca un token Vox filtrado por su forma. */
const TOKEN_PREFIX = "voxsf";

/** Forma EXACTA del tenantId (`t_` + UUID v4, como lo emite provision-tenant).
 *  Doble función de seguridad:
 *   1) SANITIZA el id antes de interpolarlo en el nombre del secret — evita
 *      path traversal / wildcards en `SecretId` (p.ej. `t_../../otra-cosa`).
 *   2) Evita pegarle a Secrets Manager por cada tenantId basura que un atacante
 *      mande al endpoint público (rechazo barato antes del GetSecretValue). */
const TENANT_ID_RE =
  /^t_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secretName(tenantId: string): string {
  return `connectview/tenant/${tenantId}/sf-inbound`;
}

/** Comparación de tiempo constante — evita un timing side-channel que permitiría
 *  recuperar el token byte a byte. Mismo criterio que `safeSecretEq` del
 *  handler legacy. */
function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Genera un token nuevo `voxsf.<tenantId>.<48 hex>` (no lo persiste). */
export function generateSfInboundToken(tenantId: string): string {
  return `${TOKEN_PREFIX}.${tenantId}.${randomBytes(24).toString("hex")}`;
}

/**
 * Provisiona/ROTA el token de entrada del tenant: genera uno nuevo, lo guarda en
 * Secrets Manager y devuelve el PLAINTEXT. El plaintext se muestra UNA sola vez
 * (el admin lo pega en el Custom Header `x-vox-token` del Flow de SF). Rotar =
 * volver a llamar: invalida el token anterior al sobrescribir el secret.
 *
 * Idempotente sobre el nombre del secret (Create → Put si ya existe).
 */
export async function provisionSfInboundToken(tenantId: string): Promise<string> {
  if (!TENANT_ID_RE.test(tenantId) || isLegacyTenant(tenantId)) {
    throw new Error("tenantId inválido para token de entrada de Salesforce");
  }
  const token = generateSfInboundToken(tenantId);
  const SecretString = JSON.stringify({
    token,
    rotatedAt: new Date().toISOString(),
  });
  const name = secretName(tenantId);
  try {
    await secrets.send(new CreateSecretCommand({ Name: name, SecretString }));
  } catch (e) {
    if (e instanceof Error && e.name === "ResourceExistsException") {
      await secrets.send(
        new PutSecretValueCommand({ SecretId: name, SecretString })
      );
    } else {
      throw e;
    }
  }
  tokenCache.delete(tenantId); // el próximo verify lee el token nuevo
  return token;
}

interface CacheEntry {
  /** Token COMPLETO guardado (`voxsf.<tenantId>.<secret>`) o null si el tenant
   *  no tiene token (negative cache con TTL corto, para no martillar SM). */
  token: string | null;
  exp: number;
}
const tokenCache = new Map<string, CacheEntry>();
const POS_TTL_MS = 5 * 60 * 1000; // 5 min — una rotación se propaga razonablemente rápido
const NEG_TTL_MS = 30 * 1000; // 30 s — tenantId real sin token / inexistente

async function loadStoredToken(tenantId: string): Promise<string | null> {
  const hit = tokenCache.get(tenantId);
  if (hit && hit.exp > Date.now()) return hit.token;
  // Cota anti-crecimiento: un atacante podría mandar muchísimos tenantId
  // distintos (válidos en forma) y llenar el Map en el contenedor caliente.
  if (tokenCache.size > 5000) tokenCache.clear();
  let token: string | null = null;
  try {
    const r = await secrets.send(
      new GetSecretValueCommand({ SecretId: secretName(tenantId) })
    );
    if (r.SecretString) {
      const parsed = JSON.parse(r.SecretString);
      if (typeof parsed.token === "string" && parsed.token) token = parsed.token;
    }
  } catch (e) {
    // ResourceNotFound → el tenant no provisionó su token todavía (esperado).
    if (!(e instanceof Error && e.name === "ResourceNotFoundException")) {
      console.error(
        "sfInboundToken read error:",
        e instanceof Error ? e.name : String(e)
      );
    }
  }
  tokenCache.set(tenantId, {
    token,
    exp: Date.now() + (token ? POS_TTL_MS : NEG_TTL_MS),
  });
  return token;
}

/** Parsea el tenantId embebido del token `voxsf.<tenantId>.<secret>`. Devuelve
 *  null si la forma no calza (sin tocar Secrets Manager). */
function parseTenantId(token: string): string | null {
  if (!token.startsWith(TOKEN_PREFIX + ".")) return null;
  const rest = token.slice(TOKEN_PREFIX.length + 1);
  const lastDot = rest.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const tenantId = rest.slice(0, lastDot);
  const secret = rest.slice(lastDot + 1);
  if (!tenantId || !secret) return null;
  return tenantId;
}

/**
 * Resuelve el tenant DUEÑO del token presentado, o null si el token no
 * autentica a ningún tenant. El tenantId embebido se usa SOLO para saber qué
 * secret cargar; la autorización es la comparación constant-time del token
 * COMPLETO contra el guardado del tenant. El caller (webhook) debe FORZAR este
 * tenantId e ignorar cualquier tenantId del body.
 */
export async function resolveTenantFromInboundToken(
  token: string | undefined | null
): Promise<string | null> {
  if (!token) return null;
  const tenantId = parseTenantId(token);
  if (!tenantId) return null;
  // Guard de forma + anti-legacy: por esta vía NUNCA se resuelve a Novasys/
  // default (esos no tienen — ni deben tener — token de entrada per-tenant).
  if (!TENANT_ID_RE.test(tenantId) || isLegacyTenant(tenantId)) return null;
  const stored = await loadStoredToken(tenantId);
  if (!stored) return null;
  if (!safeEq(token, stored)) return null;
  return tenantId;
}
