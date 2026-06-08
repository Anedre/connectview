/**
 * cognitoAuth — verificación del JWT de Cognito + resolución de tenant.
 *
 * Los endpoints (Function URLs) son auth NONE a nivel infra, así que la
 * identidad se valida ACÁ: el front manda el ID token de Cognito como
 * `Authorization: Bearer <token>` y este helper lo verifica contra el pool y
 * saca el `custom:tenantId` (que viaja en el token). Nunca confiamos en un
 * tenantId mandado por el cliente.
 *
 * SEGURIDAD (auditoría): SIN token (o token inválido) → `""` (ANÓNIMO), NO
 * "default". Antes devolvía "default" → los Function URLs públicos exponían
 * los datos pooled de Novasys a cualquiera sin autenticarse. Ahora el anónimo
 * no resuelve a ningún tenant → los callers lo bloquean (vacío).
 *
 * Novasys es ahora un tenant EXPLÍCITO con tenantId="novasys" (ver
 * NOVASYS_TENANT_ID): sus datos viven en las tablas pooled + la instancia
 * Connect hardcodeada, que están en la cuenta de Vox (= la cuenta de Novasys).
 * Solo se accede a esos datos con un JWT cuyo custom:tenantId sea "novasys".
 */
import { CognitoJwtVerifier } from "aws-jwt-verify";

/** tenantId canónico de Novasys, el "tenant fundador". Mapea a los recursos
 *  legacy (tablas pooled connectview-* + instancia Connect hardcodeada), que
 *  viven en la cuenta de Vox. */
export const NOVASYS_TENANT_ID = "novasys";

/** ¿Este tenant usa los recursos legacy/pooled de Novasys? Incluye el alias
 *  histórico "default" por compatibilidad con campañas/webhooks viejos que
 *  pudieran traerlo en su payload. El anónimo ("") NO es legacy → se bloquea. */
export function isLegacyTenant(tenantId: string | undefined | null): boolean {
  return tenantId === NOVASYS_TENANT_ID || tenantId === "default";
}

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || "us-east-1_csLvANyZo";
const CLIENT_ID = process.env.COGNITO_CLIENT_ID || "6qfs8onjto75i9cckl1vns80f9";

// Verificamos ID tokens (traen email + custom:tenantId). Cacheo de JWKS interno.
const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: "id",
  clientId: CLIENT_ID,
});

export interface VoxIdentity {
  sub: string;
  username?: string;
  email?: string;
  /** Nombre completo de la persona (atributo estándar `name`). */
  name?: string;
  /** Nombre de la empresa que el fundador puso en el registro
   *  (`custom:companyName`). provision-tenant lo usa como nombre de la org. */
  companyName?: string;
  tenantId?: string;
  groups: string[];
}

type HeaderBag = Record<string, string | undefined> | undefined;

function bearer(headers: HeaderBag): string | null {
  const h = headers || {};
  const raw = h.authorization || h.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1] : null;
}

/**
 * Verifica el token del request y devuelve la identidad (con tenantId).
 * Lanza si el token es inválido; devuelve null si no hay token.
 */
export async function getIdentity(headers: HeaderBag): Promise<VoxIdentity | null> {
  const token = bearer(headers);
  if (!token) return null;
  const payload = await verifier.verify(token);
  const groups = (payload["cognito:groups"] as string[] | undefined) || [];
  const tenantId = payload["custom:tenantId"];
  const username = payload["cognito:username"];
  const name = payload["name"];
  const companyName = payload["custom:companyName"];
  return {
    sub: payload.sub,
    username: typeof username === "string" ? username : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof name === "string" ? name : undefined,
    companyName: typeof companyName === "string" ? companyName : undefined,
    tenantId: typeof tenantId === "string" ? tenantId : undefined,
    groups,
  };
}

/** tenantId del request. SIN token o token inválido → "" (ANÓNIMO).
 *  CAMBIO DE SEGURIDAD: antes devolvía "default" (= los datos de Novasys),
 *  exponiéndolos a requests anónimos vía los Function URLs públicos. Ahora el
 *  anónimo no resuelve a ningún tenant y los callers lo bloquean. */
export async function resolveTenantId(headers: HeaderBag): Promise<string> {
  try {
    const id = await getIdentity(headers);
    return id?.tenantId || "";
  } catch {
    return "";
  }
}
