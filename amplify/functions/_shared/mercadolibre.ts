/**
 * mercadolibre — helpers del canal Mercado Libre (F4.1). El parseo de la
 * notificación y del `resource` es PURO (sin AWS/fetch) → testeable. Los
 * fetchers pegan a la API de ML (`api.mercadolibre.com`) con Bearer token.
 *
 * Flujo: ML manda un webhook `{ resource, user_id, topic }` → respondemos 200
 * rápido → hacemos GET del `resource` con el token del tenant → `appendMlInbound`.
 * Reply: PREGUNTA → POST /answers · MENSAJE post-venta → POST /messages/packs/…
 *
 * Docs: https://developers.mercadolibre.com.ar/en_us/products-receive-notifications
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { MlContext } from "./conversations";

export const ML_API = "https://api.mercadolibre.com";

const sm = new SecretsManagerClient({});

/** Secreto del tenant (lo cablea el OAuth del cliente). */
export interface MlSecret {
  accessToken: string;
  refreshToken?: string;
  userId?: string; // user_id del seller (tenant) en ML
  siteId?: string; // MLA / MPE / MLB…
  expiresAt?: string;
}

/** Notificación de ML (topic + resource + user_id del seller). */
export interface MlNotification {
  topic: string;
  resource: string;
  userId: string;
}

/**
 * Valida y normaliza el cuerpo de una notificación de ML. Devuelve null si no
 * tiene la forma esperada (así el webhook responde 200 igual, sin explotar).
 */
export function parseNotification(body: unknown): MlNotification | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const resource = typeof b.resource === "string" ? b.resource : "";
  const topic = typeof b.topic === "string" ? b.topic : "";
  const userId = b.user_id != null ? String(b.user_id) : "";
  if (!resource || !topic) return null;
  return { topic, resource, userId };
}

/**
 * Deriva el contexto ML del `resource`:
 *   /questions/<id>                              → question
 *   /messages/packs/<packId>/sellers/<sellerId>  → message
 * Devuelve null si el path no matchea (topic no soportado).
 */
export function resourceKind(resource: string): MlContext | null {
  const q = resource.match(/^\/questions\/(\d+)/);
  if (q) return { kind: "question", questionId: q[1] };
  const m = resource.match(/^\/messages\/packs\/([^/]+)\/sellers\/([^/?]+)/);
  if (m) return { kind: "message", packId: m[1], sellerId: m[2] };
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mlFetch(path: string, token: string, init?: RequestInit): Promise<any> {
  const url = path.startsWith("http") ? path : `${ML_API}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await r.text();
  let j: unknown = {};
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    /* respuesta no-JSON */
  }
  if (!r.ok) {
    const msg =
      (j as { message?: string; error?: string })?.message ||
      (j as { error?: string })?.error ||
      `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return j;
}

/** GET del recurso que vino en la notificación (pregunta o mensaje). */
export function mlGet(token: string, resource: string) {
  return mlFetch(resource, token);
}

/** Responde una PREGUNTA: POST /answers { question_id, text }. */
export function answerQuestion(token: string, questionId: string, text: string) {
  return mlFetch("/answers", token, {
    method: "POST",
    body: JSON.stringify({ question_id: Number(questionId) || questionId, text }),
  });
}

/**
 * Responde un MENSAJE post-venta:
 * POST /messages/packs/<packId>/sellers/<sellerId> { from:{user_id}, to:{user_id}, text }.
 */
export function sendMlMessage(
  token: string,
  packId: string,
  sellerId: string,
  buyerId: string,
  text: string,
) {
  return mlFetch(`/messages/packs/${packId}/sellers/${sellerId}`, token, {
    method: "POST",
    body: JSON.stringify({
      from: { user_id: sellerId },
      to: { user_id: buyerId },
      text,
    }),
  });
}

/** Lee el secreto de ML del tenant (Secrets Manager). Null si no está conectado. */
export async function resolveMlSecret(tenantId: string): Promise<MlSecret | null> {
  try {
    const r = await sm.send(
      new GetSecretValueCommand({ SecretId: `connectview/tenant/${tenantId}/mercadolibre` }),
    );
    const raw = r.SecretString || "";
    const j = JSON.parse(raw) as MlSecret;
    return j.accessToken ? j : null;
  } catch {
    return null;
  }
}
