/**
 * meta-oauth-callback — paso 2 del "Login con Facebook" (OAuth) para conectar las
 * cuentas de Instagram / Messenger / Facebook de un tenant (auto-servicio
 * multi-cuenta, estilo Chattigo/ManyChat). Meta redirige acá tras el
 * consentimiento del usuario:
 *
 *   GET /?code=<auth_code>&state=<firmado>
 *
 * Hacemos:
 *   1. verificar el `state` (firma HMAC + exp) → sacar el tenantId (anti-CSRF).
 *   2. code → user token (long-lived) con el App Secret.
 *   3. GET /me/accounts → LISTA de páginas del usuario + su page token + el
 *      Instagram Business Account conectado (si tiene).
 *   4. guardar esa lista (con los page tokens) en el secret del tenant bajo
 *      `pending` — NO la elegimos todavía: el usuario tilda cuáles traer en la UI
 *      (manage-connections listMetaAccounts / saveMetaAccounts). Los page tokens
 *      NUNCA viajan al navegador (igual que el refresh_token de Salesforce).
 *   5. redirigir al frontend (/admin?meta=connected | ?meta=err&reason=…).
 *
 * IMPORTANTE: Meta redirige al navegador del usuario, sin el JWT de Cognito → no
 * podemos verificar identidad acá; confiamos en el `state` firmado que
 * meta-oauth-start generó con el tenantId del JWT de quien inició el flujo.
 *
 * Build-ahead (calcado de salesforce-oauth-callback + mercadolibre): necesita el
 * secret maestro `connectview/meta` { appId?, appSecret } + env
 * META_OAUTH_CALLBACK_URL (registrado como Valid OAuth Redirect URI en la App de
 * Meta) + VOX_APP_URL. Hasta entonces redirige con ?meta=err.
 *
 * Docs: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
 *       https://developers.facebook.com/docs/pages/access-tokens
 */
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { verifyOAuthState } from "../_shared/tenantSalesforce";
import {
  readMetaSecret,
  writeMetaSecret,
  type PendingPage,
} from "../_shared/metaAccounts";

const secrets = new SecretsManagerClient({});
const META_SECRET = process.env.META_SECRET_NAME || "connectview/meta";
const CALLBACK_URL = process.env.META_OAUTH_CALLBACK_URL || "";
const DEFAULT_APP_ID = process.env.META_APP_ID || "932893188309221";
const APP_URL = process.env.VOX_APP_URL || "http://localhost:5173";
const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  queryStringParameters?: Record<string, string> | null;
  headers?: Record<string, string | undefined>;
}

function redirectResp(url: string) {
  return { statusCode: 302, headers: { Location: url, "Content-Type": "text/plain" }, body: "" };
}
function errResp(statusCode: number, body: unknown) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
function failRedirect(reason: string) {
  return redirectResp(`${APP_URL}/admin?meta=err&reason=${encodeURIComponent(reason.slice(0, 200))}`);
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function graphGet(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${GRAPH}/${path}?${qs}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) {
    // SEGURIDAD: nunca serializar `j` completo (puede llevar tokens) — solo el
    // mensaje de error de Meta (no sensible).
    throw new Error(j?.error?.message || `HTTP ${r.status}`);
  }
  return j;
}

/** code → user token corto → long-lived user token. Los page tokens derivados de
 *  un user token de larga duración no expiran (mientras el permiso siga vigente). */
async function exchangeCodeForUserToken(
  code: string,
  creds: { appId: string; appSecret: string },
): Promise<string> {
  const short = await graphGet("oauth/access_token", {
    client_id: creds.appId,
    client_secret: creds.appSecret,
    redirect_uri: CALLBACK_URL,
    code,
  });
  if (!short.access_token) throw new Error("sin access_token en el intercambio");
  // Cambiar a long-lived (best-effort: si falla, seguimos con el corto).
  try {
    const long = await graphGet("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: creds.appId,
      client_secret: creds.appSecret,
      fb_exchange_token: short.access_token,
    });
    if (long.access_token) return long.access_token;
  } catch {
    /* seguimos con el token corto */
  }
  return short.access_token;
}

/** Todas las páginas que administra el usuario + su page token + el IG conectado. */
async function fetchPages(userToken: string): Promise<PendingPage[]> {
  const pages: PendingPage[] = [];
  let after: string | undefined;
  // Cota de seguridad: hasta ~10 páginas de resultados (Meta pagina de a ~25).
  for (let i = 0; i < 10; i++) {
    const params: Record<string, string> = {
      access_token: userToken,
      fields: "name,access_token,instagram_business_account{id,username}",
      limit: "50",
    };
    if (after) params.after = after;
    const j = await graphGet("me/accounts", params);
    for (const p of j.data || []) {
      if (!p.id || !p.access_token) continue;
      pages.push({
        pageId: String(p.id),
        pageName: p.name ? String(p.name) : undefined,
        igId: p.instagram_business_account?.id ? String(p.instagram_business_account.id) : undefined,
        igUsername: p.instagram_business_account?.username
          ? String(p.instagram_business_account.username)
          : undefined,
        pageToken: String(p.access_token),
      });
    }
    after = j.paging?.cursors?.after;
    if (!after || !(j.paging?.next)) break;
  }
  return pages;
}

export const handler = async (event: FnEvent) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: {}, body: "" };

  const code = event.queryStringParameters?.code;
  const stateRaw = event.queryStringParameters?.state;
  const errorParam = event.queryStringParameters?.error;
  if (errorParam) {
    return failRedirect(
      `${errorParam}:${event.queryStringParameters?.error_description || ""}`,
    );
  }
  if (!code || !stateRaw) return errResp(400, { error: "missing code/state" });
  if (!CALLBACK_URL) return errResp(500, { error: "META_OAUTH_CALLBACK_URL no configurado" });

  const creds = await loadCreds();
  if (!creds) return failRedirect("missing_app_secret");

  // Anti-CSRF: verificar la FIRMA del state (+ exp). El firmante fue
  // meta-oauth-start con el mismo appSecret; un state forjado/vencido aborta.
  const verified = verifyOAuthState(decodeURIComponent(stateRaw), creds.appSecret);
  if (!verified) return failRedirect("invalid_or_expired_state");
  const tenantId = verified.tenantId;
  if (!tenantId || tenantId === "default") return failRedirect("invalid_state");

  try {
    const userToken = await exchangeCodeForUserToken(code, creds);
    const pages = await fetchPages(userToken);
    if (!pages.length) return failRedirect("no_pages");

    // Guardar las páginas + page tokens en el secret del tenant, como `pending`.
    // El usuario elige cuáles traer en la UI; recién ahí pasan a definitivas.
    const secret = await readMetaSecret(secrets, tenantId);
    secret.pending = { at: new Date().toISOString(), pages };
    await writeMetaSecret(secrets, tenantId, secret);
  } catch (e) {
    // SEGURIDAD: solo el mensaje, nunca el objeto (podría contener tokens).
    console.error("meta-oauth-callback falló:", e instanceof Error ? e.message : "error");
    return failRedirect("exchange_failed");
  }

  // Redirigimos con `meta=connected`: el frontend abre el modal para tildar
  // cuáles cuentas traer (lee la lista pendiente sin tokens vía manage-connections).
  return redirectResp(`${APP_URL}/admin?meta=connected`);
};
