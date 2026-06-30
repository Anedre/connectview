import type { Handler } from "aws-lambda";
import { SocialMessagingClient } from "@aws-sdk/client-socialmessaging";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { resolveDynamo, resolveWhatsApp } from "../_shared/tenantConnect";
import { sendWhatsApp } from "../_shared/whatsappSend";
import { getIdentity, isLegacyTenant } from "../_shared/cognitoAuth";
import { evaluateSend } from "../_shared/suppression";
import { normalizePhone } from "../_shared/phone";

/**
 * send-whatsapp-flow — envía un WhatsApp FLOW (formulario multi-pantalla
 * nativo de Meta, roadmap #10 — el reemplazo de Sappier/Typeform) a un
 * teléfono, como mensaje interactivo free-form (requiere ventana de 24h
 * abierta; los Flows en plantillas masivas son v2).
 *
 * El Flow (las pantallas) se diseña y publica en Meta Business Manager →
 * WhatsApp Manager → Flows; acá solo se dispara por su flow_id. La respuesta
 * del cliente llega como `interactive.nfm_reply` al webhook
 * (whatsapp-meta-webhook, tenants modo "meta") → lead + Customer Profile +
 * trigger de Automatizaciones `whatsapp_flow_completed`.
 *
 * Body:
 *   {
 *     phone: "+51953730189",
 *     flowId: "1234567890",         // id del Flow publicado en Meta
 *     flowName?: "Solicitud de info", // para el tracking/reporte
 *     cta?: "Completar",             // texto del botón (≤30 chars)
 *     screen?: "INICIO",             // pantalla inicial (id del screen en el Flow JSON)
 *     headerText?, bodyText?, footerText?,
 *     flowToken?: "...",             // correlación; default vox:<tenant>:<phone>:<ts>
 *     tenantId?: "...",              // server-to-server (con x-vox-internal)
 *     dryRun?: true                  // arma y devuelve el payload SIN enviar
 *   }
 *
 * Auth: igual que send-whatsapp-template — JWT del frontend, o header
 * x-vox-internal para llamadas internas; un POST público que reclame un
 * tenant real sin credenciales → 401 (anti-impersonación).
 */
const INTERNAL_SECRET = process.env.VOX_INTERNAL_SECRET || "";

const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const HSM_TABLE = process.env.HSM_SENDS_TABLE || "connectview-hsm-sends";

/** El envío del Flow se trackea en el mismo reporte HSM (templateName "flow:…"). */
async function recordFlowSend(s: {
  messageId?: string;
  phone: string;
  flowLabel: string;
}): Promise<void> {
  await dynamo.send(
    new PutItemCommand({
      TableName: HSM_TABLE,
      Item: {
        sendId: { S: s.messageId || randomUUID() },
        phone: { S: s.phone },
        phoneDigits: { S: normalizePhone(s.phone)?.digits || s.phone.replace(/\D/g, "") },
        templateName: { S: `flow:${s.flowLabel}` },
        language: { S: "—" },
        campaignId: { NULL: true },
        status: { S: "sent" },
        sentAt: { S: new Date().toISOString() },
      },
    })
  );
}

const legacyClient = new SocialMessagingClient({});
const LEGACY_PHONE_NUMBER_ID =
  process.env.ORIGINATION_IDENTITY || process.env.WHATSAPP_PHONE_NUMBER_ID || "";

const CORS: Record<string, string> = { "Content-Type": "application/json" };

interface SendFlowBody {
  phone: string;
  flowId: string;
  flowName?: string;
  cta?: string;
  screen?: string;
  headerText?: string;
  bodyText?: string;
  footerText?: string;
  flowToken?: string;
  tenantId?: string;
  dryRun?: boolean;
}

