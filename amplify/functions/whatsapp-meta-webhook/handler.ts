import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { getTenantConnect } from "../_shared/tenantConnect";
import { sendWhatsApp } from "../_shared/whatsappSend";

/**
 * whatsapp-meta-webhook — webhook de Meta Cloud API para números de WhatsApp
 * "sueltos" (no vinculados a AWS End User Messaging). Permite que un número de
 * Meta corra BOTS (no solo plantillas):
 *
 *   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  → verificación
 *        del webhook (Meta lo llama una vez al configurarlo).
 *   POST { entry:[{ changes:[{ value:{ metadata:{ phone_number_id }, messages:[…] }}]}] }
 *        → por cada mensaje entrante: resolvemos el tenant por phone_number_id,
 *          cargamos el estado de la conversación, llamamos a bot-runtime y
 *          respondemos por la Cloud API de Meta (vía el router whatsappSend).
 *
 * IMPORTANTE: Meta NO manda JWT (es server-to-server desde Meta). El tenant se
 * resuelve por el phone_number_id que recibió el mensaje (scan de connections,
 * modo "meta"). El número AWS-vinculado NO usa este webhook: ése entra como
 * contacto a Connect y lo maneja el contact flow + agent-channel-adapter.
 *
 * Env: WHATSAPP_VERIFY_TOKEN, BOT_RUNTIME_URL, CONNECTIONS_TABLE, BOTS_TABLE,
 *      CONV_TABLE.
 */
const legacyDynamo = new DynamoDBClient({});
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const BOTS_TABLE = process.env.BOTS_TABLE || "connectview-bots";
const CONV_TABLE = process.env.CONV_TABLE || "connectview-ai-conversations";
const BOT_RUNTIME_URL = process.env.BOT_RUNTIME_URL || "";
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "";

const TEXT = (statusCode: number, body: string) => ({
  statusCode,
  headers: { "Content-Type": "text/plain" },
  body,
});

interface BotMsg {
  kind: string;
  text?: string;
  buttons?: { id: string; label?: string; type?: string }[];
  rows?: { id: string; title?: string; description?: string }[];
}

/** Bot message → WhatsApp Cloud API message object (text / interactive).
 *  Espejo del mismo helper en agent-channel-adapter. */
function buildMetaMessage(to: string, m: BotMsg): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  const buttons = (m.buttons || []).filter((b) => !b.type || b.type === "reply").slice(0, 3);
  const rows = (m.rows || []).slice(0, 10);
  if (rows.length > 0) {
    return {
      ...base, type: "interactive",
      interactive: {
        type: "list",
        body: { text: (m.text || "Elegí una opción:").slice(0, 1024) },
        action: { button: "Ver opciones", sections: [{ rows: rows.map((r) => ({ id: String(r.id).slice(0, 200), title: String(r.title || "Opción").slice(0, 24), description: (r.description || "").slice(0, 72) })) }] },
      },
    };
  }
  if (buttons.length > 0) {
    return {
      ...base, type: "interactive",
      interactive: {
        type: "button",
        body: { text: (m.text || "…").slice(0, 1024) },
        action: { buttons: buttons.map((b) => ({ type: "reply", reply: { id: String(b.id).slice(0, 256), title: String(b.label || "OK").slice(0, 20) } })) },
      },
    };
  }
  return { ...base, type: "text", text: { body: (m.text || "…").slice(0, 4096), preview_url: false } };
}

interface TenantWa {
  tenantId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  whatsapp: any;
}

