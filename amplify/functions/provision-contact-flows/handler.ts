/**
 * provision-contact-flows — crea (o actualiza) el set CANÓNICO de contact flows
 * de ARIA en la instancia de Amazon Connect del TENANT, vía su rol cross-account.
 *
 * Es la pieza #1 del onboarding multi-tenant: sin flows en su instancia, un
 * cliente nuevo no puede recibir ni hacer un solo contacto. Antes los flows eran
 * UDEP-específicos y se creaban a mano; esto los genera genéricos y parametrizados.
 *
 * POST { dryRun?: boolean }  (tenantId SIEMPRE del JWT, nunca del body)
 *   dryRun=true  → resuelve recursos (cola default) + arma el Content de cada
 *                  flow y lo devuelve, SIN crear nada (para verificar).
 *   dryRun=false → CreateContactFlow (o UpdateContactFlowContent si ya existe por
 *                  nombre) para cada plantilla y guarda los ids en la config del
 *                  tenant (connectview-connections.contactFlows).
 *
 * Las plantillas son BUILDERS (objetos JS → JSON.stringify), no string-replace:
 * cero problemas de escaping/emoji. La cola se resuelve por nombre en SU
 * instancia (la default "BasicQueue"), así funciona sin crear colas.
 *
 * Requiere que el rol cross-account del tenant (VoxCrmConnectAccess) tenga:
 *   connect:ListQueues, connect:ListContactFlows, connect:CreateContactFlow,
 *   connect:UpdateContactFlowContent.
 */
import {
  ConnectClient,
  ListQueuesCommand,
  ListContactFlowsCommand,
  CreateContactFlowCommand,
  UpdateContactFlowContentCommand,
} from "@aws-sdk/client-connect";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { getIdentity } from "../_shared/cognitoAuth";
import { getTenantConnect } from "../_shared/tenantConnect";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const ddb = new DynamoDBClient({ region: REGION });

const CORS: Record<string, string> = { "Content-Type": "application/json" };
function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
}

// ───────────────────────── Plantillas canónicas (builders) ──────────────────
// Cada builder devuelve el objeto Content de un contact flow. Mantenemos el
// mismo "preámbulo" que usan los flows reales (logging + voz + idioma) para que
// el comportamiento (TTS español, grabación) sea consistente.

const VOICE = "Lupe"; // voz TTS español (Polly). Configurable a futuro por tenant.
const LANG = "es-US";

/** Despedida / cierre de chat. Texto del tenant o genérico. */
function buildDisconnectFlow(farewell: string): object {
  return {
    Version: "2019-10-30",
    StartAction: "log",
    Metadata: {
      entryPointPosition: { x: 40, y: 40 },
      ActionMetadata: {
        log: { position: { x: 60, y: 60 } },
        msg: { position: { x: 220, y: 60 } },
        end: { position: { x: 380, y: 60 } },
      },
      name: "ARIA-Disconnect",
      description: "ARIA · cierre de contacto con mensaje de despedida (genérico, editable por tenant).",
      type: "contactFlow",
      status: "PUBLISHED",
    },
    Actions: [
      { Identifier: "log", Type: "UpdateFlowLoggingBehavior", Parameters: { FlowLoggingBehavior: "Enabled" }, Transitions: { NextAction: "msg" } },
      {
        Identifier: "msg",
        Type: "MessageParticipant",
        Parameters: { Text: farewell },
        Transitions: { NextAction: "end", Errors: [{ NextAction: "end", ErrorType: "NoMatchingError" }] },
      },
      { Identifier: "end", Type: "DisconnectParticipant", Parameters: {}, Transitions: {} },
    ],
  };
}

