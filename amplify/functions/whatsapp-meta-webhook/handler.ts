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
import { maskPhone } from "../_shared/maskPhone";
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
import {
  appendInbound,
  appendOutbound,
  convId,
  getConversation,
  markOutboundRead,
  patchConversation,
  setAssignee,
  wantsHuman,
  closeConversation,
} from "../_shared/conversations";
import {
  findWaNumber,
  normalizeWaNumbers,
  type WhatsAppConfig,
  type WhatsAppNumber,
} from "../_shared/whatsappNumbers";
import { loadMetaAppSecret, verifyMetaSignature } from "../_shared/metaSignature";

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
  /** El número específico que recibió el mensaje (con su ruteo `botId`). */
  number?: WhatsAppNumber;
}

/** Encuentra el tenant + el número (modo meta) que tiene este phone_number_id.
 *  Multi-número: matchea sobre whatsapp.numbers[] (con retrocompat del singular).
 *  El ruteo número→flujo (botId) vive en el número devuelto, no global del tenant. */
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
        const wa = (cfg.whatsapp || {}) as WhatsAppConfig;
        const number = findWaNumber(normalizeWaNumbers(wa), phoneNumberId);
        if (number && (number.mode || "meta") === "meta") {
          return { tenantId: row.tenantId || "", whatsapp: wa, number };
        }
      } catch {
        /* config malformada → seguimos */
      }
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return null;
}

/**
 * Bot a correr para este WhatsApp: el linkeado explícitamente (`whatsapp.botId`)
 * o, si no, el primer bot PUBLICADO/activo del tenant. Si no hay flujo linkeado
 * NI publicado, devuelve "" → la conversación va DIRECTO a un agente humano (no
 * auto-respondemos con un borrador que el tenant no eligió). Regla de negocio:
 * "si linkeás tu WhatsApp a un flujo, se respeta el flujo; si no, va al agente".
 */
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
    // Solo un bot PUBLICADO/activo atiende (sin `|| bots[0]`): un borrador no
    // responde → sin flujo linkeado ni publicado, la conversación va al agente.
    const pub = bots.find((b) => b.status === "published" || b.status === "active");
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
      `flow reply: tenant=${t.tenantId} phone=${maskPhone(phone)} flow=${nfm.name || "—"} lead=${result.leadId || "—"} fields=${Object.keys(attributes).length}`,
    );
  } catch (e) {
    console.error("flow reply → CRM falló:", e);
  }
}

