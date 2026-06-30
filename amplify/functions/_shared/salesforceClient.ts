import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createSign } from "node:crypto";
import { getTenantSfToken, clearTenantTokenCache } from "./tenantSalesforce";
import { isLegacyTenant } from "./cognitoAuth";

/**
 * salesforceClient — minimal Salesforce REST helper for the Vox connector.
 *
 * Auth: OAuth 2.0 **JWT Bearer Flow** (server-to-server, no user, no secret).
 * The Lambda signs a JWT with a private key whose matching cert is on the
 * "Vox Connector" Connected App. This is the path we can fully provision via
 * the Salesforce CLI (the consumer SECRET can't be read via CLI, but the
 * consumer KEY can, and we generate the keypair ourselves).
 *
 * Secret (name from SF_SECRET_NAME, default "connectview/salesforce"):
 *   { consumerKey, username, privateKey, audience? }
 *   - consumerKey: the Connected App's OAuth consumer key (retrieved via CLI)
 *   - username:    the SF user the token runs as (admin)
 *   - privateKey:  PEM private key (matches the cert on the Connected App)
 *   - audience:    auth host for the JWT aud claim, default
 *                  https://login.salesforce.com
 *
 * The access token (and the instance_url it returns) is cached in module
 * scope for the warm Lambda's lifetime.
 */
const secrets = new SecretsManagerClient({});
const SECRET_NAME = process.env.SF_SECRET_NAME || "connectview/salesforce";
const API_VERSION = process.env.SF_API_VERSION || "v60.0";