/** Entrante (voz + chat): saludo → cola default → transferir → (ocupado) cerrar. */
function buildInboundFlow(queueId: string, greeting: string, busy: string): object {
  return {
    Version: "2019-10-30",
    StartAction: "log",
    Metadata: {
      entryPointPosition: { x: 40, y: 40 },
      ActionMetadata: {
        log: { position: { x: 60, y: 60 } },
        voice: { position: { x: 200, y: 60 } },
        lang: { position: { x: 340, y: 60 } },
        greet: { position: { x: 480, y: 60 } },
        setq: { position: { x: 620, y: 60 } },
        xfer: { position: { x: 760, y: 60 } },
        busy: { position: { x: 900, y: 200 } },
        end: { position: { x: 1040, y: 60 } },
      },
      name: "ARIA-Inbound",
      description: "ARIA · entrante genérico: saluda y transfiere a la cola principal. Editable por tenant.",
      type: "contactFlow",
      status: "PUBLISHED",
    },
    Actions: [
      { Identifier: "log", Type: "UpdateFlowLoggingBehavior", Parameters: { FlowLoggingBehavior: "Enabled" }, Transitions: { NextAction: "voice" } },
      { Identifier: "voice", Type: "UpdateContactTextToSpeechVoice", Parameters: { TextToSpeechVoice: VOICE }, Transitions: { NextAction: "lang", Errors: [{ NextAction: "lang", ErrorType: "NoMatchingError" }] } },
      { Identifier: "lang", Type: "UpdateContactData", Parameters: { LanguageCode: LANG }, Transitions: { NextAction: "greet", Errors: [{ NextAction: "greet", ErrorType: "NoMatchingError" }] } },
      { Identifier: "greet", Type: "MessageParticipant", Parameters: { Text: greeting }, Transitions: { NextAction: "setq", Errors: [{ NextAction: "setq", ErrorType: "NoMatchingError" }] } },
      { Identifier: "setq", Type: "UpdateContactTargetQueue", Parameters: { QueueId: queueId }, Transitions: { NextAction: "xfer", Errors: [{ NextAction: "end", ErrorType: "NoMatchingError" }] } },
      {
        Identifier: "xfer",
        Type: "TransferContactToQueue",
        Parameters: {},
        Transitions: { NextAction: "end", Errors: [{ NextAction: "busy", ErrorType: "QueueAtCapacity" }, { NextAction: "busy", ErrorType: "NoMatchingError" }] },
      },
      { Identifier: "busy", Type: "MessageParticipant", Parameters: { Text: busy }, Transitions: { NextAction: "end", Errors: [{ NextAction: "end", ErrorType: "NoMatchingError" }] } },
      { Identifier: "end", Type: "DisconnectParticipant", Parameters: {}, Transitions: {} },
    ],
  };
}

/** Saliente (campañas): graba → cola default → transferir → cerrar. Sin saludo. */
function buildOutboundFlow(queueId: string): object {
  return {
    Version: "2019-10-30",
    StartAction: "log",
    Metadata: {
      entryPointPosition: { x: 40, y: 40 },
      ActionMetadata: {
        log: { position: { x: 60, y: 60 } },
        voice: { position: { x: 200, y: 60 } },
        lang: { position: { x: 340, y: 60 } },
        record: { position: { x: 480, y: 60 } },
        setq: { position: { x: 620, y: 60 } },
        xfer: { position: { x: 760, y: 60 } },
        end: { position: { x: 900, y: 60 } },
      },
      name: "ARIA-Outbound",
      description: "ARIA · saliente de campañas: graba y transfiere a la cola principal. Editable por tenant.",
      type: "contactFlow",
      status: "PUBLISHED",
    },
    Actions: [
      { Identifier: "log", Type: "UpdateFlowLoggingBehavior", Parameters: { FlowLoggingBehavior: "Enabled" }, Transitions: { NextAction: "voice" } },
      { Identifier: "voice", Type: "UpdateContactTextToSpeechVoice", Parameters: { TextToSpeechVoice: VOICE }, Transitions: { NextAction: "lang", Errors: [{ NextAction: "lang", ErrorType: "NoMatchingError" }] } },
      { Identifier: "lang", Type: "UpdateContactData", Parameters: { LanguageCode: LANG }, Transitions: { NextAction: "record", Errors: [{ NextAction: "record", ErrorType: "NoMatchingError" }] } },
      {
        Identifier: "record",
        Type: "UpdateContactRecordingBehavior",
        Parameters: { RecordingBehavior: { RecordedParticipants: ["Agent", "Customer"] } },
        Transitions: { NextAction: "setq" },
      },
      { Identifier: "setq", Type: "UpdateContactTargetQueue", Parameters: { QueueId: queueId }, Transitions: { NextAction: "xfer", Errors: [{ NextAction: "end", ErrorType: "NoMatchingError" }] } },
      { Identifier: "xfer", Type: "TransferContactToQueue", Parameters: {}, Transitions: { NextAction: "end", Errors: [{ NextAction: "end", ErrorType: "QueueAtCapacity" }, { NextAction: "end", ErrorType: "NoMatchingError" }] } },
      { Identifier: "end", Type: "DisconnectParticipant", Parameters: {}, Transitions: {} },
    ],
  };
}

