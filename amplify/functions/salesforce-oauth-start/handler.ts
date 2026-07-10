/**
 * salesforce-oauth-start — paso 1 del OAuth 2.0 Web Server flow.
 *
 * Recibe: ?environment=production|sandbox (default production), y el JWT de
 * Cognito en el Authorization header.
 *
 * Devuelve: { authUrl } — URL a la que el frontend redirige al usuario.
 * Salesforce recibe consentimiento del usuario y nos redirige a la callback
 * con ?code=... reflectando &state=tenantId|environment.
 *
 * Para que esto funcione, Vox tiene que tener un Connected App registrado
 * en su org dev de Salesforce con:
 *   - OAuth scopes: api, refresh_token, offline_access
 *   - Callback URL: el Function URL del Lambda `salesforce-oauth-callback`
 *   - oauthConsumerKey + oauthConsumerSecret en el secret `connectview/salesforce`
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { resolveTenantId } from "../_shared/cognitoAuth";
import { sfAuthHost, signOAuthState } from "../_shared/tenantSalesforce";

const secrets = new SecretsManagerClient({});
const MASTER_SECRET = process.env.SF_SECRET_NAME || "connectview/salesforce";
// URL completa del Function URL de salesforce-oauth-callback (configurada por
// env en el deploy; tiene que coincidir EXACTAMENTE con la Callback URL del
// Connected App de Salesforce).
const CALLBACK_URL = process.env.SF_OAUTH_CALLBACK_URL || "";

const CORS: Record<string, string> = {
  // CORS lo provee la Function URL (config de AWS). NO setear Access-Control-*
  // aquí: duplicaría Allow-Origin (uno del código + uno de AWS) y el browser
  // rechaza la respuesta con "Failed to fetch" (mismo quirk que web-form-capture).
  "Content-Type": "application/json",
};

let cachedCreds: { key: string; secret: string } | null = null;
/** Carga consumerKey + consumerSecret (este último firma el state anti-CSRF). */
async function loadCreds(): Promise<{ key: string; secret: string } | null> {
  if (cachedCreds) return cachedCreds;
  try {
    const r = await secrets.send(new GetSecretValueCommand({ SecretId: MASTER_SECRET }));
    if (!r.SecretString) return null;
    const parsed = JSON.parse(r.SecretString);
    if (!parsed.oauthConsumerKey || !parsed.oauthConsumerSecret) return null;
    cachedCreds = { key: parsed.oauthConsumerKey, secret: parsed.oauthConsumerSecret };
    return cachedCreds;
  } catch (e) {
    console.error("loadCreds error:", e);
    return null;
  }
}

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  queryStringParameters?: Record<string, string> | null;
  headers?: Record<string, string | undefined>;
}

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export const handler = async (event: FnEvent) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return resp(200, {});

  // Auth primero: no revelar setup interno (consumer key, callback URL) sin JWT.
  const tenantId = await resolveTenantId(event.headers);
  if (!tenantId || tenantId === "default") {
    return resp(401, {
      error: "tenantId no resuelto (login Cognito requerido)",
    });
  }
  if (!CALLBACK_URL) {
    return resp(500, {
      error: "SF_OAUTH_CALLBACK_URL no configurado (env del Lambda)",
    });
  }
  const creds = await loadCreds();
  if (!creds) {
    return resp(500, {
      error:
        "Falta oauthConsumerKey/Secret en el secret connectview/salesforce (registrar el Connected App primero)",
    });
  }
  const consumerKey = creds.key;

  const envParam = (event.queryStringParameters?.environment || "production").toLowerCase();
  const environment: "production" | "sandbox" = envParam === "sandbox" ? "sandbox" : "production";

  // SEGURIDAD (anti-CSRF): el state va FIRMADO con HMAC + exp (10 min). Antes
  // era `tenantId|environment` en claro → un atacante podía armar un callback
  // con su code + el state de la víctima y vincular su org SF al tenant ajeno.
  // Ahora el atacante no puede forjar un state válido sin el consumerSecret.
  const state = encodeURIComponent(signOAuthState(tenantId, environment, creds.secret));
  const scope = encodeURIComponent("api refresh_token offline_access");
  const redirectUri = encodeURIComponent(CALLBACK_URL);

  const authUrl =
    `${sfAuthHost(environment)}/services/oauth2/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(consumerKey)}` +
    `&redirect_uri=${redirectUri}` +
    `&scope=${scope}` +
    `&state=${state}` +
    // prompt=login fuerza siempre el login (evita pegarle al SSO del usuario
    // que ya esté logueado en OTRA org si está mezclando entornos).
    `&prompt=login`;

  return resp(200, { authUrl, tenantId, environment });
};
