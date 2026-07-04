/**
 * whatsappNumbers — modelo multi-número de WhatsApp (Meta Cloud API) por tenant.
 * Un tenant puede registrar VARIOS números de WhatsApp; cada número se rutea a UN
 * flujo/bot (`number.botId`), decidido en la vista de Ruteo (sección Bots). Las
 * credenciales del número se cargan en Integraciones; el ruteo es aparte.
 *
 * Separación de datos (mismo criterio que metaAccounts / Salesforce):
 *  · Metadata NO sensible (phoneNumberId, wabaId, label, botId) → configJson del
 *    tenant (`connectview-connections` → whatsapp.numbers[]). La ve el frontend.
 *  · Access tokens (SECRETOS) → Secrets Manager `connectview/tenant/<id>/whatsapp`
 *    (`numberTokens[<phoneNumberId>]`). NUNCA en DynamoDB ni en el navegador.
 *
 * Retrocompat: el esquema previo era 1 número por tenant en `whatsapp.metaPhoneNumberId`
 * / `whatsapp.phoneNumberId` (singular) + token único. `normalizeWaNumbers` lo trata
 * como numbers[0] si el tenant no migró, así el enrutado sigue sin tocar su config.
 *
 * Este archivo lo bundlean Lambdas hand-managed: manage-connections (guardar/rutear)
 * y whatsapp-meta-webhook (enrutar inbound + elegir el bot del número que recibió).
 * 🔑 al tocarlo, re-desplegar los que lo bundlean.
 */
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

/** Un número de WhatsApp conectado (parte NO sensible, en configJson.whatsapp.numbers). */
export interface WhatsAppNumber {
  /** Id canónico en ARIA. Modo meta = metaPhoneNumberId (Phone Number ID de Meta
   *  Cloud API, la clave de match del webhook); modo aws = el phoneNumberId de Connect. */
  id: string;
  /** Etiqueta humana ("Admisiones", "Cobranzas"). */
  label?: string;
  mode: "aws" | "meta";
  /** Phone Number ID de Meta Cloud API (modo meta). Clave de ruteo del webhook. */
  metaPhoneNumberId?: string;
  /** Phone number id de Connect / EUM (modo aws) o número mostrado. */
  phoneNumberId?: string;
  wabaId?: string;
  /** Número legible (+51 9xx…) para mostrar en la UI. */
  displayNumber?: string;
  /** Flujo/bot anclado a ESTE número (ruteo). Ausente/"" → sin flujo → agente humano. */
  botId?: string;
  /** El access token de este número ya está guardado en Secrets. */
  tokenSet?: boolean;
  addedAt?: string;
  connectedAt?: string;
}

/** Definición de un WhatsApp Flow (formulario nativo, #10). Se mantiene igual. */
export interface WaFlowDef {
  flowId: string;
  name?: string;
  buttonLabel?: string;
  screen?: string;
}

/** Bloque `whatsapp` del configJson (parte NO sensible; sin tokens). */
export interface WhatsAppConfig {
  numbers?: WhatsAppNumber[];
  flows?: WaFlowDef[];
  // ── legacy singular (pre multi-número) — se respeta por retrocompat ──
  mode?: "aws" | "meta";
  phoneNumberId?: string;
  metaPhoneNumberId?: string;
  wabaId?: string;
  botId?: string;
  tokenSet?: boolean;
  connectedAt?: string;
}

/** Estructura del secret `connectview/tenant/<id>/whatsapp`. */
export interface WhatsAppSecret {
  /** Token legacy del número singular — se respeta si no hay `numberTokens`. */
  token?: string;
  /** Access token definitivo por número (id/metaPhoneNumberId → token). */
  numberTokens?: Record<string, string>;
}

export function whatsappSecretName(tenantId: string): string {
  return `connectview/tenant/${tenantId}/whatsapp`;
}

/** Clave del token/ruteo de un número (metaPhoneNumberId gana; luego id/phoneNumberId). */
export function waNumberKey(n: WhatsAppNumber): string {
  return n.metaPhoneNumberId || n.id || n.phoneNumberId || "";
}

/**
 * Lista de números del tenant, incluyendo el legacy singular como numbers[0] si
 * todavía no migró a numbers[]. Nunca devuelve tokens (los guarda el secret).
 */
export function normalizeWaNumbers(wa: WhatsAppConfig | undefined | null): WhatsAppNumber[] {
  if (!wa) return [];
  const out: WhatsAppNumber[] = Array.isArray(wa.numbers) ? [...wa.numbers] : [];
  // Legacy: whatsapp singular → número implícito si no está ya listado.
  const legacyId = wa.metaPhoneNumberId || wa.phoneNumberId;
  if (legacyId && !out.some((n) => waNumberKey(n) === legacyId)) {
    out.push({
      id: legacyId,
      label: "Número principal",
      mode: wa.mode || "meta",
      metaPhoneNumberId: wa.metaPhoneNumberId,
      phoneNumberId: wa.phoneNumberId,
      wabaId: wa.wabaId,
      botId: wa.botId,
      tokenSet: wa.tokenSet,
      connectedAt: wa.connectedAt,
    });
  }
  return out;
}

/** Número cuyo metaPhoneNumberId (o id/phoneNumberId) coincide con el phone_number_id. */
export function findWaNumber(
  numbers: WhatsAppNumber[],
  phoneNumberId: string,
): WhatsAppNumber | null {
  if (!phoneNumberId) return null;
  return (
    numbers.find(
      (n) =>
        n.metaPhoneNumberId === phoneNumberId ||
        n.id === phoneNumberId ||
        n.phoneNumberId === phoneNumberId,
    ) || null
  );
}

/** Lee el secret de tokens del tenant. {} si no existe todavía. */
export async function readWaSecret(
  sm: SecretsManagerClient,
  tenantId: string,
): Promise<WhatsAppSecret> {
  try {
    const r = await sm.send(new GetSecretValueCommand({ SecretId: whatsappSecretName(tenantId) }));
    if (!r.SecretString) return {};
    return JSON.parse(r.SecretString) as WhatsAppSecret;
  } catch (e) {
    if (e instanceof Error && e.name === "ResourceNotFoundException") return {};
    throw e;
  }
}

/** Upsert del secret de tokens del tenant (create si no existe, put si sí). */
export async function writeWaSecret(
  sm: SecretsManagerClient,
  tenantId: string,
  secret: WhatsAppSecret,
): Promise<void> {
  const name = whatsappSecretName(tenantId);
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

/** Access token para enviar desde un número. numberTokens gana; cae al token legacy. */
export function waTokenFor(secret: WhatsAppSecret, number: WhatsAppNumber): string | null {
  return secret.numberTokens?.[waNumberKey(number)] || secret.token || null;
}