/**
 * Saliente SMART (campañas multi-cola): preámbulo → Compare sobre
 * $.Attributes.<atributo> → una cola por valor (UpdateContactTargetQueue literal,
 * que el parser de get-flow-queues detecta) → transferir. Varias reglas pueden
 * apuntar a la misma cola; los valores sin match caen a la cola por defecto.
 * Misma forma EXACTA que el UDEP-Outbound-Smart real (Connect es estricto).
 */
function buildSmartOutboundFlow(
  attribute: string,
  rules: { value: string; queueId: string }[],
  defaultQueueId: string,
  flowName: string
): object {
  const qActionId = (qid: string) => "q_" + qid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  const uniqueQueueIds = [...new Set([...rules.map((r) => r.queueId), defaultQueueId].filter(Boolean))];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actions: any[] = [
    { Identifier: "log", Type: "UpdateFlowLoggingBehavior", Parameters: { FlowLoggingBehavior: "Enabled" }, Transitions: { NextAction: "voice" } },
    { Identifier: "voice", Type: "UpdateContactTextToSpeechVoice", Parameters: { TextToSpeechVoice: VOICE }, Transitions: { NextAction: "lang", Errors: [{ NextAction: "lang", ErrorType: "NoMatchingError" }] } },
    { Identifier: "lang", Type: "UpdateContactData", Parameters: { LanguageCode: LANG }, Transitions: { NextAction: "record", Errors: [{ NextAction: "record", ErrorType: "NoMatchingError" }] } },
    { Identifier: "record", Type: "UpdateContactRecordingBehavior", Parameters: { RecordingBehavior: { RecordedParticipants: ["Agent", "Customer"] } }, Transitions: { NextAction: "check" } },
    {
      Identifier: "check",
      Type: "Compare",
      Parameters: { ComparisonValue: `$.Attributes.${attribute}` },
      Transitions: {
        NextAction: qActionId(defaultQueueId),
        Conditions: rules.map((r) => ({ Condition: { Operator: "Equals", Operands: [String(r.value)] }, NextAction: qActionId(r.queueId) })),
        Errors: [{ NextAction: qActionId(defaultQueueId), ErrorType: "NoMatchingCondition" }],
      },
    },
    ...uniqueQueueIds.map((qid) => ({
      Identifier: qActionId(qid),
      Type: "UpdateContactTargetQueue",
      Parameters: { QueueId: qid },
      Transitions: { NextAction: "xfer", Errors: [{ NextAction: "end", ErrorType: "NoMatchingError" }] },
    })),
    { Identifier: "xfer", Type: "TransferContactToQueue", Parameters: {}, Transitions: { NextAction: "end", Errors: [{ NextAction: "end", ErrorType: "QueueAtCapacity" }, { NextAction: "end", ErrorType: "NoMatchingError" }] } },
    { Identifier: "end", Type: "DisconnectParticipant", Parameters: {}, Transitions: {} },
  ];

  const ActionMetadata: Record<string, unknown> = {};
  actions.forEach((a, i) => {
    ActionMetadata[a.Identifier] = { position: { x: 60 + (i % 5) * 220, y: 60 + Math.floor(i / 5) * 150 } };
  });

  return {
    Version: "2019-10-30",
    StartAction: "log",
    Metadata: {
      entryPointPosition: { x: 20, y: 20 },
      name: flowName,
      description: "ARIA · saliente con ruteo por atributo (generado desde Configuración → Ruteo).",
      type: "contactFlow",
      status: "PUBLISHED",
      ActionMetadata,
    },
    Actions: actions,
  };
}

const DEFAULT_GREETING = "¡Hola! Gracias por comunicarte. En un momento te atiende un asesor. 🙌";
const DEFAULT_BUSY = "En este momento todos nuestros asesores están ocupados. Por favor intentá más tarde. Gracias.";
const DEFAULT_FAREWELL = "👋 ¡Gracias por escribirnos! Esperamos haberte ayudado. ¡Que tengas un excelente día! ✨";

