import type { Handler } from "aws-lambda";
import { SocialMessagingClient } from "@aws-sdk/client-socialmessaging";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { resolveDynamo, resolveWhatsApp, resolveWhatsAppAccounts } from "../_shared/tenantConnect";
import { sendWhatsApp } from "../_shared/whatsappSend";
import {
  routeForAccount,
  getTemplateDef,
  buildButtonComponents,
} from "../_shared/whatsappTemplatesApi";
import { getIdentity, isLegacyTenant } from "../_shared/cognitoAuth";
import { evaluateSend } from "../_shared/suppression";
import { normalizePhone } from "../_shared/phone";

// Secreto compartido para llamadas server-to-server (campaign-dialer). El
// frontend manda JWT; el dialer no tiene JWT y prueba que es interno con este
// header. Sin JWT NI secreto, NO se respeta body.tenantId (anti-impersonación).
const INTERNAL_SECRET = process.env.VOX_INTERNAL_SECRET || "";

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
  /** SEC-A1 — tenant dueño de la fila (para el filtro real del feed/Consumo). */
  tenantId?: string;
}): Promise<void> {
  await dynamo.send(
    new PutItemCommand({
      TableName: HSM_TABLE,
      Item: {
        sendId: { S: s.messageId || randomUUID() },
        phone: { S: s.phone },
        // Dígitos normalizados → clave del GSI byPhone (frecuencia/anti-doble-envío, Pilar 3 Fase B).
        phoneDigits: { S: normalizePhone(s.phone)?.digits || s.phone.replace(/\D/g, "") },
        templateName: { S: s.templateName },
        language: { S: s.language },
        campaignId: s.campaignId ? { S: s.campaignId } : { NULL: true },
        // SEC-A1: dueño de la fila. Antes NO se guardaba → el filtro por tenant del
        // feed (get-analytics-feed) y de Consumo (get-cost-report) era un no-op.
        // Vacío/legacy → se omite (fila pooled Novasys, visible solo al legacy).
        ...(s.tenantId ? { tenantId: { S: s.tenantId } } : {}),
        status: { S: "sent" },
        sentAt: { S: new Date().toISOString() },
      },
    }),
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
    body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body as SendBody);
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

  // AUTH (anti-impersonación): el tenant SALE del JWT (frontend con authedFetch).
  // body.tenantId SOLO se respeta para llamadas internas (campaign-dialer) que
  // presentan el secreto compartido. Sin JWT y sin secreto → 401: así un POST
  // público con body.tenantId ajeno YA NO envía WhatsApp desde el número de otro
  // tenant (impersonación / quema de cuota Meta de un tercero).
  const identity = await getIdentity(event?.headers).catch(() => null);
  const hdrs = event?.headers || {};
  const internalOk =
    !!INTERNAL_SECRET && (hdrs["x-vox-internal"] || hdrs["X-Vox-Internal"]) === INTERNAL_SECRET;
  // Impersonación: si el body reclama un tenant REAL (no legacy) pero NO hay JWT
  // ni secreto interno → 401. Así un POST público con body.tenantId="otro-tenant"
  // ya NO envía WhatsApp desde el número de ese tenant. Los callers internos sin
  // tenantId (bots → número legacy) y el dialer (con secreto) NO se ven afectados.
  const claimsTenant = !!body.tenantId && !isLegacyTenant(body.tenantId);
  if (claimsTenant && !identity?.tenantId && !internalOk) {
    return {
      statusCode: 401,
      headers: CORS,
      body: JSON.stringify({ error: "No autorizado (tenantId sin credenciales)" }),
    };
  }
  // JWT manda (ignora el body.tenantId de un atacante); el dialer interno usa su
  // body.tenantId (con secreto); el resto cae al número legacy de siempre.
  const effectiveTenantId = identity?.tenantId || (internalOk ? body.tenantId : undefined);

  // WhatsApp BYO: resolvemos el End User Messaging del TENANT (su número).
  const {
    client: waClient,
    phoneNumberId,
    mode,
    metaPhoneNumberId,
    tenantId,
  } = await resolveWhatsApp(
    event?.headers,
    legacyClient,
    LEGACY_PHONE_NUMBER_ID,
    effectiveTenantId,
  );
  const hasNumber = mode === "meta" ? !!metaPhoneNumberId : !!phoneNumberId;
  if (!hasNumber) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({
        error:
          "WhatsApp no está configurado para esta organización. Carga tu número en Configuración → Integraciones.",
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

  // Botones DINÁMICOS (Flow / URL con sufijo / copiar código): Meta EXIGE su
  // componente al enviar aunque la plantilla no tenga variables; sin él rechaza
  // el envío con (#131009) "Components sub_type invalid at index: N". Los
  // deducimos de la definición de la plantilla (cacheada 5 min por WABA).
  try {
    const acc = await resolveWhatsAppAccounts(
      event?.headers,
      legacyClient,
      process.env.WABA_ID || "",
      effectiveTenantId,
    );
    const resolvedRoute = await routeForAccount(acc.accounts, acc.client, acc.tenantId);
    if (resolvedRoute) {
      const def = await getTemplateDef(resolvedRoute.route, body.templateName, language);
      const { components: btnComponents } = buildButtonComponents(def?.buttons, {
        // Sin conversación a la que correlacionar: el teléfono destino sirve
        // para casar la respuesta del Flow con este envío.
        flowToken: toDigits,
      });
      components.push(...btnComponents);
    }
  } catch (e) {
    // Sin definición seguimos: si la plantilla necesitaba botones, Meta lo dirá
    // con detalle (whatsappSend adjunta error_data.details).
    console.warn("send-whatsapp-template: no se pudo leer la definición:", e);
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

  // Pilar 3 — gate de supresión: ningún HSM sale a un opt-out / DNC / número en
  // cuarentena (channel-scoped a WhatsApp). Fail-open si la tabla falla (no frena
  // el outbound por un error de infra). El caller (dialer/automation/blast) recibe
  // {sent:false, suppressed:true} y NO reintenta.
  const verdict = await evaluateSend(dynamo, {
    phone,
    channel: "whatsapp",
    tenantId: effectiveTenantId,
  });
  if (!verdict.allowed) {
    console.log(`suppressed whatsapp template → ${phone} (${verdict.blockedBy})`);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ sent: false, suppressed: true, blockedBy: verdict.blockedBy, phone }),
    };
  }

  try {
    // Router: modo AWS (End User Messaging) o Meta (Cloud API directa).
    const res = await sendWhatsApp(
      { mode, awsClient: waClient, awsPhoneNumberId: phoneNumberId, metaPhoneNumberId, tenantId },
      whatsappPayload,
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
      // SEC-A1: el tenant efectivo (JWT del front, o body.tenantId del dialer con
      // secreto interno). El número desde el que se envía es el de este tenant.
      tenantId: effectiveTenantId,
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
