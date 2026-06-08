/**
 * tenantSalesforce — resuelve el access_token de Salesforce del CLIENTE (tenant)
 * para llamadas server-side, vía OAuth 2.0 Web Server flow + refresh_token.
 *
 * Patrón: Connected App COMPARTIDA (Vox la registra una sola vez en su dev org;
 * cada cliente la autoriza desde SU org de Salesforce). Diferencia del helper
 * legacy `salesforceClient.ts` (JWT bearer + secret único = single-tenant):
 *  - aquí cada tenant tiene su `connectview/tenant/<id>/salesforce` con su
 *    refresh_token + instanceUrl + environment;
 *  - usamos las credenciales de Vox (`oauthConsumerKey`/`oauthConsumerSecret`
 *    del secret `connectview/salesforce`) para refrescar.
 *
 * El refresh_token vive en Secrets Manager — NUNCA viaja al cliente; el access
 * token cacheado dura ~25 min (los de SF expiran a las 2h pero somos conservadores).
 *
 * Devuelve null cuando el tenant todavía no completó el OAuth → el caller cae
 * a su `salesforceClient` legacy para no romper el comportamiento single-tenant.
 */
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveTenantId } from "./cognitoAuth";

const secrets = new SecretsManagerClient({});
const MASTER_SECRET = process.env.SF_SECRET_NAME || "connectview/salesforce";
const API_VERSION = process.env.SF_API_VERSION || "v60.0";

/* ───────── OAuth state firmado (anti-CSRF, #44 endurecimiento) ──────────────
 * El `state` del OAuth de Salesforce viaja por el navegador y SF lo refleja
 * en el callback. Si fuera solo `tenantId|environment` (predecible), un
 * atacante podría armar un callback con SU code + el state de la víctima y
 * vincular la org SF del atacante al tenant de la víctima (CSRF de conexión).
 *
 * Fix: el state se FIRMA con HMAC-SHA256 usando un secreto del server + lleva
 * un `exp` (vence en 10 min). El atacante no puede forjar un state válido sin
 * el secreto, y uno robado caduca rápido. El callback verifica firma + exp.
 */
const STATE_TTL_MS = 10 * 60 * 1000;
function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}
function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Firma un state OAuth. `secret` = oauthConsumerSecret de Vox (server-side). */
export function signOAuthState(
  tenantId: string,
  environment: string,
  secret: string
): string {
  const payload = b64url(
    JSON.stringify({ t: tenantId, e: environment, x: Date.now() + STATE_TTL_MS })
  );
  return `${payload}.${hmac(payload, secret)}`;
}

/** Verifica un state OAuth. Devuelve { tenantId, environment } o null si la
 *  firma no valida o venció. */
export function verifyOAuthState(
  state: string,
  secret: string
): { tenantId: string; environment: string } | null {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = hmac(payload, secret);
  // Comparación constant-time.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof obj.x !== "number" || obj.x < Date.now()) return null; // vencido
    if (!obj.t || typeof obj.t !== "string") return null;
    return { tenantId: obj.t, environment: obj.e === "sandbox" ? "sandbox" : "production" };
  } catch {
    return null;
  }
}

/** Credenciales del Connected App SHARED de Vox (mismo para todos los tenants). */
interface OAuthCreds {
  consumerKey: string;
  consumerSecret: string;
}
/** Estado guardado por tenant (lo que escribimos tras el callback OAuth). */
export interface TenantSfState {
  refreshToken: string;
  instanceUrl: string;
  environment?: "production" | "sandbox";
}

let cachedOauthCreds: OAuthCreds | null = null;