interface SfCreds {
  consumerKey: string;
  username: string;
  privateKey: string;
  audience: string;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

interface TokenState {
  accessToken: string;
  instanceUrl: string;
  fetchedAt: number;
}

let cachedCreds: SfCreds | null = null;
let cachedToken: TokenState | null = null;
// Refresh a bit before the (unknown) expiry; client-credentials tokens
// typically live 1-2h. We re-fetch every 30 min to stay safely valid.
const TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Tenant activo del request actual. Lambdas multi-tenant (los que reciben JWT)
 * lo setean al inicio del handler con `setActiveTenant(await resolveTenantId(headers))`.
 * Los helpers `soql`/`insertSObject`/etc. luego usan SU token vía
 * `getTenantSfToken`. Si el tenant no conectó SF (o es "default"), `getToken`
 * cae al flujo JWT-bearer legacy (cuenta unificada de Vox/Novasys).
 * Seguro porque Lambda procesa un evento a la vez por contenedor.
 */
let activeTenantId: string | null = null;

// Tenants que PUEDEN usar el SF master/legacy (JWT-bearer, la org de Novasys)
// como fallback cuando no tienen su propio OAuth per-tenant. Puente de
// transición: hoy el fundador (Novasys) corre como tenant REAL `t_…` (con su
// BYO data plane) pero su Salesforce sigue siendo la org master. Va por env
// (config, NO hardcode) y es SOLO para SF — no se toca `isLegacyTenant` global
// (eso le rompería el data plane BYO, que sí es suyo en su cuenta).
const MASTER_SF_TENANT_IDS = new Set(
  (process.env.MASTER_SF_TENANT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export function setActiveTenant(tenantId: string | null): void {
  // null → flujo legacy JWT-bearer (la org master de Novasys). Mapean a null:
  //  - los alias del fundador (default / novasys) vía isLegacyTenant,
  //  - los tenants en MASTER_SF_TENANT_IDS (el fundador como tenant real `t_…`).
  // Un tenant REAL fuera de esa lista se mantiene → su token OAuth web; si no
  // conectó SF, getToken BLOQUEA (no cae al SF de Novasys = sin leak cross-tenant).
  const usesMasterSf = !tenantId || isLegacyTenant(tenantId) || MASTER_SF_TENANT_IDS.has(tenantId);
  activeTenantId = usesMasterSf ? null : tenantId;
}

async function loadCreds(): Promise<SfCreds> {
  if (cachedCreds) return cachedCreds;
  const res = await secrets.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
  if (!res.SecretString) throw new Error("Salesforce secret is empty");
  const parsed = JSON.parse(res.SecretString);
  if (!parsed.consumerKey || !parsed.username || !parsed.privateKey) {
    throw new Error("Salesforce secret must have consumerKey, username, privateKey");
  }
  cachedCreds = {
    consumerKey: parsed.consumerKey,
    username: parsed.username,
    // PEM may be stored with literal \n — normalise to real newlines.
    privateKey: String(parsed.privateKey).replace(/\\n/g, "\n"),
    audience: parsed.audience || "https://login.salesforce.com",
  };
  return cachedCreds;
}

/** Build + RS256-sign a JWT assertion for the SF JWT Bearer flow. */
function buildAssertion(creds: SfCreds): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: creds.consumerKey,
      sub: creds.username,
      aud: creds.audience,
      exp: Math.floor(Date.now() / 1000) + 180, // 3 min
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(creds.privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

/** Get a valid access token + instance URL, fetching/refreshing as needed.
 *  Si hay tenant activo Y tiene SF conectado, devuelve SU token (OAuth web +
 *  refresh_token); si no, cae al flujo JWT-bearer legacy con el secret
 *  compartido `connectview/salesforce`. */
export async function getToken(force = false): Promise<TokenState> {
  // ① Tenant-scoped (OAuth web flow per-tenant)
  if (activeTenantId) {
    // force=true (retry-on-401) → invalidar el cache del tenant para que
    // efectivamente vaya a SF a refrescar contra el refresh_token.
    if (force) clearTenantTokenCache(activeTenantId);
    const tt = await getTenantSfToken(activeTenantId);
    if (tt) {
      return {
        accessToken: tt.accessToken,
        instanceUrl: tt.instanceUrl,
        // Tenant tokens ya están cacheados ~25min en tenantSalesforce — no
        // duplicamos cache acá; sólo devolvemos el snapshot fresh.
        fetchedAt: Date.now(),
      };
    }
    // SEGURIDAD multi-tenant: un tenant REAL sin SF propio NO debe caer al SF
    // compartido de Novasys — sería un leak cross-tenant (leería/escribiría en
    // la org del fundador). Bloqueamos explícito. Los callers lo toleran:
    // propagateLead envuelve el push en try/catch (el lead igual persiste en
    // Dynamo + Customer Profile) y el read-mode de salesforce-sync lo traduce a
    // "SF no conectado" en vez de un 502.
    throw new Error(`SF_NOT_CONNECTED: la organización ${activeTenantId} no conectó Salesforce`);
  }

  // ② Legacy single-tenant (JWT bearer, Novasys).
  if (!force && cachedToken && Date.now() - cachedToken.fetchedAt < TOKEN_TTL_MS) {
    return cachedToken;
  }
  const creds = await loadCreds();
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: buildAssertion(creds),
  });
  const r = await fetch(`${creds.audience}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.access_token) {
    // SEGURIDAD: solo el campo error, no el objeto completo (podría traer token).
    throw new Error(`SF token failed: ${r.status} ${json.error || "(sin error)"}`);
  }
  cachedToken = {
    accessToken: json.access_token,
    // instance_url from the token response is the canonical API base
    // (the org My Domain), used for all subsequent REST calls.
    instanceUrl: json.instance_url || creds.audience,
    fetchedAt: Date.now(),
  };
  return cachedToken;
}

interface SfResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

/** Low-level REST call against the org. Path is relative to /services/data/<ver>/. */
export async function sfFetch(method: string, path: string, body?: unknown): Promise<SfResponse> {
  let tok = await getToken();
  const url = `${tok.instanceUrl}/services/data/${API_VERSION}/${path.replace(/^\//, "")}`;
  const doCall = async (t: TokenState) =>
    fetch(url.replace(tok.instanceUrl, t.instanceUrl), {
      method,
      headers: {
        Authorization: `Bearer ${t.accessToken}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  let r = await doCall(tok);
  // One retry on 401 with a forced token refresh (token may have expired).
  if (r.status === 401) {
    tok = await getToken(true);
    r = await doCall(tok);
  }
  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* leave as text */
  }
  return { ok: r.ok, status: r.status, body: parsed };
}

/** SOQL query → records array. */
export async function soql(query: string): Promise<Record<string, unknown>[]> {
  const res = await sfFetch("GET", `query/?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    throw new Error(`SOQL failed: ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return (res.body as { records?: Record<string, unknown>[] }).records || [];
}

/** Insert an sObject. Returns the new record id. */
export async function insertSObject(
  sobject: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const res = await sfFetch("POST", `sobjects/${sobject}`, fields);
  if (!res.ok) {
    throw new Error(`Insert ${sobject} failed: ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return (res.body as { id: string }).id;
}

/** Update an sObject by id (PATCH). */
export async function updateSObject(
  sobject: string,
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const res = await sfFetch("PATCH", `sobjects/${sobject}/${id}`, fields);
  if (!res.ok) {
    throw new Error(`Update ${sobject}/${id} failed: ${JSON.stringify(res.body).slice(0, 300)}`);
  }
}

/** Escape a value for safe inclusion in a SOQL string literal. */
export function soqlEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Pilar 10 — un campo escribible del sObject (para el mapeo schema-aware). */
export interface SfDescribeField {
  name: string;
  label: string;
  type: string;
  custom: boolean;
  createable: boolean;
  updateable: boolean;
  nillable: boolean;
  /** Valores de picklist (si type === "picklist"). */
  picklistValues?: { label: string; value: string }[];
}

/**
 * Describe un sObject de la org del tenant → campos ESCRIBIBLES (createable o
 * updateable), para que el admin mapee los campos de ARIA a los suyos. Read-only.
 * No incluye campos de solo lectura (Id, system, formula).
 */
export async function describeSObject(sobject = "Lead"): Promise<SfDescribeField[]> {
  const res = await sfFetch("GET", `sobjects/${sobject}/describe/`);
  if (!res.ok) {
    throw new Error(`Describe ${sobject} failed: ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields = (res.body as { fields?: any[] }).fields || [];
  return fields
    .filter((f) => f && (f.createable || f.updateable))
    .map((f) => ({
      name: String(f.name),
      label: String(f.label || f.name),
      type: String(f.type || "string"),
      custom: !!f.custom,
      createable: !!f.createable,
      updateable: !!f.updateable,
      nillable: !!f.nillable,
      picklistValues: Array.isArray(f.picklistValues)
        ? f.picklistValues
            .filter((p: { active?: boolean }) => p && p.active !== false)
            .map((p: { label?: string; value?: string }) => ({
              label: String(p.label || p.value),
              value: String(p.value),
            }))
        : undefined,
    }))
    .sort((a, b) => Number(b.custom) - Number(a.custom) || a.label.localeCompare(b.label));
}