/** Encuentra el tenant cuyo WhatsApp (modo meta) tiene este phone_number_id. */
async function findTenantByMetaPhone(phoneNumberId: string): Promise<TenantWa | null> {
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await legacyDynamo.send(
      new ScanCommand({ TableName: CONNECTIONS_TABLE, ExclusiveStartKey: lastKey as never })
    );
    for (const it of res.Items || []) {
      const row = unmarshall(it) as { tenantId?: string; configJson?: string };
      try {
        const cfg = JSON.parse(row.configJson || "{}");
        const wa = cfg.whatsapp || {};
        if (wa.mode === "meta" && wa.metaPhoneNumberId === phoneNumberId) {
          return { tenantId: row.tenantId || "", whatsapp: wa };
        }
      } catch {
        /* config malformada → seguimos */
      }
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return null;
}

/** Bot a correr: el configurado (`whatsapp.botId`) o el primer publicado. */
async function pickBotId(dynamo: DynamoDBClient, configBotId?: string): Promise<string> {
  if (configBotId) return configBotId;
  try {
    const res = await dynamo.send(new ScanCommand({ TableName: BOTS_TABLE }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bots = (res.Items || [])
      .map((it) => unmarshall(it) as any)
      .filter((b) => b.botId && !String(b.botId).startsWith("conv#") && !String(b.botId).startsWith("sess#"));
    const pub = bots.find((b) => b.status === "published" || b.status === "active") || bots[0];
    return pub?.botId || "";
  } catch {
    return "";
  }
}

async function handleInbound(phoneNumberId: string, from: string, text: string): Promise<void> {
  const t = await findTenantByMetaPhone(phoneNumberId);
  if (!t || !t.tenantId) return; // número no mapeado a un tenant en modo meta

  // Data plane del tenant (bots + estado). Si no podemos asumir su rol, legacy.
  let dynamo = legacyDynamo;
  try {
    const tc = await getTenantConnect(t.tenantId);
    if (tc?.dynamo) dynamo = tc.dynamo;
  } catch {
    /* sin Connect/rol → usamos el pooled */
  }

  const botId = await pickBotId(dynamo, t.whatsapp?.botId);
  if (!botId) return; // sin bot configurado → no respondemos (evita loops)

  const sessKey = "sess#wa#" + from;

  // 1) cargar estado de la conversación
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state: any = null;
  try {
    const r = await dynamo.send(new GetItemCommand({ TableName: CONV_TABLE, Key: { botId: { S: sessKey } } }));
    if (r.Item) {
      const it = unmarshall(r.Item) as { state?: string };
      state = it.state ? JSON.parse(it.state) : null;
    }
  } catch {
    /* sesión nueva */
  }

  // 2) motor de bots
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let d: any = { messages: [], state: null };
  if (BOT_RUNTIME_URL) {
    try {
      const resp = await fetch(BOT_RUNTIME_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, state, input: text ? { text } : undefined, source: "whatsapp" }),
      });
      d = await resp.json();
    } catch (e) {
      console.error("bot-runtime falló:", e);
      return;
    }
  }

  // 3) persistir estado
  try {
    await dynamo.send(new PutItemCommand({
      TableName: CONV_TABLE,
      Item: marshall(
        { botId: sessKey, recType: "session", agentBotId: botId, state: JSON.stringify(d.state || {}), updatedAt: new Date().toISOString() },
        { removeUndefinedValues: true }
      ),
    }));
  } catch {
    /* best-effort */
  }

  // 4) responder por la Cloud API de Meta (router en modo meta)
  const route = { mode: "meta" as const, metaPhoneNumberId: phoneNumberId, tenantId: t.tenantId };
  const botMsgs: BotMsg[] = (d.messages || []).filter((m: BotMsg) => m.kind === "bot");
  for (const m of botMsgs) {
    try {
      await sendWhatsApp(route, buildMetaMessage(from, m));
    } catch (e) {
      console.error("reply Meta falló:", e);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || "GET";

  // 1) Verificación del webhook (Meta lo llama al configurarlo).
  if (method === "GET") {
    const q = event?.queryStringParameters || {};
    if (q["hub.mode"] === "subscribe" && VERIFY_TOKEN && q["hub.verify_token"] === VERIFY_TOKEN) {
      return TEXT(200, String(q["hub.challenge"] || ""));
    }
    return TEXT(403, "forbidden");
  }

  if (method !== "POST") return TEXT(200, "ok");

  // 2) Mensajes entrantes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {};
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || {});
  } catch {
    return TEXT(200, "ok");
  }

  try {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const phoneNumberId = value?.metadata?.phone_number_id || "";
        for (const msg of value.messages || []) {
          const from = msg.from;
          const text =
            msg.text?.body ||
            msg.interactive?.button_reply?.id ||
            msg.interactive?.list_reply?.id ||
            msg.button?.text ||
            "";
          if (phoneNumberId && from) await handleInbound(phoneNumberId, from, text);
        }
      }
    }
  } catch (e) {
    console.error("webhook procesamiento falló:", e);
  }

  // Meta exige un 200 rápido para no reintentar.
  return TEXT(200, "ok");
};
