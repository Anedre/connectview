import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { CustomerProfilesClient } from "@aws-sdk/client-customer-profiles";
import { getTenantConnect } from "../_shared/tenantConnect";
import { sendWhatsApp } from "../_shared/whatsappSend";
import {
  appendLeadHistory,
  getLeadByPhone,
  propagateLead,
  pushDoNotCallToSalesforce,
  setActiveDynamo,
  setActiveProfiles,
} from "../_shared/leadSync";
import { setActiveTenant } from "../_shared/salesforceClient";
import { fireAutomation } from "../_shared/automationHook";
import {
  matchesOptInKeyword,
  matchesStopKeyword,
  recordOptOut,
  recordSuppression,
  removeSuppression,
} from "../_shared/suppression";
import { updateHsmStatus, type HsmStatus } from "../_shared/hsmStatus";
import { appendInbound, appendOutbound, convId } from "../_shared/conversations";

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
  media?: { type: string; url: string; caption?: string };
}

/** Bot message → WhatsApp Cloud API message object (text / interactive).
 *  Espejo del mismo helper en agent-channel-adapter. */
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
      new ScanCommand({ TableName: CONNECTIONS_TABLE, ExclusiveStartKey: lastKey as never }),
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
    const bots = (res.Items || [])
      .map((it) => unmarshall(it) as { botId?: string; status?: string })
      .filter(
        (b) =>
          b.botId && !String(b.botId).startsWith("conv#") && !String(b.botId).startsWith("sess#"),
      );
    const pub = bots.find((b) => b.status === "published" || b.status === "active") || bots[0];
    return pub?.botId || "";
  } catch {
    return "";
  }
}

// Client CP "fail-closed": con domain "" el upsert del Cliente 360° se saltea.
// (Pasar client=null a setActiveProfiles caería al dominio LEGACY de Novasys —
// leak cross-tenant. Este webhook es de tenants modo "meta", nunca Novasys.)
const cpFailClosed = new CustomerProfilesClient({ maxAttempts: 1 });

/**
 * Respuesta de un WhatsApp Flow (formulario nativo, #10): el cliente completó
 * el form → Meta manda `interactive.nfm_reply` con `response_json`. Acá lo
 * convertimos en CRM: upsert del lead (hub propagateLead → tabla + Customer
 * Profile + SF) con los campos del form como attributes `flow_*`, historial,
 * y el trigger de Automatizaciones `whatsapp_flow_completed` (#15).
 */
