import type { Handler } from "aws-lambda";
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { SocialMessagingClient, SendWhatsAppMessageCommand } from "@aws-sdk/client-socialmessaging";
import { getTenantConnect } from "../_shared/tenantConnect";
import { sendWhatsApp as routeSendWhatsApp } from "../_shared/whatsappSend";

/**
 * agent-channel-adapter — bridges an Amazon Connect WhatsApp (chat) contact to
 * the Vox AI agent engine (bot-runtime / Claude), WITHOUT Lex. Invoked by a
 * contact flow on each inbound customer message:
 *   1. loads the per-contact conversation state (sess# item in CONV_TABLE),
 *   2. calls bot-runtime { botId, state, input:{text}, source:"whatsapp", toolEndpoints },
 *   3. sends the bot's reply(ies) to WhatsApp as RICH Meta messages
 *      (text / interactive buttons ≤3 / interactive list ≤10) via AWS End User
 *      Messaging Social — so emojis, botones y menús funcionan sin Lex,
 *   4. returns flat attributes the flow uses to wait / handoff / end.
 *
 * Starts in DRY_RUN (builds the Meta payload but does NOT send) until the role
 * gets socialmessaging:SendWhatsAppMessage and DRY_RUN=false is set.
 *
 * Env: BOT_RUNTIME_URL, CONV_TABLE, WHATSAPP_PHONE_NUMBER_ID, DRY_RUN,
 *      EP_APPT, EP_LEADS, EP_PROFILE, EP_WA_TEMPLATE.
 */
// BYO Data Plane (#46): tabla del tenant, fallback Vox pooled.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const CONV_TABLE = process.env.CONV_TABLE || "connectview-ai-conversations";
const BOT_RUNTIME_URL = process.env.BOT_RUNTIME_URL || "";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const DRY_RUN = (process.env.DRY_RUN || "true") !== "false";
// BYO WhatsApp: el agente responde desde el número del CLIENTE (su End User
// Messaging). Se resuelven por request desde getTenantConnect(p.tenantId).
// Sin tenant configurado → quedan null → camino legacy (DRY_RUN + número de Vox).
let waClient: SocialMessagingClient | null = null;
let waPhoneNumberId = "";
// Modo del tenant: "aws" (End User Messaging) o "meta" (Cloud API directa). En
// mode=meta el número es metaPhoneNumberId y el envío va por la Graph API.
let waMode: "aws" | "meta" = "aws";
let waMetaPhoneNumberId = "";
let waTenantId = "";
const TOOL_ENDPOINTS: Record<string, string> = {
  manageAppointment: process.env.EP_APPT || "",
  manageLeads: process.env.EP_LEADS || "",
  lookupCustomerProfile: process.env.EP_PROFILE || "",
  sendWhatsAppTemplate: process.env.EP_WA_TEMPLATE || "",
};

interface BotMsg {
  kind: string;
  text?: string;
  buttons?: { id: string; label?: string; type?: string }[];
  rows?: { id: string; title?: string; description?: string }[];
  media?: { type: string; url: string; caption?: string };
}

/** Bot message → WhatsApp Cloud API message object (text / interactive). */
function buildMetaMessage(to: string, m: BotMsg): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (m.media && m.media.url) {
    const TYPE: Record<string, string> = {
      Imagen: "image",
      Video: "video",
      Documento: "document",
      Audio: "audio",
    };
    const t = TYPE[m.media.type] || "image";
    const payload: Record<string, unknown> = { link: m.media.url };
    if (t !== "audio" && m.media.caption) payload.caption = String(m.media.caption).slice(0, 1024);
    if (t === "document") payload.filename = "archivo";
    return { ...base, type: t, [t]: payload };
  }
  const buttons = (m.buttons || []).filter((b) => !b.type || b.type === "reply").slice(0, 3);
  const rows = (m.rows || []).slice(0, 10);
  if (rows.length > 0) {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: (m.text || "Elegí una opción:").slice(0, 1024) },
        action: {
          button: "Ver opciones",
          sections: [
            {
              rows: rows.map((r) => ({
                id: String(r.id).slice(0, 200),
                title: String(r.title || "Opción").slice(0, 24),
                description: (r.description || "").slice(0, 72),
              })),
            },
          ],
        },
      },
    };
  }
  if (buttons.length > 0) {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: (m.text || "…").slice(0, 1024) },
        action: {
          buttons: buttons.map((b) => ({
            type: "reply",
            reply: { id: String(b.id).slice(0, 256), title: String(b.label || "OK").slice(0, 20) },
          })),
        },
      },
    };
  }
  return {
    ...base,
    type: "text",
    text: { body: (m.text || "…").slice(0, 4096), preview_url: false },
  };
}

