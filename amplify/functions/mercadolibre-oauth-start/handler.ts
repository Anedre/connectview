/**
 * mercadolibre-oauth-start — paso 1 del OAuth 2.0 (Authorization Code) de Mercado
 * Libre (F4.1, skeleton). Recibe ?siteId=MPE|MLA|… + el JWT de Cognito; devuelve
 * { authUrl } a la que el frontend redirige. ML pide consentimiento y redirige a
 * la callback con ?code=… + &state (firmado, anti-CSRF).
 *
 * Build-ahead: necesita que Vox tenga registrada una App de ML con:
 *   - appId + appSecret en el secret `connectview/mercadolibre`
 *   - Redirect URI = el Function URL de `mercadolibre-oauth-callback` (env ML_OAUTH_CALLBACK_URL)
 * Hasta que el cliente cree la App, este Lambda responde 500 con instrucción clara.
 * El callback (token exchange + guardado del secret del tenant) es el paso que
 * sigue, gated por las mismas credenciales.
 *
 * Docs: https://developers.mercadolibre.com.ar/en_us/authentication-and-authorization
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { resolveTenantId } from "../_shared/cognitoAuth";
import { signOAuthState } from "../_shared/tenantSalesforce";

const secrets = new SecretsManagerClient({});
const MASTER_SECRET = process.env.ML_SECRET_NAME || "connectview/mercadolibre";
const CALLBACK_URL = process.env.ML_OAUTH_CALLBACK_URL || "";

const CORS: Record<string, string> = { "Content-Type": "application/json" };

// Host de autorización por sitio de ML (país). Default Perú (MPE) para UDEP.
const AUTH_HOST: Record<string, string> = {
  MPE: "https://auth.mercadolibre.com.pe",
  MLA: "https://auth.mercadolibre.com.ar",
  MLB: "https://auth.mercadolivre.com.br",
  MLM: "https://auth.mercadolibre.com.mx",
  MLC: "https://auth.mercadolibre.cl",
  MCO: "https://auth.mercadolibre.com.co",
  MLU: "https://auth.mercadolibre.com.uy",
};

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
    const r = await secrets.send(new GetSecretValueCommand({ SecretId: MASTER_SECRET }));
    if (!r.SecretString) return null;
    const p = JSON.parse(r.SecretString);
    if (!p.appId || !p.appSecret) return null;
    return { appId: String(p.appId), appSecret: String(p.appSecret) };
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
    return resp(500, { error: "ML_OAUTH_CALLBACK_URL no configurado (env del Lambda)" });
  }
  const creds = await loadCreds();
  if (!creds) {
    return resp(500, {
      error:
        "Falta appId/appSecret en el secret connectview/mercadolibre (registrar la App de Mercado Libre primero).",
    });
  }

  const siteId = (event.queryStringParameters?.siteId || "MPE").toUpperCase();
  const authHost = AUTH_HOST[siteId] || AUTH_HOST.MPE;

  // state firmado (anti-CSRF): reusa el firmador de SF; el "environment" lleva el siteId.
  const state = encodeURIComponent(signOAuthState(tenantId, siteId, creds.appSecret));
  const redirectUri = encodeURIComponent(CALLBACK_URL);
  const authUrl =
    `${authHost}/authorization` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(creds.appId)}` +
    `&redirect_uri=${redirectUri}` +
    `&state=${state}`;

  return resp(200, { authUrl, tenantId, siteId });
};