/** Cola "principal" del tenant: la default (BasicQueue) o la primera STANDARD. */
async function resolveDefaultQueue(client: ConnectClient, instanceId: string, preferredId?: string): Promise<{ id: string; name: string } | null> {
  let token: string | undefined;
  const all: { id: string; name: string }[] = [];
  do {
    const r = await client.send(new ListQueuesCommand({ InstanceId: instanceId, QueueTypes: ["STANDARD"], NextToken: token, MaxResults: 100 }));
    for (const q of r.QueueSummaryList || []) if (q.Id && q.Name) all.push({ id: q.Id, name: q.Name });
    token = r.NextToken;
  } while (token);
  if (all.length === 0) return null;
  // La cola que el admin eligió como PRINCIPAL (Configuración → Colas) gana.
  if (preferredId) {
    const m = all.find((q) => q.id === preferredId);
    if (m) return m;
  }
  return all.find((q) => q.name === "BasicQueue") || all.find((q) => /basic|principal|general|ventas|main/i.test(q.name)) || all[0];
}

/** name → contactFlowId de los flows existentes (para decidir create vs update). */
async function existingFlows(client: ConnectClient, instanceId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let token: string | undefined;
  do {
    const r = await client.send(new ListContactFlowsCommand({ InstanceId: instanceId, NextToken: token, MaxResults: 100 }));
    for (const f of r.ContactFlowSummaryList || []) if (f.Name && f.Id) map.set(f.Name, f.Id);
    token = r.NextToken;
  } while (token);
  return map;
}

