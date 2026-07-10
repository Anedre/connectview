/**
 * get-federation-token — federación silenciosa al CCP del tenant.
 *
 * Llamado por el frontend ANTES de inicializar el CCP. Si el Connect del
 * tenant fue creado en modo SAML, devuelve un `signInUrl` que el frontend
 * abre brevemente (iframe oculto o redirect) para establecer la sesión
 * SSO sin pasar por el popup de login de Connect.
 *
 * Devuelve 200 con { signInUrl, expiresAt } si la instancia soporta federación,
 * o 200 con { signInUrl: null, reason: "..." } si NO (instancia Connect-hosted-
 * credentials, etc.). El frontend, si recibe null, cae al flujo popup actual.
 *
 * Auth: JWT de Cognito en Authorization (tenantId del claim).
 * Multi-tenant: usa `resolveConnect` para asumir el rol cross-account del
 * tenant; si el tenant no configuró Connect, intenta con el legacy de Vox.
 */
import { ConnectClient, GetFederationTokenCommand } from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";
import { resolveTenantId } from "../_shared/cognitoAuth";

const legacyConnect = new ConnectClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

const CORS: Record<string, string> = {
  // CORS lo provee la Function URL (config de AWS). NO setear Access-Control-*
  // aquí: duplicaría Allow-Origin (uno del código + uno de AWS) y el browser
  // rechaza la respuesta con "Failed to fetch" (mismo quirk que web-form-capture).
  "Content-Type": "application/json",
};

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

  // Auth primero. Sin JWT → no podemos saber a qué tenant federar.
  const tenantId = await resolveTenantId(event.headers);
  if (!tenantId || tenantId === "default") {
    // Modo transición: dejamos pasar para que el legacy single-tenant pueda
    // probar el endpoint. En producción multi-tenant esto debería ser 401.
    console.warn("get-federation-token: sin tenantId (modo legacy/transición)");
  }

  try {
    const { client, instanceId } = await resolveConnect(event.headers, legacyConnect, INSTANCE_ID);
    if (!instanceId) {
      return resp(500, { error: "Amazon Connect no configurado para esta org" });
    }

    const res = await client.send(new GetFederationTokenCommand({ InstanceId: instanceId }));
    // El SDK devuelve { Credentials, SignInUrl, UserArn, UserId }. SignInUrl
    // es la URL que el browser abre para autenticarse silenciosamente.
    const signInUrl = res.SignInUrl || null;
    if (!signInUrl) {
      return resp(200, {
        signInUrl: null,
        reason: "no_signin_url_returned",
      });
    }
    return resp(200, {
      signInUrl,
      expiresAt: res.Credentials?.Expiration
        ? new Date(res.Credentials.Expiration).toISOString()
        : null,
      userArn: res.UserArn || null,
    });
  } catch (err) {
    // Caso esperado para instancias sin SAML configurado:
    //   InvalidRequestException · "instance ... is not configured to use SAML"
    // No es un error de Vox — el cliente tiene que (a) crear su instancia en
    // modo SAML, o (b) seguir con el popup login actual. Devolvemos 200 con
    // signInUrl=null para que el frontend caiga al fallback sin tirar error.
    const msg = err instanceof Error ? err.message : String(err);
    const code = err instanceof Error ? err.name : "UnknownError";
    if (code === "InvalidRequestException" && /SAML/i.test(msg)) {
      return resp(200, {
        signInUrl: null,
        reason: "instance_not_saml",
        message: msg.slice(0, 200),
      });
    }
    console.error("get-federation-token error:", err);
    return resp(502, {
      error: "GetFederationToken falló",
      code,
      message: msg.slice(0, 300),
    });
  }
};
