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
 * send-whatsapp-list-interactive — envía un WhatsApp LIST interactivo (menú de
 * hasta 10 opciones con título + descripción), como mensaje free-form dentro de
 * la ventana de 24h (Fase 4 · F4.2a). A diferencia del carousel/list en PLANTILLA,
 * el list interactivo NO requiere aprobación de Meta → ideal para bots + inbox.
 *
 * La elección del cliente vuelve como `interactive.list_reply` al webhook
 * (whatsapp-meta-webhook). Mismo esquema de auth/BYO/gate/registro que
 * send-whatsapp-flow.
 *
 * Body:
 *   {
 *     phone: "+51953730189",
 *     body: "Elige una opción:",          // requerido (≤4096)
 *     header?: "Título",                   // texto (≤60)
 *     footer?: "Pie",                      // (≤60)
 *     button?: "Ver opciones",             // texto del botón (≤20)
 *     rows: [ { id, title, description? } ],       // una sección (≤10 filas)
 *     sections?: [ { title?, rows: [...] } ],      // o varias secciones
 *     tenantId?, dryRun?
 *   }
 */
const INTERNAL_SECRET = process.env.VOX_INTERNAL_SECRET || "";
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const HSM_TABLE = process.env.HSM_SENDS_TABLE || "connectview-hsm-sends";
const legacyClient = new SocialMessagingClient({});
const LEGACY_PHONE_NUMBER_ID =
  process.env.ORIGINATION_IDENTITY || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const CORS: Record<string, string> = { "Content-Type": "application/json" };

interface ListRow {
  id: string;
  title: string;
  description?: string;
}
interface ListSection {
  title?: string;
  rows: ListRow[];
}
interface SendListBody {
  phone: string;
  body: string;
  header?: string;
  footer?: string;
  button?: string;
  rows?: ListRow[];
  sections?: ListSection[];
  tenantId?: string;
  dryRun?: boolean;
}

function normalisePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/** Normaliza las secciones a los límites de Meta (10 filas, títulos/desc recortados). */
function buildSections(body: SendListBody): ListSection[] {
  const raw: ListSection[] =
    Array.isArray(body.sections) && body.sections.length
      ? body.sections
      : [{ rows: Array.isArray(body.rows) ? body.rows : [] }];
  let remaining = 10; // Meta: máximo 10 filas en total
  const out: ListSection[] = [];
  for (const s of raw) {
    if (remaining <= 0) break;
    const rows = (s.rows || []).slice(0, remaining).map((r, i) => ({
      id: String(r.id || `row_${i}`).slice(0, 200),
      title: String(r.title || `Opción ${i + 1}`).slice(0, 24),
      ...(r.description ? { description: String(r.description).slice(0, 72) } : {}),
    }));
    remaining -= rows.length;
    if (rows.length)
      out.push({ ...(s.title ? { title: String(s.title).slice(0, 24) } : {}), rows });
  }
  return out;
}

async function recordSend(s: { messageId?: string; phone: string; label: string }): Promise<void> {
  await dynamo.send(
    new PutItemCommand({
      TableName: HSM_TABLE,
      Item: {
        sendId: { S: s.messageId || randomUUID() },
        phone: { S: s.phone },
        phoneDigits: { S: normalizePhone(s.phone)?.digits || s.phone.replace(/\D/g, "") },
        templateName: { S: `list:${s.label}` },
        language: { S: "—" },
        campaignId: { NULL: true },
        status: { S: "sent" },
        sentAt: { S: new Date().toISOString() },
      },
    }),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));

  let body: SendListBody;
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body as SendListBody);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const sections = buildSections(body);
  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
  if (!body?.phone || !body?.body || totalRows === 0) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({
        error: "phone, body y al menos una fila (rows/sections) son requeridos",
      }),
    };
  }

  // AUTH — mismo esquema anti-impersonación que los otros senders.
  const identity = await getIdentity(event?.headers).catch(() => null);
  const hdrs = event?.headers || {};
  const internalOk =
    !!INTERNAL_SECRET && (hdrs["x-vox-internal"] || hdrs["X-Vox-Internal"]) === INTERNAL_SECRET;
  const claimsTenant = !!body.tenantId && !isLegacyTenant(body.tenantId);
  if (claimsTenant && !identity?.tenantId && !internalOk) {
    return {
      statusCode: 401,
      headers: CORS,
      body: JSON.stringify({ error: "No autorizado (tenantId sin credenciales)" }),
    };
  }
  const effectiveTenantId = identity?.tenantId || (internalOk ? body.tenantId : undefined);
  if (!identity?.tenantId && !internalOk) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "No autorizado" }) };
  }

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
      body: JSON.stringify({ error: "WhatsApp no está configurado para esta organización." }),
    };
  }

  const phone = normalisePhone(body.phone);
  const toDigits = phone.startsWith("+") ? phone : `+${phone}`;

  const interactive: Record<string, unknown> = {
    type: "list",
    body: { text: String(body.body).slice(0, 4096) },
    action: { button: String(body.button || "Ver opciones").slice(0, 20), sections },
  };
  if (body.header) interactive.header = { type: "text", text: String(body.header).slice(0, 60) };
  if (body.footer) interactive.footer = { text: String(body.footer).slice(0, 60) };

  const whatsappPayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toDigits,
    type: "interactive",
    interactive,
  };

  if (body.dryRun) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ sent: false, dryRun: true, mode, payload: whatsappPayload }),
    };
  }

  // Pilar 3 — gate de supresión (channel-scoped a WhatsApp).
  const verdict = await evaluateSend(dynamo, {
    phone,
    channel: "whatsapp",
    tenantId: effectiveTenantId,
  });
  if (!verdict.allowed) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ sent: false, suppressed: true, blockedBy: verdict.blockedBy, phone }),
    };
  }

  try {
    const res = await sendWhatsApp(
      { mode, awsClient: waClient, awsPhoneNumberId: phoneNumberId, metaPhoneNumberId, tenantId },
      whatsappPayload,
    );
    await recordSend({ messageId: res.messageId, phone, label: `${totalRows}opts` }).catch((e) =>
      console.warn("list-send tracking failed:", e),
    );
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ sent: true, messageId: res.messageId, phone, rows: totalRows }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-whatsapp-list-interactive error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ sent: false, error: msg, phone }),
    };
  }
};