async function handleFlowReply(
  phoneNumberId: string,
  from: string,
  nfm: { name?: string; body?: string; response_json?: string },
): Promise<void> {
  const t = await findTenantByMetaPhone(phoneNumberId);
  if (!t || !t.tenantId) return;

  // Contexto del tenant para el hub de leads (mismo fallback pooled que las
  // sesiones de bot de este webhook). CP: fail-closed si no hay rol del tenant.
  setActiveTenant(t.tenantId);
  try {
    const tc = await getTenantConnect(t.tenantId);
    setActiveDynamo(tc?.dynamo ?? null);
    if (tc?.customerProfiles) {
      setActiveProfiles(tc.customerProfiles, tc.customerProfilesDomain ?? "");
    } else {
      setActiveProfiles(cpFailClosed, "");
    }
  } catch {
    setActiveDynamo(null);
    setActiveProfiles(cpFailClosed, "");
  }

  // Campos del form → attributes flow_<campo>. flow_token interno se descarta.
  let fields: Record<string, unknown> = {};
  try {
    fields = JSON.parse(nfm.response_json || "{}");
  } catch {
    /* respuesta malformada → igual registramos la interacción */
  }
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === "flow_token" || v == null) continue;
    attributes[`flow_${k}`.slice(0, 64)] = String(v).slice(0, 512);
  }
  if (nfm.name) attributes.last_flow = String(nfm.name).slice(0, 128);

  // Nombre del lead si el form lo trae (campos típicos).
  const name =
    (fields.name as string) ||
    (fields.nombre as string) ||
    (fields.full_name as string) ||
    undefined;

  const phone = from.startsWith("+") ? from : `+${from}`;
  try {
    const result = await propagateLead(
      { phone, name, source: "WhatsApp Flow", attributes },
      { origin: "vox" },
    );
    if (result.leadId) {
      await appendLeadHistory(result.leadId, {
        ts: new Date().toISOString(),
        type: "interaccion",
        channel: "WhatsApp",
        notes: `Formulario completado${nfm.name ? ` · ${nfm.name}` : ""}`,
      });
    }
    await fireAutomation({
      type: "whatsapp_flow_completed",
      tenantId: t.tenantId,
      lead: { leadId: result.leadId, phone, name, source: "WhatsApp Flow" },
      flow: { name: nfm.name },
    });
    console.log(
      `flow reply: tenant=${t.tenantId} phone=${phone} flow=${nfm.name || "—"} lead=${result.leadId || "—"} fields=${Object.keys(attributes).length}`,
    );
  } catch (e) {
    console.error("flow reply → CRM falló:", e);
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

  // ── Pilar 3 · opt-out / STOP (compliance Meta) ────────────────────────────
  // Si el inbound es una palabra de baja → suprimir WhatsApp + confirmar + NO
  // correr el bot (un STOP no es un turno de conversación). Re-alta (ALTA/START)
  // → quitar de la lista. Es lo que protege el número de baneos.
  const phoneE164 = from.startsWith("+") ? from : `+${from}`;
  const isStop = matchesStopKeyword(text);
  const isOptIn = !isStop && matchesOptInKeyword(text);
  if (isStop || isOptIn) {
    setActiveDynamo(dynamo); // getLeadByPhone/appendLeadHistory usan el dynamo del tenant
    let leadId: string | undefined;
    try {
      leadId = (await getLeadByPhone(phoneE164))?.leadId;
    } catch {
      /* sin lead → la entrada de supresión es el registro de verdad */
    }
    try {
      if (isStop) {
        await recordOptOut(dynamo, phoneE164, {
          channels: ["whatsapp"],
          reason: `Baja por WhatsApp: "${(text || "").trim().slice(0, 40)}"`,
          source: "inbound_keyword",
          tenantId: t.tenantId,
          leadId,
        });
      } else {
        await removeSuppression(dynamo, phoneE164);
      }
    } catch (e) {
      console.error("opt-out/in record falló:", e);
    }
    // Pilar 3 Fase C — propagar la baja/alta a Salesforce (DoNotCall). El tenant
    // BYO usa su propia org → activamos su contexto SF antes del push. Best-effort:
    // si SF no está conectado o no hay match, no-op. STOP→true, ALTA→false.
    try {
      setActiveTenant(t.tenantId);
      const r = await pushDoNotCallToSalesforce(phoneE164, isStop, { voxLeadId: leadId });
      if (r.updated) console.log(`SF DoNotCall=${isStop} en Lead ${r.sfId} (${phoneE164})`);
    } catch (e) {
      console.warn("SF DoNotCall push falló (best-effort):", e);
    }
    const confirmText = isStop
      ? "Listo ✅ No volverás a recibir mensajes de WhatsApp de nuestra parte. Si fue un error, respondé *ALTA* para reactivar."
      : "Listo ✅ Reactivamos tus mensajes de WhatsApp. ¡Gracias por volver!";
    try {
      await sendWhatsApp(
        { mode: "meta" as const, metaPhoneNumberId: phoneNumberId, tenantId: t.tenantId },
        buildMetaMessage(from, { kind: "bot", text: confirmText }),
      );
    } catch (e) {
      console.error("opt-out confirm falló:", e);
    }
    if (leadId) {
      try {
        await appendLeadHistory(leadId, {
          ts: new Date().toISOString(),
          type: "note",
          channel: "WhatsApp",
          notes: isStop
            ? `🚫 Opt-out (baja por WhatsApp): "${(text || "").trim().slice(0, 60)}"`
            : `🔔 Re-alta (reactivó WhatsApp): "${(text || "").trim().slice(0, 60)}"`,
        });
      } catch {
        /* best-effort */
      }
    }
    console.log(
      `opt-${isStop ? "out" : "in"}: tenant=${t.tenantId} phone=${phoneE164} lead=${leadId || "—"}`,
    );
    return; // NO corremos el bot para un STOP/ALTA
  }

  // ── Pilar 6 · espejo al inbox omnicanal (best-effort, aditivo) ────────────
  // Toda conversación de WhatsApp aparece en la bandeja de ARIA junto a IG/
  // Messenger. El teléfono = senderId → se auto-vincula al lead (Cliente 360).
  // La tabla `connectview-conversations` es pooled → usamos el dynamo legacy.
  let mirrored: Awaited<ReturnType<typeof appendInbound>> | null = null;
  try {
    mirrored = await appendInbound(legacyDynamo, {
      channel: "whatsapp",
      senderId: from,
      text,
      tenantId: t.tenantId,
    });
  } catch (e) {
    console.error("mirror WhatsApp→inbox falló:", e);
  }
  // Handoff bot↔humano: si un AGENTE ya tomó esta conversación en la bandeja
  // (assignedAgent != "bot"), el bot se retira y deja que el humano responda.
  if (mirrored?.assignedAgent && mirrored.assignedAgent !== "bot") {
    console.log(`WhatsApp ${from}: tomada por ${mirrored.assignedAgent} → bot omitido`);
    return;
  }

  const botId = await pickBotId(dynamo, t.whatsapp?.botId);
  if (!botId) return; // sin bot configurado → no respondemos (evita loops)

  const sessKey = "sess#wa#" + from;

  // 1) cargar estado de la conversación
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
        body: JSON.stringify({
          botId,
          state,
          input: text ? { text } : undefined,
          source: "whatsapp",
        }),
      });
      d = await resp.json();
    } catch (e) {
      console.error("bot-runtime falló:", e);
      return;
    }
  }

  // 3) persistir estado
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: CONV_TABLE,
        Item: marshall(
          {
            botId: sessKey,
            recType: "session",
            agentBotId: botId,
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

  // 4) responder por la Cloud API de Meta (router en modo meta)
  const route = { mode: "meta" as const, metaPhoneNumberId: phoneNumberId, tenantId: t.tenantId };
  const botMsgs: BotMsg[] = (d.messages || []).filter((m: BotMsg) => m.kind === "bot");
  for (const m of botMsgs) {
    try {
      await sendWhatsApp(route, buildMetaMessage(from, m));
      // Espejo de la respuesta del bot al inbox (best-effort).
      if (m.text) {
        try {
          await appendOutbound(legacyDynamo, convId("whatsapp", from), m.text, "bot");
        } catch {
          /* mirror best-effort */
        }
      }
    } catch (e) {
      console.error("reply Meta falló:", e);
    }
  }
}

/**
 * Pilar 4 — recibo de entrega de Meta (value.statuses[]). Avanza el estado del
 * HSM en connectview-hsm-sends y, si falló por número inválido/bloqueado,
 * cuarentena el número (puente con el motor de supresión del Pilar 3). Resuelve
 * el data-plane por phone_number_id; si no matchea un tenant meta, usa el pooled.
 */
async function handleStatus(
  phoneNumberId: string,
  st: {
    id?: string;
    status?: string;
    recipient_id?: string;
    errors?: { code?: number | string; title?: string }[];
  },
): Promise<void> {
  if (!st.id || !st.status) return;
  let dynamo = legacyDynamo;
  let tenantId: string | undefined;
  const t = await findTenantByMetaPhone(phoneNumberId);
  if (t?.tenantId) {
    tenantId = t.tenantId;
    try {
      const tc = await getTenantConnect(t.tenantId);
      if (tc?.dynamo) dynamo = tc.dynamo;
    } catch {
      /* sin rol → pooled */
    }
  }
  const res = await updateHsmStatus(dynamo, st.id, st.status as HsmStatus, { errors: st.errors });
  if (res.isPermanentFailure && st.recipient_id) {
    const phone = st.recipient_id.startsWith("+") ? st.recipient_id : `+${st.recipient_id}`;
    try {
      await recordSuppression(dynamo, phone, {
        status: "quarantined",
        channels: ["whatsapp"],
        reason: `Número inválido (WhatsApp): ${res.reason || "no entregable"}`,
        source: "status_webhook",
        tenantId,
      });
      console.log(`quarantine: ${phone} (${res.reason}) tenant=${tenantId || "—"}`);
    } catch (e) {
      console.error("quarantine falló:", e);
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
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
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
          // Respuesta de un WhatsApp Flow (#10): va al CRM, NO al bot (el
          // JSON crudo no es un turno de conversación).
          const nfm = msg.interactive?.nfm_reply;
          if (phoneNumberId && from && nfm) {
            await handleFlowReply(phoneNumberId, from, nfm);
            continue;
          }
          const text =
            msg.text?.body ||
            msg.interactive?.button_reply?.id ||
            msg.interactive?.list_reply?.id ||
            msg.button?.text ||
            "";
          if (phoneNumberId && from) await handleInbound(phoneNumberId, from, text);
        }
        // Pilar 4 — recibos de entrega (delivered/read/failed) llegan en el mismo
        // webhook, en value.statuses[]. Avanzan el estado del HSM + cuarentena.
        for (const st of value.statuses || []) {
          if (phoneNumberId && st?.id) await handleStatus(phoneNumberId, st);
        }
      }
    }
  } catch (e) {
    console.error("webhook procesamiento falló:", e);
  }

  // Meta exige un 200 rápido para no reintentar.
  return TEXT(200, "ok");
};