export const handler = async (event: FnEvent) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "POST";
  if (method === "OPTIONS") return resp(200, {});

  // Auth: JWT válido + Admin de la org. El tenantId SALE del token, nunca del body.
  let identity;
  try {
    identity = await getIdentity(event.headers);
  } catch {
    return resp(401, { error: "Token inválido" });
  }
  if (!identity || !identity.tenantId) return resp(401, { error: "No autorizado" });
  if (!identity.groups.includes("Admins")) return resp(403, { error: "Solo administradores pueden provisionar flows" });
  const tenantId = identity.tenantId;

  let body: {
    dryRun?: boolean;
    defaultQueueId?: string;
    action?: string;
    attribute?: string;
    rules?: { value: string; queueId: string }[];
    flowName?: string;
  } = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    /* default dryRun=false */
  }
  const dryRun = body.dryRun !== false; // por seguridad, default DRY RUN salvo que pidan explícito false

  // Connect del tenant (cross-account). null = no configuró Connect todavía.
  const tc = await getTenantConnect(tenantId);
  if (!tc) {
    return resp(409, { error: "El tenant no tiene Amazon Connect configurado. Conectá tu instancia primero (Integraciones → Connect)." });
  }
  const client = tc.client;
  const instanceId = tc.instanceId;

  // ── Ruteo inteligente: genera/actualiza ARIA-Outbound-Smart desde las reglas
  //    (atributo del lead → cola). Lo usan las campañas para distribuir por
  //    atributo (ej. programa=1→Cola A, 2→Cola B, 3→Cola C). ──
  if (body.action === "smartFlow") {
    const attribute = String(body.attribute || "").trim();
    const rules = (Array.isArray(body.rules) ? body.rules : [])
      .map((r) => ({ value: String(r?.value ?? "").trim(), queueId: String(r?.queueId ?? "") }))
      .filter((r) => r.value && r.queueId);
    const defaultQueueId = String(body.defaultQueueId || "");
    const flowName = String(body.flowName || "ARIA-Outbound-Smart").trim() || "ARIA-Outbound-Smart";
    if (!attribute || rules.length === 0 || !defaultQueueId) {
      return resp(400, { error: "Se requieren el atributo, al menos una regla (valor → cola) y la cola por defecto." });
    }
    try {
      const content = JSON.stringify(buildSmartOutboundFlow(attribute, rules, defaultQueueId, flowName));
      const existing = await existingFlows(client, instanceId);
      let flowId = existing.get(flowName);
      let act: "created" | "updated";
      if (flowId) {
        await client.send(new UpdateContactFlowContentCommand({ InstanceId: instanceId, ContactFlowId: flowId, Content: content }));
        act = "updated";
      } else {
        const c = await client.send(new CreateContactFlowCommand({ InstanceId: instanceId, Name: flowName, Type: "CONTACT_FLOW", Content: content, Description: "ARIA · ruteo por atributo (generado)" }));
        flowId = c.ContactFlowId || "";
        act = "created";
      }
      try {
        const rr = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: { tenantId: { S: tenantId } } }));
        const cfg = rr.Item?.configJson?.S ? JSON.parse(rr.Item.configJson.S) : {};
        cfg.routingRules = { attribute, rules, defaultQueueId, flowId, flowName, updatedAt: new Date().toISOString() };
        await ddb.send(new PutItemCommand({ TableName: TABLE, Item: { tenantId: { S: tenantId }, configJson: { S: JSON.stringify(cfg) }, updatedAt: { S: new Date().toISOString() } } }));
      } catch (e) {
        console.error("guardar routingRules falló:", e);
      }
      return resp(200, { ok: true, flowId, flowName, action: act, rulesCount: rules.length });
    } catch (e) {
      return resp(500, { error: e instanceof Error ? e.message : "error" });
    }
  }

  try {
    // Config del tenant (una sola lectura): textos + cola principal elegida.
    let farewell = DEFAULT_FAREWELL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let storedCfg: any = {};
    try {
      const r = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: { tenantId: { S: tenantId } } }));
      storedCfg = r.Item?.configJson?.S ? JSON.parse(r.Item.configJson.S) : {};
      const f = (storedCfg?.messaging?.chatFarewell || "").trim();
      if (f) farewell = f;
    } catch {
      /* genéricos */
    }

    // Cola que rutean los flows: la del body (el admin la acaba de elegir) >
    // la guardada en config > auto (BasicQueue). Así "Marcar como principal"
    // en Configuración → Colas re-rutea el ARIA-Outbound a esa cola.
    const preferredQueueId = body.defaultQueueId || storedCfg?.connect?.defaultQueueId;
    const queue = await resolveDefaultQueue(client, instanceId, preferredQueueId);
    if (!queue) {
      return resp(409, { error: "No se encontró ninguna cola (STANDARD) en tu instancia de Connect. Creá al menos una cola antes de provisionar los flows." });
    }

    const templates = [
      { name: "ARIA-Disconnect", content: buildDisconnectFlow(farewell) },
      { name: "ARIA-Inbound", content: buildInboundFlow(queue.id, DEFAULT_GREETING, DEFAULT_BUSY) },
      { name: "ARIA-Outbound", content: buildOutboundFlow(queue.id) },
    ];

    if (dryRun) {
      return resp(200, {
        dryRun: true,
        tenantId,
        instanceId,
        resolvedQueue: queue,
        flows: templates.map((t) => ({ name: t.name, actions: (t.content as { Actions?: unknown[] }).Actions?.length || 0, contentPreview: JSON.stringify(t.content).slice(0, 240) })),
        note: "dryRun: nada creado. Reenviá con { dryRun:false } para crear/actualizar.",
      });
    }

    // Crear o actualizar cada flow.
    const existing = await existingFlows(client, instanceId);
    const result: Record<string, { id: string; action: "created" | "updated" }> = {};
    for (const t of templates) {
      const content = JSON.stringify(t.content);
      const existingId = existing.get(t.name);
      if (existingId) {
        await client.send(new UpdateContactFlowContentCommand({ InstanceId: instanceId, ContactFlowId: existingId, Content: content }));
        result[t.name] = { id: existingId, action: "updated" };
      } else {
        const c = await client.send(new CreateContactFlowCommand({ InstanceId: instanceId, Name: t.name, Type: "CONTACT_FLOW", Content: content, Description: "Provisionado por ARIA" }));
        result[t.name] = { id: c.ContactFlowId || "", action: "created" };
      }
    }

    // Guardar en la config del tenant: ids de los flows + la cola principal
    // resuelta (para que el front la muestre y las próximas provisión la respeten).
    try {
      storedCfg.contactFlows = {
        inboundId: result["ARIA-Inbound"]?.id,
        outboundId: result["ARIA-Outbound"]?.id,
        disconnectId: result["ARIA-Disconnect"]?.id,
        provisionedAt: new Date().toISOString(),
      };
      storedCfg.connect = {
        ...(storedCfg.connect || {}),
        defaultQueueId: queue.id,
        defaultQueueName: queue.name,
      };
      await ddb.send(new PutItemCommand({ TableName: TABLE, Item: { tenantId: { S: tenantId }, configJson: { S: JSON.stringify(storedCfg) }, updatedAt: { S: new Date().toISOString() } } }));
    } catch (e) {
      console.error("guardar contactFlows/cola en config falló:", e);
    }

    return resp(200, { ok: true, tenantId, instanceId, resolvedQueue: queue, flows: result });
  } catch (e) {
    console.error("provision-contact-flows error:", e);
    return resp(500, { error: e instanceof Error ? e.message : "error" });
  }
};
