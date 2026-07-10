/**
 * meta-oauth-start — paso 1 del "Login con Facebook" (OAuth) para que un tenant
 * CONECTE sus propias cuentas de Instagram / Messenger / Facebook (auto-servicio
 * multi-cuenta, como Chattigo/ManyChat). Devuelve { authUrl } a la que el frontend
 * redirige; Meta pide consentimiento, el usuario ELIGE qué páginas/cuentas IG
 * autorizar, y Meta redirige a la callback con ?code + &state (firmado, anti-CSRF).
 * El callback (meta-oauth-callback) intercambia el code, LISTA las páginas/IG del
 * usuario y las devuelve para que tilde cuáles traer a ARIA.
 *
 * Patrón calcado de mercadolibre-oauth-start (F4.1). Build-ahead: necesita
 *   - secret `connectview/meta` con { appId?, appSecret }  (appId default 932893188309221)
 *   - env META_OAUTH_CALLBACK_URL = Function URL de meta-oauth-callback, REGISTRADO
 *     como "Valid OAuth Redirect URI" en la App de Meta (Facebook Login for Business).
 * Hasta que estén, responde 500 con instrucción clara.
 *
 * Docs: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { resolveTenantId } from "../_shared/cognitoAuth";
import { signOAuthState } from "../_shared/tenantSalesforce";

const secrets = new SecretsManagerClient({});
const META_SECRET = process.env.META_SECRET_NAME || "connectview/meta";
const CALLBACK_URL = process.env.META_OAUTH_CALLBACK_URL || "";
const DEFAULT_APP_ID = process.env.META_APP_ID || "932893188309221";
const GRAPH_VERSION = "v21.0";

// Permisos para DM (Instagram + Messenger) + comentarios + listar/gestionar páginas.
const SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_read_engagement",
  "pages_manage_metadata",
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_manage_comments",
].join(",");

const CORS: Record<string, string> = { "Content-Type": "application/json" };

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  queryStringParameters?: Record<string, string> | null;
  headers?: Record<string, string | undefined>;
}

const resp = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: CORS,
  body: JSON.stringify(body),
});

async function loadCreds(): Promise<{ appId: string; appSecret: string } | null> {
  try {
    const r = await secrets.send(new GetSecretValueCommand({ SecretId: META_SECRET }));
    if (!r.SecretString) return null;
    const p = JSON.parse(r.SecretString);
    if (!p.appSecret) return null;
    return { appId: String(p.appId || DEFAULT_APP_ID), appSecret: String(p.appSecret) };
  } catch {
    return null;
  }
}

export const handler = async (event: FnEvent) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return resp(200, {});

  const tenantId = await resolveTenantId(event.headers);
  if (!tenantId || tenantId === "default") {
    return resp(401, { error: "tenantId no resuelto (login Cognito requerido)" });
  }
  if (!CALLBACK_URL) {
    return resp(500, { error: "META_OAUTH_CALLBACK_URL no configurado (env del Lambda)" });
  }
  const creds = await loadCreds();
  if (!creds) {
    return resp(500, {
      error:
        "Falta appSecret en el secret connectview/meta. Registrá la App de Meta con Facebook " +
        "Login for Business y guarda { appId, appSecret } antes de conectar cuentas.",
    });
  }

  // state firmado (anti-CSRF): reusa el firmador de SF; el "environment" fija el proveedor.
  const state = encodeURIComponent(signOAuthState(tenantId, "meta", creds.appSecret));
  const redirectUri = encodeURIComponent(CALLBACK_URL);
  const authUrl =
    `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(creds.appId)}` +
    `&redirect_uri=${redirectUri}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${state}`;

  return resp(200, { authUrl, tenantId });
};
