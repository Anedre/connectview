/**
 * metaSignature — verificación de la firma HMAC de los webhooks de Meta
 * (`X-Hub-Signature-256`). Meta firma el body CRUDO del POST con el App Secret
 * de la App (HMAC-SHA256) y manda el resultado en el header como
 * `sha256=<hex>`. Sin esta verificación, cualquiera que conozca la URL pública
 * del Function URL podría inyectar eventos falsos (leads/mensajes/estados) →
 * SEC-C5.
 *
 * El App Secret sale del MISMO lugar que usan meta-oauth-start /
 * meta-oauth-callback: el secret maestro `connectview/meta` { appId?, appSecret }
 * en Secrets Manager (env META_SECRET_NAME, default "connectview/meta"). Este
 * helper expone `loadMetaAppSecret` para reusar ese mecanismo desde los webhooks.
 *
 * IMPORTANTE: hay que verificar sobre el rawBody EXACTO recibido (el string de
 * event.body, decodificando si isBase64Encoded), NUNCA sobre el objeto
 * re-serializado con JSON.stringify (cambiaría bytes → rompería el HMAC).
 *
 * Estilo calcado de verifyOAuthState (tenantSalesforce): comparación
 * constant-time con timingSafeEqual + chequeo de longitud previo.
 *
 * Docs: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#event-notifications
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

/**
 * Verifica la firma `X-Hub-Signature-256` de un webhook de Meta.
 *
 * @param rawBody       body CRUDO del POST (string exacto recibido; si venía
 *                      base64, ya decodificado a utf8). NO re-serializar.
 * @param signatureHeader valor del header (`sha256=<hex>`), o undefined si falta.
 * @param appSecret     App Secret de la App de Meta.
 * @returns true si la firma valida; false si falta, tiene mal formato o no coincide.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!appSecret || !signatureHeader) return false;
  // El header es `sha256=<hex>`. Aceptamos solo ese esquema.
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const provided = signatureHeader.slice(prefix.length).trim();
  if (!provided) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  // Comparación constant-time (chequeo de longitud antes de timingSafeEqual,
  // que tira si los buffers difieren en tamaño). Mismo patrón que verifyOAuthState.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const secrets = new SecretsManagerClient({});
const META_SECRET = process.env.META_SECRET_NAME || "connectview/meta";
let cachedAppSecret: string | null = null;

/**
 * Lee el App Secret de Meta del secret maestro `connectview/meta` { appSecret }
 * (mismo mecanismo que loadCreds() en meta-oauth-start / meta-oauth-callback).
 * Cacheado en memoria del contenedor. Devuelve "" si el secret no está
 * configurado o no se puede leer → el caller decide (fail-open sin secret).
 */
export async function loadMetaAppSecret(): Promise<string> {
  if (cachedAppSecret !== null) return cachedAppSecret;
  try {
    const r = await secrets.send(new GetSecretValueCommand({ SecretId: META_SECRET }));
    if (!r.SecretString) {
      cachedAppSecret = "";
      return cachedAppSecret;
    }
    const p = JSON.parse(r.SecretString);
    cachedAppSecret = p.appSecret ? String(p.appSecret) : "";
    return cachedAppSecret;
  } catch {
    // ResourceNotFoundException / falta de permiso / JSON inválido → sin secret.
    cachedAppSecret = "";
    return cachedAppSecret;
  }
}
