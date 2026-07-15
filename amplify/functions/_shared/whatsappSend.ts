/**
 * whatsappSend — router de envío de WhatsApp. El payload SIEMPRE va en formato
 * Meta Cloud API (igual que ya arma send-whatsapp-template / agent-channel-adapter);
 * este helper solo elige el TRANSPORTE según el modo del tenant:
 *
 *   • "aws"  → AWS End User Messaging Social (número vinculado a Connect).
 *              Es el que también habilita inbound→agente y bots vía contact flow.
 *   • "meta" → Meta Cloud API directo (POST graph.facebook.com con el token del
 *              tenant). Sirve para ENVIAR (plantillas/bots por webhook), pero NO
 *              mete el mensaje como contacto en Connect (sin agente en vivo).
 *
 * El token de Meta vive en Secrets Manager (`connectview/tenant/<id>/whatsapp`),
 * NUNCA en el cliente.
 */
import { SocialMessagingClient, SendWhatsAppMessageCommand } from "@aws-sdk/client-socialmessaging";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secrets = new SecretsManagerClient({});
const META_API_VERSION = process.env.META_API_VERSION || "v20.0";

export interface WhatsAppRoute {
  mode: "aws" | "meta";
  /** mode=aws: AWS phone-number-id (originationPhoneNumberId) + su cliente. */
  awsClient?: SocialMessagingClient;
  awsPhoneNumberId?: string;
  /** mode=meta: Meta Cloud API phone number id + tenant (para el token). */
  metaPhoneNumberId?: string;
  tenantId?: string;
}

// Cache del token por tenant durante la vida del contenedor caliente.
const tokenCache = new Map<string, string>();
async function metaToken(tenantId: string): Promise<string | null> {
  const hit = tokenCache.get(tenantId);
  if (hit) return hit;
  try {
    const r = await secrets.send(
      new GetSecretValueCommand({ SecretId: `connectview/tenant/${tenantId}/whatsapp` }),
    );
    const token = JSON.parse(r.SecretString || "{}").token;
    if (token) {
      tokenCache.set(tenantId, token);
      return token;
    }
  } catch {
    /* sin secret / sin token */
  }
  return null;
}

/** Envía un payload (formato Meta Cloud API) por el camino del modo del tenant.
 *  Devuelve { messageId }. Lanza si falta config/credencial. */
export async function sendWhatsApp(
  route: WhatsAppRoute,
  payload: Record<string, unknown>,
): Promise<{ messageId?: string }> {
  if (route.mode === "meta") {
    if (!route.metaPhoneNumberId || !route.tenantId) {
      throw new Error("WhatsApp (Meta): falta phone number id o tenant");
    }
    const token = await metaToken(route.tenantId);
    if (!token) {
      throw new Error("WhatsApp (Meta): no hay token guardado para el tenant");
    }
    const r = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${route.metaPhoneNumberId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      // SEGURIDAD: nunca loguear el token; solo el error de Meta. Incluimos
      // error_data.details: sin él "(#131009) Parameter value is not valid"
      // no dice QUÉ parámetro ni por qué (header muy largo, emoji en header,
      // saltos de línea, etc.) y es indepurable desde la UI.
      const details = j?.error?.error_data?.details;
      throw new Error(
        `Meta send falló (${r.status}): ${j?.error?.message || "error"}` +
          (details ? ` — ${details}` : ""),
      );
    }
    return { messageId: j?.messages?.[0]?.id };
  }

  // mode === "aws"
  if (!route.awsClient || !route.awsPhoneNumberId) {
    throw new Error("WhatsApp (AWS): cliente o phone-number-id no resuelto");
  }
  const res = await route.awsClient.send(
    new SendWhatsAppMessageCommand({
      originationPhoneNumberId: route.awsPhoneNumberId,
      metaApiVersion: META_API_VERSION,
      message: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  );
  return { messageId: res.messageId };
}
