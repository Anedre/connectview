/**
 * salesforce-oauth-callback — paso 2 del OAuth 2.0 Web Server flow.
 *
 * Salesforce redirige acá tras el consentimiento del usuario:
 *   GET /?code=<auth_code>&state=<tenantId|environment>
 *
 * Hacemos el code-for-token exchange contra SF, persistimos refresh_token +
 * instanceUrl en el secret per-tenant `connectview/tenant/<id>/salesforce`,
 * y redirigimos al usuario al frontend (/admin?sf=ok | ?sf=err).
 *
 * IMPORTANTE: SF redirige al navegador del usuario, NO trae el JWT de Cognito,
 * así que NO podemos verificar identidad acá. Confiamos en el `state` (que
 * salesforce-oauth-start firmó con el tenantId del JWT del usuario que arrancó
 * el flujo). Si hace falta endurecer, ver TODO de nonce abajo.
 */
import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { verifyOAuthState } from "../_shared/tenantSalesforce";

const secrets = new SecretsManagerClient({});
const ddb = new DynamoDBClient({});
const MASTER_SECRET = process.env.SF_SECRET_NAME || "connectview/salesforce";
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const CALLBACK_URL = process.env.SF_OAUTH_CALLBACK_URL || "";
// URL a la que redirigir al usuario tras el callback (ej. https://app.voxcrm.io/admin
// o http://localhost:5173/admin). Si no está, usamos el referer como mejor esfuerzo.
const APP_URL = process.env.VOX_APP_URL || "http://localhost:5173";

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  queryStringParameters?: Record<string, string> | null;
  headers?: Record<string, string | undefined>;
}

function redirectResp(url: string) {
  return {
    statusCode: 302,
    headers: { Location: url, "Content-Type": "text/plain" },
    body: "",
  };
}
function errResp(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

interface OAuthCreds {
  consumerKey: string;
  consumerSecret: string;
}
let cachedOauthCreds: OAuthCreds | null = null;
async function loadOauthCreds(): Promise<OAuthCreds | null> {
  if (cachedOauthCreds) return cachedOauthCreds;
  try {
    const r = await secrets.send(
      new GetSecretValueCommand({ SecretId: MASTER_SECRET })
    );
    if (!r.SecretString) return null;
    const parsed = JSON.parse(r.SecretString);
    if (!parsed.oauthConsumerKey || !parsed.oauthConsumerSecret) return null;
    cachedOauthCreds = {
      consumerKey: parsed.oauthConsumerKey,
      consumerSecret: parsed.oauthConsumerSecret,
    };
    return cachedOauthCreds;
  } catch (e) {
    console.error("loadOauthCreds error:", e);
    return null;
  }
}

function tenantSecretName(tenantId: string): string {
  return `connectview/tenant/${tenantId}/salesforce`;
}

async function putTenantSfSecret(
  tenantId: string,
  state: {
    refreshToken: string;
    instanceUrl: string;
    environment: "production" | "sandbox";
  }
): Promise<void> {
  const name = tenantSecretName(tenantId);
  const SecretString = JSON.stringify(state);
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
}

/** Refleja la conexión en connectview-connections para que la UI muestre el
 *  estado conectado sin necesidad de leer Secrets Manager desde el front. */
async function reflectConnectionState(
  tenantId: string,
  instanceUrl: string,
  environment: "production" | "sandbox"
): Promise<void> {
  // Leer config actual (puede tener Connect/WhatsApp config existente) y
  // agregarle el bloque salesforce sin pisar.
  let currentConfig: Record<string, unknown> = {};
  try {
    const r = await ddb.send(
      new GetItemCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { tenantId: { S: tenantId } },
      })
    );
    const json = r.Item?.configJson?.S;
    if (json) currentConfig = JSON.parse(json);
  } catch {
    /* tabla podría no existir aún en dev → seguimos */
  }
  currentConfig.salesforce = {
    connected: true,
    instanceUrl,
    environment,
    connectedAt: new Date().toISOString(),
  };
  await ddb.send(
    new PutItemCommand({
      TableName: CONNECTIONS_TABLE,
      Item: {
        tenantId: { S: tenantId },
        configJson: { S: JSON.stringify(currentConfig) },
        updatedAt: { S: new Date().toISOString() },
      },
    })
  );
}

function failRedirect(reason: string) {
  return redirectResp(
    `${APP_URL}/admin?sf=err&reason=${encodeURIComponent(reason)}`
  );
}

export const handler = async (event: FnEvent) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: {}, body: "" };

  const code = event.queryStringParameters?.code;
  const stateRaw = event.queryStringParameters?.state;
  const errorParam = event.queryStringParameters?.error;
  if (errorParam) {
    return failRedirect(
      `${errorParam}:${event.queryStringParameters?.error_description || ""}`
        .slice(0, 200)
    );
  }
  if (!code || !stateRaw) {
    return errResp(400, { error: "missing code/state" });
  }
  if (!CALLBACK_URL) {
    return errResp(500, { error: "SF_OAUTH_CALLBACK_URL no configurado" });
  }
  const oauth = await loadOauthCreds();
  if (!oauth) {
    return failRedirect("missing_oauth_creds");
  }

  // SEGURIDAD (anti-CSRF): verificar la FIRMA HMAC del state (+ exp). Si no
  // valida (forjado, manipulado o vencido), abortamos. Antes se parseaba el
  // state crudo → un atacante podía inyectar un tenantId arbitrario.
  const verified = verifyOAuthState(decodeURIComponent(stateRaw), oauth.consumerSecret);
  if (!verified) {
    return failRedirect("invalid_or_expired_state");
  }
  const tenantId = verified.tenantId;
  if (!tenantId || tenantId === "default") {
    return failRedirect("invalid_state");
  }
  const environment: "production" | "sandbox" = verified.environment === "sandbox" ? "sandbox" : "production";

  // Code-for-token exchange.
  const host =
    environment === "sandbox"
      ? "https://test.salesforce.com"
      : "https://login.salesforce.com";
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: oauth.consumerKey,
    client_secret: oauth.consumerSecret,
    redirect_uri: CALLBACK_URL,
  });
  const r = await fetch(`${host}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await r.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    instance_url?: string;
    error?: string;
  };
  if (!r.ok || !j.refresh_token || !j.instance_url) {
    // SEGURIDAD: NUNCA loguear `j` — puede contener access_token/refresh_token
    // (el secreto de mayor valor del sistema). Solo status + el campo error
    // (no sensible). Una respuesta 200 con token pero sin instance_url caería
    // acá y filtraría el token a CloudWatch.
    console.error("SF code-for-token falló:", r.status, j.error || "(sin error explícito)");
    return failRedirect(`exchange_failed:${j.error || r.status}`);
  }

  const instanceUrl = j.instance_url.replace(/\/$/, "");
  try {
    await putTenantSfSecret(tenantId, {
      refreshToken: j.refresh_token,
      instanceUrl,
      environment,
    });
    await reflectConnectionState(tenantId, instanceUrl, environment);
  } catch (e) {
    console.error("persist tenant SF state falló:", e);
    return failRedirect("persist_failed");
  }

  return redirectResp(`${APP_URL}/admin?sf=ok`);
};