async function handleInbound(
  phoneNumberId: string,
  from: string,
  text: string,
  messageId?: string,
  /** Outlet del flujo si el cliente tocó un botón/lista del bot (b:<id> / r:<id>).
   *  Cuando viene, es navegación del bot: NO se evalúa la red global de escalado. */
  choice?: string,
): Promise<void> {
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
      if (r.updated)
        console.log(`SF DoNotCall=${isStop} en Lead ${r.sfId} (${maskPhone(phoneE164)})`);
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
      `opt-${isStop ? "out" : "in"}: tenant=${t.tenantId} phone=${maskPhone(phoneE164)} lead=${leadId || "—"}`,
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
      messageId, // id del inbound → para el read-receipt del agente (markRead)
    });
  } catch (e) {
    console.error("mirror WhatsApp→inbox falló:", e);
  }

  // ── Automatizaciones (#15) · trigger message_inbound ──────────────────────
  // Un mensaje REAL del cliente (texto o tap de botón/lista) dispara la regla.
  // Los STOP/ALTA ya retornaron arriba → acá nunca entra un opt-out. Es
  // fire-and-forget (AbortController ~1.5s + catch total en fireAutomation), así
  // que NO bloquea ni demora la respuesta del bot. El engine resuelve el lead por
  // teléfono en las acciones que lo necesiten.
  try {
    await fireAutomation({
      type: "message_inbound",
      tenantId: t.tenantId,
      lead: { phone: phoneE164 },
      message: { channel: "whatsapp", text: text || undefined },
    });
  } catch {
    /* el motor es best-effort; el flujo del bot sigue intacto */
  }
  // ── Escalado Bot→Agente (guarda GLOBAL) ───────────────────────────────────
  // El bot SOLO responde cuando la conversación NO está en manos de un humano.
  // El estado canónico es `assignee` (setAssignee / reply del agente; un inbound
  // reabre en "bot"). Cuando `assignee` está presente, MANDA él.
  //   · assignee === "agent" → la atiende un humano → bot omitido.
  //   · assignee === "bot"   → la atiende el Agente IA → el bot procesa.
  // El legacy `assignedAgent` (username del último humano que respondió) SOLO se
  // usa como respaldo para conversaciones viejas SIN `assignee`; si no, cortaba
  // el bot para siempre (ese campo nunca se limpia) aun tras reabrir/Devolver a
  // la IA con assignee="bot".
  const convChannelId = convId("whatsapp", from);
  const takenByHuman =
    mirrored?.assignee === "agent" ||
    (mirrored?.assignee == null && !!mirrored?.assignedAgent && mirrored.assignedAgent !== "bot");
  if (takenByHuman) {
    console.log(`WhatsApp ${maskPhone(from)}: en manos de un humano → bot omitido`);
    return;
  }

  // Detección de intención "quiero un humano" (keywords robustos a tildes/mayús).
  // Si el cliente lo pide, escalamos ANTES de que el bot IA genere su respuesta:
  //  1) pasamos la conversación a assignee="agent" (el humano toma el hilo),
  //  2) el bot NO contesta su respuesta RAG normal — manda UN aviso de traspaso,
  //  3) marcamos unread (necesita atención del equipo) — patrón de appendInbound.
  // Nota: si integrás auto-respuesta del bot en OTROS canales del inbox
  // (meta-messaging-webhook, mercadolibre-webhook), replicá esta misma guarda +
  // detección allí (wantsHuman + setAssignee) usando su propio convId/canal.
  if (!choice && wantsHuman(text)) {
    console.log(`WhatsApp ${maskPhone(from)}: pidió humano → escalando a agente`);
    try {
      await setAssignee(legacyDynamo, convChannelId, "agent");
      // "necesita atención": elevamos unread como hace un inbound (no lo pisamos a 0).
      const cur = mirrored || (await getConversation(legacyDynamo, convChannelId));
      await patchConversation(legacyDynamo, convChannelId, {
        unread: Math.max(1, (cur?.unread || 0) + 1),
      });
    } catch (e) {
      console.error("escalado a agente (setAssignee) falló:", e);
    }
    const HANDOFF_TEXT = "¡Claro! Te comunico con un asesor humano. En un momento te atienden 🙂";
    try {
      await sendWhatsApp(
        { mode: "meta" as const, metaPhoneNumberId: phoneNumberId, tenantId: t.tenantId },
        buildMetaMessage(from, { kind: "bot", text: HANDOFF_TEXT }),
      );
      // Espejo del aviso al inbox como saliente del bot (best-effort). OJO:
      // appendOutbound resetea unread a 0; por eso re-marcamos unread después.
      try {
        await appendOutbound(legacyDynamo, convChannelId, HANDOFF_TEXT, "bot");
        await patchConversation(legacyDynamo, convChannelId, { unread: 1 });
      } catch {
        /* mirror best-effort */
      }
    } catch (e) {
      console.error("aviso de traspaso a WhatsApp falló:", e);
    }
    return; // el bot NO genera su respuesta RAG: el humano atiende
  }

  // El flujo del NÚMERO que recibió el mensaje (ruteo por número). Si ese número
  // no tiene flujo linkeado, cae al fallback (primer bot publicado / agente humano).
  const botId = await pickBotId(dynamo, t.number?.botId ?? t.whatsapp?.botId);
  if (!botId) {
    // Sin flujo linkeado ni publicado → NO auto-respondemos con un bot: la
    // conversación va DIRECTO a un agente humano. La dejamos en estado "Agente"
    // para que aparezca en la cola del inbox y un humano la tome. (En el próximo
    // inbound la guarda global de arriba corta, así no la re-tocamos.)
    await setAssignee(legacyDynamo, convChannelId, "agent");
    console.log(`WhatsApp ${maskPhone(from)}: sin flujo linkeado → directo a agente`);
    return;
  }

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
          input: choice ? { choice } : text ? { text } : undefined,
          source: "whatsapp",
          // Sin JWT (server-to-server): bot-runtime resuelve el data-plane + Bedrock
          // del tenant por este tenantId. Sin él, loadBot cae a blocked → 400.
          tenantId: t.tenantId,
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
          await appendOutbound(legacyDynamo, convChannelId, m.text, "bot");
        } catch {
          /* mirror best-effort */
        }
      }
    } catch (e) {
      console.error("reply Meta falló:", e);
    }
  }

  // Escalado Bot→Agente (señal del PROPIO bot-runtime): si su flujo derivó a un
  // humano (nodo handoff, confianza baja o max turns → devuelve handoff:true), lo
  // reflejamos en el inbox pasando la conversación a assignee="agent" + unread. Los
  // mensajes del bot ya salieron arriba (incluido el aviso de derivación del flujo),
  // así que acá solo cambiamos de manos. En el próximo inbound la guarda global corta.
  if (d.handoff === true || d.handoff === "true") {
    console.log(`WhatsApp ${maskPhone(from)}: bot-runtime derivó (handoff) → assignee=agent`);
    try {
      await setAssignee(legacyDynamo, convChannelId, "agent");
      const cur = await getConversation(legacyDynamo, convChannelId);
      await patchConversation(legacyDynamo, convChannelId, {
        unread: Math.max(1, (cur?.unread || 0) + 1),
      });
    } catch (e) {
      console.error("escalado por handoff del bot (setAssignee) falló:", e);
    }
  } else if (d.done === true || d.done === "true") {
    // Fin del flujo / Agente IA (done sin handoff): el bot ya se despidió en su
    // último mensaje → CERRAMOS la conversación (reason "resolved"). El cierre
    // unificado suelta el dueño → el próximo inbound del cliente la reabre limpia
    // con el bot (no queda "cerrada para siempre" ni pegada a un agente).
    console.log(`WhatsApp ${maskPhone(from)}: bot-runtime terminó (done) → cierro la conversación`);
    try {
      await closeConversation(legacyDynamo, convChannelId, "resolved");
    } catch (e) {
      console.error("cierre por fin del bot falló:", e);
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
  // ── Pilar 6 · recibo de LECTURA entrante → "visto ✓✓" en la bandeja ──────────
  // Cuando el cliente lee nuestros mensajes, Meta manda statuses[].status==="read".
  // Marcamos los salientes de esa conversación como leídos. La conversación espejo
  // vive en la tabla pooled (legacyDynamo), igual que el mirror del inbound.
  // Best-effort: independiente del tracking de HSM (que sí usa el dynamo del tenant).
  if (st.status === "read" && st.recipient_id) {
    try {
      await markOutboundRead(legacyDynamo, convId("whatsapp", st.recipient_id));
    } catch (e) {
      console.warn("mark read (inbox) falló:", (e as Error).message);
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
      console.log(`quarantine: ${maskPhone(phone)} (${res.reason}) tenant=${tenantId || "—"}`);
    } catch (e) {
      console.error("quarantine falló:", e);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  // Warmer (EventBridge ~cada 5min): mantiene el contenedor caliente para matar el
  // cold start del 1er WhatsApp. Sale al instante, sin procesar nada.
  if (event?.warmer) return { statusCode: 200, body: "warm" };

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
  // SEC-C5 — validar la firma HMAC de Meta (X-Hub-Signature-256) sobre el body
  // CRUDO antes de procesar. Sin esto, cualquiera con la URL pública podría
  // inyectar eventos falsos (mensajes/estados). El GET de verificación (arriba)
  // va por otro camino y no lleva firma.
  const hdrs = (event.headers || {}) as Record<string, string | undefined>;
  const rawBody: string =
    typeof event.body === "string"
      ? event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body
      : JSON.stringify(event.body || {});
  const sig = hdrs["x-hub-signature-256"] || hdrs["X-Hub-Signature-256"];
  // Firma con el App Secret del secret connectview/meta (el mismo que usan
  // meta-oauth-start/callback). Build-ahead: hoy ese secret NO existe →
  // loadMetaAppSecret devuelve "" y se hace fail-open (no rompe el webhook actual).
  // Go-live Meta (pendiente/cliente): crear connectview/meta {appId,appSecret} +
  // attachear la managed policy connectview-meta-secret-access al rol → la firma se
  // activa sola. Ver design/auditoria-codigo-2026-07-04.md.
  const appSecret = await loadMetaAppSecret();
  if (!appSecret) {
    console.warn("meta signature: sin app secret, saltando validación");
  } else if (!verifyMetaSignature(rawBody, sig, appSecret)) {
    console.warn("meta signature inválida — rechazando POST");
    return TEXT(403, "forbidden");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
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
          // Botón/lista tappable → `choice` = outlet del flujo del bot (b:<id> /
          // r:<id>). Es navegación del bot, NO texto libre: el runtime avanza por
          // esa rama y NO lo evalúa la red global de escalado (wantsHuman). El
          // `text` legible (el título) se espeja al inbox.
          const br = msg.interactive?.button_reply;
          const lr = msg.interactive?.list_reply;
          // bot-runtime YA emite los ids de botón/fila CON su prefijo ("b:"/"r:"),
          // y buildMetaMessage los manda tal cual como reply.id → Meta los devuelve
          // igual. Usarlos directo: re-prefijar daba "b:b:maestrias" y ningún edge
          // del grafo matcheaba → el bot no avanzaba al tocar un botón.
          const choice = br?.id || lr?.id || undefined;
          const text = msg.text?.body || br?.title || lr?.title || msg.button?.text || "";
          if (phoneNumberId && from) await handleInbound(phoneNumberId, from, text, msg.id, choice);
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
