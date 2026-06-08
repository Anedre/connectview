import type { Handler } from "aws-lambda";
import { SocialMessagingClient } from "@aws-sdk/client-socialmessaging";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { resolveDynamo, resolveWhatsApp } from "../_shared/tenantConnect";
import { sendWhatsApp } from "../_shared/whatsappSend";

// BYO Data Plane (#46): tabla del tenant. SocialMessaging queda con cred legacy.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const HSM_TABLE = process.env.HSM_SENDS_TABLE || "connectview-hsm-sends";

/** Record an outbound HSM (template) send for the HSM Outbound report.
 *  Status starts at "sent"; delivered/read/failed land later via status
 *  events. */
async function recordHsmSend(s: {
  messageId?: string;
  phone: string;
  templateName: string;
  language: string;
  campaignId?: string;
}): Promise<void> {
  await dynamo.send(
    new PutItemCommand({
      TableName: HSM_TABLE,
      Item: {
        sendId: { S: s.messageId || randomUUID() },
        phone: { S: s.phone },
        templateName: { S: s.templateName },
        language: { S: s.language },
        campaignId: s.campaignId ? { S: s.campaignId } : { NULL: true },
        status: { S: "sent" },
        sentAt: { S: new Date().toISOString() },
      },
    })
  );
}

/**
 * send-whatsapp-template — sends a single Meta-approved WhatsApp
 * template message to one phone. Used by:
 *   - the WhatsApp campaign dialer (one call per lead)
 *   - any one-off send (testing, single notification)
 *
 * Request body:
 *   {
 *     phone: "+51953730189",       // E.164
 *     templateName: "udep_inicio_admision",
 *     language: "es",              // template's primary language
 *     variables: ["Andre", "Pregrado"]  // ordered, fills {{1}}, {{2}}, …
 *   }
 *
 * Returns:
 *   { messageId, sent: true }   on success
 *   { error, sent: false }       on failure
 */
// Cliente LEGACY de Vox (creds de la cuenta de Vox) — se usa SOLO para el tenant
// fundador (Novasys) o como fallback. Los tenants reales mandan desde SU propio
// número vía resolveWhatsApp (SocialMessaging con creds assumed + su phone id).
const legacyClient = new SocialMessagingClient({});
const LEGACY_PHONE_NUMBER_ID =
  process.env.ORIGINATION_IDENTITY || process.env.WHATSAPP_PHONE_NUMBER_ID || "";

const CORS: Record<string, string> = {
  "Content-Type": "application/json",
};

interface SendBody {
  phone: string;
  templateName: string;
  language?: string;
  variables?: string[];
  /** Tenant explícito para llamadas server-to-server (campaign-dialer no tiene
   *  JWT pero sí el campaign.tenantId). Si falta, se resuelve del JWT. */
  tenantId?: string;
  campaignId?: string;
}

function normalisePhone(raw: string): string {
  // Strip everything that isn't a digit or leading '+'. Meta expects
  // E.164 (e.g. +51953730189) but tolerates a bare-digit number too.
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  return hasPlus ? `+${digits}` : digits;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  // BYO Data Plane (#46): tenant primero, fallback Vox.
  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));

  let body: SendBody;
  try {
    body = typeof event.body === "string"
      ? JSON.parse(event.body)
      : (event.body as SendBody);
  } catch {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  if (!body?.phone || !body?.templateName) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "phone and templateName are required" }),
    };
  }

  // WhatsApp BYO: resolvemos el End User Messaging del TENANT (su número). El
  // campaign-dialer (server-to-server, sin JWT) pasa el tenant en body.tenantId.
  const { client: waClient, phoneNumberId, mode, metaPhoneNumberId, tenantId } = await resolveWhatsApp(
    event?.headers,
    legacyClient,
    LEGACY_PHONE_NUMBER_ID,
    body.tenantId
  );
  const hasNumber = mode === "meta" ? !!metaPhoneNumberId : !!phoneNumberId;
  if (!hasNumber) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({
        error:
          "WhatsApp no está configurado para esta organización. Cargá tu número en Configuración → Integraciones.",
      }),
    };
  }

  const language = body.language || "es";
  const phone = normalisePhone(body.phone);
  // AWS End User Messaging Social accepts the E.164 number with the
  // leading '+' (matches what the existing UDEP-Send-WhatsApp-Interactive
  // Lambda does). Stripping the '+' returns "Invalid destination phone".
  const toDigits = phone.startsWith("+") ? phone : `+${phone}`;

  // Build the template payload — variables go into the BODY component.
  // If there are no variables, we still need the components array
  // (with the body component empty) so Meta validates against the
  // template's actual layout.
  const components: Array<Record<string, unknown>> = [];
  if (body.variables && body.variables.length > 0) {
    components.push({
      type: "body",
      parameters: body.variables.map((v) => ({
        type: "text",
        text: String(v),
      })),
    });
  }

  const whatsappPayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toDigits,
    type: "template",
    template: {
      name: body.templateName,
      language: { code: language },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  try {
    // Router: modo AWS (End User Messaging) o Meta (Cloud API directa).
    const res = await sendWhatsApp(
      { mode, awsClient: waClient, awsPhoneNumberId: phoneNumberId, metaPhoneNumberId, tenantId },
      whatsappPayload
    );
    // Track the send for the HSM Outbound report (roadmap #6). Best-effort:
    // a tracking write must never fail the actual send. delivered/read/failed
    // get filled later by the status events (roadmap #14).
    await recordHsmSend({
      messageId: res.messageId,
      phone,
      templateName: body.templateName,
      language,
      campaignId: (body as { campaignId?: string }).campaignId,
    }).catch((e) => console.warn("hsm-send tracking failed:", e));
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        sent: true,
        messageId: res.messageId,
        phone,
      }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-whatsapp-template error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        sent: false,
        error: msg,
        phone,
      }),
    };
  }
};