function normalisePhone(raw: string): string {
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

  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));

  let body: SendFlowBody;
  try {
    body =
      typeof event.body === "string" ? JSON.parse(event.body) : (event.body as SendFlowBody);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  if (!body?.phone || !body?.flowId) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "phone and flowId are required" }),
    };
  }

  // AUTH — mismo esquema anti-impersonación que send-whatsapp-template.
  const identity = await getIdentity(event?.headers).catch(() => null);
  const hdrs = event?.headers || {};
  const internalOk =
    !!INTERNAL_SECRET &&
    (hdrs["x-vox-internal"] || hdrs["X-Vox-Internal"]) === INTERNAL_SECRET;
  const claimsTenant = !!body.tenantId && !isLegacyTenant(body.tenantId);
  if (claimsTenant && !identity?.tenantId && !internalOk) {
    return {
      statusCode: 401,
      headers: CORS,
      body: JSON.stringify({ error: "No autorizado (tenantId sin credenciales)" }),
    };
  }
  // Frontend (JWT) o interno (secreto). Sin ninguno: solo el número legacy.
  const effectiveTenantId = identity?.tenantId || (internalOk ? body.tenantId : undefined);
  // Anónimo total (ni JWT ni secreto) → no enviamos nada (el composer siempre
  // manda JWT vía el interceptor; esto corta abuso del endpoint público).
  if (!identity?.tenantId && !internalOk) {
    return {
      statusCode: 401,
      headers: CORS,
      body: JSON.stringify({ error: "No autorizado" }),
    };
  }

  const { client: waClient, phoneNumberId, mode, metaPhoneNumberId, tenantId } =
    await resolveWhatsApp(event?.headers, legacyClient, LEGACY_PHONE_NUMBER_ID, effectiveTenantId);
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

  const phone = normalisePhone(body.phone);
  const toDigits = phone.startsWith("+") ? phone : `+${phone}`;
  const flowToken =
    body.flowToken || `vox:${tenantId}:${phone}:${Date.now()}`;

  // Payload Meta — interactive Flow (Flows API v3, navigate = Flow estático
  // publicado; la respuesta completa llega luego en interactive.nfm_reply).
  const flowParameters: Record<string, unknown> = {
    flow_message_version: "3",
    flow_token: flowToken,
    flow_id: String(body.flowId),
    flow_cta: (body.cta || "Completar").slice(0, 30),
    flow_action: "navigate",
  };
  if (body.screen) {
    flowParameters.flow_action_payload = { screen: String(body.screen) };
  }
  const interactive: Record<string, unknown> = {
    type: "flow",
    body: { text: body.bodyText || "Completá el formulario para continuar 👉" },
    action: { name: "flow", parameters: flowParameters },
  };
  if (body.headerText) interactive.header = { type: "text", text: body.headerText };
  if (body.footerText) interactive.footer = { text: body.footerText };

  const whatsappPayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toDigits,
    type: "interactive",
    interactive,
  };

  // dryRun: para verificación/preview — devuelve el payload armado SIN enviar.
  if (body.dryRun) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ sent: false, dryRun: true, mode, payload: whatsappPayload }),
    };
  }

  // Pilar 3 — gate de supresión (channel-scoped a WhatsApp). El dryRun de arriba
  // NO se bloquea (no envía); este check corre solo en el envío real.
  const verdict = await evaluateSend(dynamo, {
    phone,
    channel: "whatsapp",
    tenantId: effectiveTenantId,
  });
  if (!verdict.allowed) {
    console.log(`suppressed whatsapp flow → ${phone} (${verdict.blockedBy})`);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ sent: false, suppressed: true, blockedBy: verdict.blockedBy, phone }),
    };
  }

  try {
    const res = await sendWhatsApp(
      { mode, awsClient: waClient, awsPhoneNumberId: phoneNumberId, metaPhoneNumberId, tenantId },
      whatsappPayload
    );
    await recordFlowSend({
      messageId: res.messageId,
      phone,
      flowLabel: body.flowName || String(body.flowId),
    }).catch((e) => console.warn("flow-send tracking failed:", e));
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ sent: true, messageId: res.messageId, phone, flowToken }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-whatsapp-flow error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ sent: false, error: msg, phone }),
    };
  }
};
