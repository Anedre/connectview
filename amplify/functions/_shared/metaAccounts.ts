/**
 * metaAccounts — modelo multi-cuenta de Instagram / Messenger / Facebook por
 * tenant (auto-servicio "Conectar con Facebook", estilo Chattigo/ManyChat).
 * Un tenant puede conectar VARIAS páginas de Facebook; cada página trae Messenger
 * (de la propia página) y, si tiene un Instagram Business Account conectado,
 * también IG DM.
 *
 * Separación de datos (mismo criterio que el resto del SaaS):
 *  · Metadata NO sensible (pageId, nombre, igId, @user) → configJson del tenant
 *    (`connectview-connections` → meta.accounts[]). La ve el frontend.
 *  · Page tokens (SECRETOS) → Secrets Manager `connectview/tenant/<id>/meta`.
 *    NUNCA en DynamoDB ni en el navegador (igual que el refresh_token de SF).
 *
 * Retrocompat: el esquema previo era 1 cuenta por tenant en `meta.pageId` /
 * `meta.igId` (singular). `normalizeMetaAccounts` lo trata como accounts[0] si el
 * tenant todavía no migró, así el enrutado sigue funcionando sin tocar su config.
 *
 * Este archivo lo bundlean 3 Lambdas hand-managed: manage-connections (guardar),
 * meta-messaging-webhook (enrutar inbound) y manage-conversations (responder
 * desde la cuenta correcta). 🔑 al tocarlo, re-desplegar los 3.
 */
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

/** Cuenta conectada (parte NO sensible, guardada en configJson.meta.accounts). */
export interface MetaAccount {
  /** Id canónico en ARIA = pageId de Facebook. */
  id: string;
  pageId: string;
  pageName?: string;
  /** Instagram Business Account conectado a la página (si lo tiene). */
  igId?: string;
  igUsername?: string;
  addedAt?: string;
}

/** Bloque `meta` del configJson (parte NO sensible; sin tokens). */
export interface MetaConfig {
  accounts?: MetaAccount[];
  // ── legacy singular (pre multi-cuenta) — se respeta por retrocompat ──
  pageId?: string;
  igId?: string;
  pageName?: string;
  connectedAt?: string;
}

/** Una página recién autorizada por OAuth, a la espera de que el usuario elija
 *  cuáles traer. Incluye el page token (SECRETO) → vive solo en Secrets Manager. */
export interface PendingPage {
  pageId: string;
  pageName?: string;
  igId?: string;
  igUsername?: string;
  pageToken: string;
}

/** Estructura del secret `connectview/tenant/<id>/meta`. */
export interface MetaSecret {
  /** Páginas del último "Conectar con Facebook", pendientes de elección. */
  pending?: { at: string; pages: PendingPage[] };
  /** Page token definitivo por pageId (de las cuentas ya elegidas). */
  pageTokens?: Record<string, string>;
}

export function metaSecretName(tenantId: string): string {
  return `connectview/tenant/${tenantId}/meta`;
}

/**
 * Lista de cuentas del tenant, incluyendo el legacy singular como una cuenta más
 * si todavía no migró a accounts[]. Nunca devuelve tokens (los guarda el secret).
 */
export function normalizeMetaAccounts(meta: MetaConfig | undefined | null): MetaAccount[] {
  if (!meta) return [];
  const out: MetaAccount[] = Array.isArray(meta.accounts) ? [...meta.accounts] : [];
  // Legacy: meta.pageId/igId singular → cuenta implícita si no está ya listada.
  if (meta.pageId && !out.some((a) => a.pageId === meta.pageId)) {
    out.push({ id: meta.pageId, pageId: meta.pageId, pageName: meta.pageName, igId: meta.igId });
  }
  return out;
}

/** Cuenta cuyo pageId o igId coincide con el metaId (entry.id del webhook). */
export function findMetaAccount(accounts: MetaAccount[], metaId: string): MetaAccount | null {
  if (!metaId) return null;
  return accounts.find((a) => a.pageId === metaId || (!!a.igId && a.igId === metaId)) || null;
}

/** Lee el secret de tokens del tenant. {} si no existe todavía. */
export async function readMetaSecret(
  sm: SecretsManagerClient,
  tenantId: string,
): Promise<MetaSecret> {
  try {
    const r = await sm.send(new GetSecretValueCommand({ SecretId: metaSecretName(tenantId) }));
    if (!r.SecretString) return {};
    return JSON.parse(r.SecretString) as MetaSecret;
  } catch (e) {
    if (e instanceof Error && e.name === "ResourceNotFoundException") return {};
    throw e;
  }
}

/** Upsert del secret de tokens del tenant (create si no existe, put si sí). */
export async function writeMetaSecret(
  sm: SecretsManagerClient,
  tenantId: string,
  secret: MetaSecret,
): Promise<void> {
  const name = metaSecretName(tenantId);
  const SecretString = JSON.stringify(secret);
  try {
    await sm.send(new CreateSecretCommand({ Name: name, SecretString }));
  } catch (e) {
    if (e instanceof Error && e.name === "ResourceExistsException") {
      await sm.send(new PutSecretValueCommand({ SecretId: name, SecretString }));
    } else {
      throw e;
    }
  }
}

/** Page token para responder desde una página (pageId). null si no hay. */
export function pageTokenFor(secret: MetaSecret, pageId: string): string | null {
  return secret.pageTokens?.[pageId] || null;
}
