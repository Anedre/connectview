import type { Handler } from "aws-lambda";
import {
  SocialMessagingClient,
  SendWhatsAppMessageCommand,
} from "@aws-sdk/client-socialmessaging";

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
const client = new SocialMessagingClient({});
const PHONE_NUMBER_ID =
  process.env.WHATSAPP_PHONE_NUMBER_ID ||
  // Falls back to whichever Meta phone id is wired in env; the
  // campaign Lambda passes it through environment so a single
  // function can serve multiple senders if needed.
  "";
const ORIGINATION_IDENTITY = process.env.ORIGINATION_IDENTITY || PHONE_NUMBER_ID;

const CORS: Record<string, string> = {
  "Content-Type": "application/json",
};

interface SendBody {
  phone: string;
  templateName: string;
  language?: string;
  variables?: string[];
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

  if (!ORIGINATION_IDENTITY) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error:
          "ORIGINATION_IDENTITY (WhatsApp phone number id) not configured",
      }),
    };
  }

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
    const res = await client.send(
      new SendWhatsAppMessageCommand({
        originationPhoneNumberId: ORIGINATION_IDENTITY,
        // Meta Graph API version. Required by socialmessaging API — if
        // omitted the SDK rejects with a validation error.
        metaApiVersion: process.env.META_API_VERSION || "v20.0",
        message: new TextEncoder().encode(JSON.stringify(whatsappPayload)),
      })
    );
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