async function loadOauthCreds(): Promise<OAuthCreds | null> {
  if (cachedOauthCreds) return cachedOauthCreds;
  try {
    const res = await secrets.send(
      new GetSecretValueCommand({ SecretId: MASTER_SECRET })
    );
    if (!res.SecretString) return null;
    const parsed = JSON.parse(res.SecretString);
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

interface TokenEntry {
  accessToken: string;
  instanceUrl: string;
  exp: number;
}
const tokenCache = new Map<string, TokenEntry>();
const TOKEN_TTL_MS = 25 * 60 * 1000;

function tenantSecretName(tenantId: string): string {
  return `connectview/tenant/${tenantId}/salesforce`;
}

async function readTenantState(tenantId: string): Promise<TenantSfState | null> {
  try {
    const r = await secrets.send(
      new GetSecretValueCommand({ SecretId: tenantSecretName(tenantId) })
    );
    if (!r.SecretString) return null;
    const parsed = JSON.parse(r.SecretString);
    if (!parsed.refreshToken || !parsed.instanceUrl) return null;
    return {
      refreshToken: parsed.refreshToken,
      instanceUrl: String(parsed.instanceUrl).replace(/\/$/, ""),
      environment: parsed.environment,
    };
  } catch (e) {
    // ResourceNotFoundException → el tenant no conectó SF todavía.
    if (e instanceof Error && e.name === "ResourceNotFoundException") return null;
    console.error("readTenantState error:", e);
    return null;
  }
}

/** Endpoint OAuth (login.salesforce.com / test.salesforce.com) según env. */
export function sfAuthHost(env?: "production" | "sandbox"): string {
  return env === "sandbox"
    ? "https://test.salesforce.com"
    : "https://login.salesforce.com";
}

/** Cambia un refresh_token por un access_token nuevo. Devuelve null si SF rechaza
 *  (típicamente: el usuario revocó la app desde su org). */
async function refreshAccessToken(
  oauth: OAuthCreds,
  state: TenantSfState
): Promise<{ accessToken: string; instanceUrl: string } | null> {
  const host = sfAuthHost(state.environment);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: oauth.consumerKey,
    client_secret: oauth.consumerSecret,
    refresh_token: state.refreshToken,
  });
  const r = await fetch(`${host}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await r.json().catch(() => ({}))) as {
    access_token?: string;
    instance_url?: string;
    error?: string;
  };
  if (!r.ok || !j.access_token) {
    // SEGURIDAD: solo loguear el campo `error`, nunca `JSON.stringify(j)`
    // (podría capturar un access_token si SF devuelve token sin instance_url).
    console.error(`SF refresh_token rechazado (${r.status}): ${j.error || "(sin error)"}`);
    return null;
  }
  return {
    accessToken: j.access_token,
    instanceUrl: j.instance_url || state.instanceUrl,
  };
}

export interface TenantSfToken {
  accessToken: string;
  instanceUrl: string;
}

/** Invalida el access_token cacheado del tenant. Usado en el retry-on-401 del
 *  cliente legacy (salesforceClient) para que el próximo getToken realmente
 *  haga refresh contra SF en vez de devolver el snapshot stale. */
export function clearTenantTokenCache(tenantId: string): void {
  tokenCache.delete(tenantId);
}

/** Token vivo del tenant. Cacheado ~25 min. Devuelve null si el tenant no conectó
 *  Salesforce o si el refresh falló (token revocado). */
export async function getTenantSfToken(
  tenantId: string
): Promise<TenantSfToken | null> {
  if (!tenantId || tenantId === "default") return null;
  const hit = tokenCache.get(tenantId);
  if (hit && hit.exp > Date.now()) {
    return { accessToken: hit.accessToken, instanceUrl: hit.instanceUrl };
  }
  const oauth = await loadOauthCreds();
  if (!oauth) return null;
  const state = await readTenantState(tenantId);
  if (!state) return null;
  const minted = await refreshAccessToken(oauth, state);
  if (!minted) return null;
  tokenCache.set(tenantId, {
    accessToken: minted.accessToken,
    instanceUrl: minted.instanceUrl,
    exp: Date.now() + TOKEN_TTL_MS,
  });
  return minted;
}

/** Resuelve el tenant del request a partir del JWT y devuelve su token SF.
 *  Si no hay token tenant-scoped, devuelve null → el caller usa el fallback
 *  legacy (`salesforceClient.getToken()` con JWT bearer). */
export async function resolveSf(
  headers: Record<string, string | undefined> | undefined
): Promise<TenantSfToken | null> {
  try {
    const tenantId = await resolveTenantId(headers);
    return getTenantSfToken(tenantId);
  } catch (e) {
    console.error("resolveSf falló:", e);
    return null;
  }
}

interface SfResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

/** REST call tenant-scoped. Path es relativo a /services/data/<ver>/. */
export async function sfFetchForTenant(
  tenantId: string,
  method: string,
  path: string,
  body?: unknown
): Promise<SfResponse | null> {
  let tok = await getTenantSfToken(tenantId);
  if (!tok) return null;
  const buildUrl = (t: TenantSfToken) =>
    `${t.instanceUrl}/services/data/${API_VERSION}/${path.replace(/^\//, "")}`;
  const doCall = async (t: TenantSfToken) =>
    fetch(buildUrl(t), {
      method,
      headers: {
        Authorization: `Bearer ${t.accessToken}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  let r = await doCall(tok);
  if (r.status === 401) {
    // Forzar refresh y reintentar UNA vez.
    tokenCache.delete(tenantId);
    tok = await getTenantSfToken(tenantId);
    if (!tok) return null;
    r = await doCall(tok);
  }
  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* deja como texto */
  }
  return { ok: r.ok, status: r.status, body: parsed };
}