async function sendWhatsApp(
  to: string,
  metaMsg: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  void to; // `to` ya viene embebido en metaMsg (buildMetaMessage).
  // Tenant real con número configurado → enviamos de verdad desde SU número por
  // el router compartido, que respeta el modo: mode=aws (End User Messaging, sus
  // creds assumed) o mode=meta (Cloud API directa con su token). El tenant ya
  // opt-in al cargar su número, así que NO aplicamos DRY_RUN (solo aplica al de Vox).
  const hasTenantNumber = waMode === "meta" ? !!waMetaPhoneNumberId : !!waPhoneNumberId;
  if (hasTenantNumber) {
    const res = await routeSendWhatsApp(
      {
        mode: waMode,
        awsClient: waClient || undefined,
        awsPhoneNumberId: waPhoneNumberId,
        metaPhoneNumberId: waMetaPhoneNumberId,
        tenantId: waTenantId,
      },
      metaMsg,
    );
    return { messageId: res.messageId, tenantScoped: true };
  }
  // Legacy / sin tenant configurado: respetamos DRY_RUN + número de Vox del env.
  if (DRY_RUN || !PHONE_NUMBER_ID) return { dryRun: true, payload: metaMsg };
  const social = new SocialMessagingClient({});
  const out = await social.send(
    new SendWhatsAppMessageCommand({
      originationPhoneNumberId: PHONE_NUMBER_ID,
      metaApiVersion: "v20.0",
      message: new TextEncoder().encode(JSON.stringify(metaMsg)),
    }),
  );
  return { messageId: (out as { messageId?: string }).messageId };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const p = event?.Details?.Parameters || event?.Parameters || event || {};
  // BYO Data Plane (#46): el Contact Flow pasa `tenantId` como Parameter.
  // Bypaseamos resolveDynamo (que pide JWT) y vamos directo a getTenantConnect.
  // Sin tenantId → legacy (Vox pooled).
  if (p?.tenantId) {
    const tc = await getTenantConnect(p.tenantId);
    if (tc) {
      dynamo = tc.dynamo;
      // BYO WhatsApp: las respuestas del agente salen desde el número del tenant
      // por su modo. mode=aws → su End User Messaging; mode=meta → su Cloud API.
      waTenantId = p.tenantId;
      waMode = tc.whatsappMode === "meta" ? "meta" : "aws";
      waMetaPhoneNumberId = tc.whatsappMetaPhoneNumberId || "";
      if (tc.whatsappPhoneNumberId) {
        waClient = tc.socialMessaging;
        waPhoneNumberId = tc.whatsappPhoneNumberId;
      }
    }
  }
  const cd = event?.Details?.ContactData || {};
  const contactId = cd.ContactId || p.contactId || "test";
  const agentBotId = p.agentBotId || "";
  const message = p.message || p.text || "";
  const to = cd?.CustomerEndpoint?.Address || p.to || "";
  const sessKey = "sess#" + contactId;

  // 1) load session state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state: any = null;
  try {
    const r = await dynamo.send(
      new GetItemCommand({ TableName: CONV_TABLE, Key: { botId: { S: sessKey } } }),
    );
    if (r.Item) {
      const it = unmarshall(r.Item) as { state?: string };
      state = it.state ? JSON.parse(it.state) : null;
    }
  } catch {
    /* fresh session */
  }

  // 2) call the Vox agent engine
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let d: any = { messages: [], state: null, done: false, handoff: false };
  if (BOT_RUNTIME_URL) {
    try {
      const resp = await fetch(BOT_RUNTIME_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId: agentBotId,
          state,
          input: message ? { text: message } : undefined,
          source: "whatsapp",
          toolEndpoints: TOOL_ENDPOINTS,
        }),
      });
      d = await resp.json();
    } catch (e) {
      d.error = String(e);
    }
  }

  // 3) persist new state
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: CONV_TABLE,
        Item: marshall(
          {
            botId: sessKey,
            recType: "session",
            agentBotId,
            state: JSON.stringify(d.state || {}),
            updatedAt: new Date().toISOString(),
          },
          { removeUndefinedValues: true },
        ),
      }),
    );
  } catch {
    /* best-effort */
  }

  // 4) send bot messages to WhatsApp (rich)
  const botMsgs: BotMsg[] = (d.messages || []).filter((m: BotMsg) => m.kind === "bot");
  const sent: Record<string, unknown>[] = [];
  if (to) {
    for (const m of botMsgs) {
      try {
        sent.push(await sendWhatsApp(to, buildMetaMessage(to, m)));
      } catch (e) {
        sent.push({ error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return {
    done: d.done ? "true" : "false",
    handoff: d.handoff ? "true" : "false",
    reply: botMsgs
      .map((m) => m.text || "")
      .join("\n")
      .slice(0, 900),
    sentCount: String(sent.length),
    dryRun: DRY_RUN ? "true" : "false",
    debug: JSON.stringify(sent).slice(0, 700),
  };
};
