import type { EventBridgeHandler } from "aws-lambda";
import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
  QueryCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  ConnectClient,
  DescribeUserCommand,
  DescribeContactCommand,
  DescribeQueueCommand,
} from "@aws-sdk/client-connect";
import { upsertCachedContact } from "../_shared/recordingsCache";
import { kickDialer } from "../_shared/invokeDialer";
import { planLeadStamp } from "../_shared/leadStamp";

// BYO Data Plane (#46): module-active. TODO: para multi-tenant real, hacer
// reverse lookup instanceArn (del evento) → tenantId vía connectview-connections.
// Por ahora legacy fallback funciona para Novasys.
const legacyDynamo = new DynamoDBClient({});
const dynamo: DynamoDBClient = legacyDynamo;
const lambda = new LambdaClient({});
const legacyConnect = new ConnectClient({ maxAttempts: 1 });
const connect: ConnectClient = legacyConnect;
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "";
const ENRICH_FUNCTION_NAME = process.env.ENRICH_FUNCTION_NAME || "";
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CAMPAIGN_CONTACTS_TABLE =
  process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
// Estampado del agente sobre el lead (Pipeline de /reports). Defaults en código
// para que un deploy por deploy-lambda.mjs (que NO toca env vars) funcione igual;
// backend.ts también los setea para el deploy Amplify (sin drift).
const LEADS_TABLE = process.env.LEADS_TABLE || "connectview-leads";
const LEADS_PHONE_INDEX = process.env.LEADS_PHONE_INDEX || "phone-index";

// Username cache (Lambda warm container scope). Maps user UUID → username.
// DescribeUser is cheap but we still cache to avoid calling it for every
// CONNECTED_TO_AGENT event when the same agent takes back-to-back calls.
const usernameCache = new Map<string, string>();

async function resolveUsername(userId: string): Promise<string> {
  if (!userId) return "";
  const cached = usernameCache.get(userId);
  if (cached) return cached;
  if (!CONNECT_INSTANCE_ID) return userId;
  try {
    const res = await connect.send(
      new DescribeUserCommand({
        InstanceId: CONNECT_INSTANCE_ID,
        UserId: userId,
      }),
    );
    const username = res.User?.Username || userId;
    usernameCache.set(userId, username);
    return username;
  } catch (err) {
    console.warn("DescribeUser failed for", userId, err);
    return userId;
  }
}

function deriveSub(
  channel: string,
  initiationMethod?: string,
  endpointType?: string,
): string | undefined {
  if (channel !== "CHAT") return undefined;
  if (initiationMethod === "API") return "Messaging API";
  if (initiationMethod === "MESSAGING_PLATFORM")
    return endpointType === "PHONE_NUMBER" || endpointType === "TELEPHONE_NUMBER"
      ? "WhatsApp/SMS"
      : "Messaging";
  if (initiationMethod === "EXTERNAL_OUTBOUND") return "Outbound";
  return undefined;
}

const MATERIALIZE_CHANNELS = new Set(["VOICE", "TELEPHONY", "CHAT", "EMAIL"]);
const mUserCache = new Map<string, string>();
const mQueueCache = new Map<string, string>();

/**
 * Materialización por eventos (#perf Nivel 3 Fase 2): al cerrarse un contacto,
 * lo escribimos directo al caché del historial de Grabaciones (DynamoDB) — así
 * aparece al instante, sin esperar a Customer Profiles. El instanceId se deriva
 * del evento (el Lambda no tiene CONNECT_INSTANCE_ID). Best-effort: si algo
 * falla, NO interrumpe el resto del procesamiento del evento.
 */
async function materializeContact(contactId: string, instanceId: string): Promise<void> {
  if (!contactId || !instanceId) return;
  try {
    const desc = await connect.send(
      new DescribeContactCommand({ InstanceId: instanceId, ContactId: contactId }),
    );
    const c = desc.Contact;
    const phone = c?.CustomerEndpoint?.Address;
    const channel = String(c?.Channel || "").toUpperCase();
    if (!c || !phone || !MATERIALIZE_CHANNELS.has(channel)) return;
    const agentId = c.AgentInfo?.Id || "";
    const queueId = c.QueueInfo?.Id || "";
    let agentUsername = (agentId && mUserCache.get(agentId)) || "";
    if (agentId && !agentUsername) {
      try {
        const u = await connect.send(
          new DescribeUserCommand({ InstanceId: instanceId, UserId: agentId }),
        );
        agentUsername = u.User?.Username || "";
        if (agentUsername) mUserCache.set(agentId, agentUsername);
      } catch {
        /* ignore */
      }
    }
    let queueName = (queueId && mQueueCache.get(queueId)) || "";
    if (queueId && !queueName) {
      try {
        const q = await connect.send(
          new DescribeQueueCommand({ InstanceId: instanceId, QueueId: queueId }),
        );
        queueName = q.Queue?.Name || "";
        if (queueName) mQueueCache.set(queueId, queueName);
      } catch {
        /* ignore */
      }
    }
    const initMs = c.InitiationTimestamp?.getTime() || 0;
    const discMs = c.DisconnectTimestamp?.getTime() || 0;
    await upsertCachedContact(instanceId, phone, {
      contactId,
      channel,
      subChannel: deriveSub(channel, c.InitiationMethod, c.CustomerEndpoint?.Type),
      initiationTimestamp: c.InitiationTimestamp?.toISOString() || "",
      disconnectTimestamp: c.DisconnectTimestamp?.toISOString() || "",
      duration: initMs && discMs ? Math.max(0, Math.round((discMs - initMs) / 1000)) : 0,
      agentUsername,
      queueName,
      initiationMethod: c.InitiationMethod,
      disconnectReason: c.DisconnectReason,
      customerEndpoint: phone,
      hasRecording: (c.Recordings?.length || 0) > 0,
    });
    // Estampado en tiempo real del agente de Connect sobre el lead que comparte
    // teléfono (Pipeline de /reports · "quién atendió la llamada"). Reusa el phone
    // + agentUsername ya resueltos de este DescribeContact. Best-effort propio: no
    // bloquea el caché de Grabaciones ni el procesamiento del evento.
    await stampCallAgentOnLead(phone, agentUsername);
  } catch (err) {
    console.warn("materializeContact failed:", (err as Error)?.message || err);
  }
}

/**
 * Escribe el agente de Connect que atendió la llamada sobre el lead del mismo
 * teléfono (connectview-leads.assignedAgent), que el tab Pipeline de /reports lee
 * como fallback de "agente" (report=typifications: `typ?.agent || l.assignedAgent`).
 *
 * · Busca el lead por teléfono vía el GSI `phone-index` (E.164 y dígitos, para
 *   tolerar "+51999…" vs "51999…"). Sin GSI esto sería un scan de toda la tabla.
 * · UpdateItem condicional: solo escribe si el lead existe y el agente CAMBIA
 *   (anti-churn — un mismo agente que vuelve a llamar no reescribe ni flota el
 *   lead). Bumpea updatedAt como cualquier otro toque.
 * · NO es retroactivo: solo se llena con llamadas nuevas. Si no hay lead con ese
 *   teléfono (aún no importado), no hace nada. TODO best-effort: cualquier fallo
 *   se loguea y se traga (no romper el procesamiento del evento de contacto).
 */
async function stampCallAgentOnLead(phone: string, agentUsername: string): Promise<void> {
  const plan = planLeadStamp({ phone, agentUsername });
  if (!plan) return;
  try {
    let leadId = "";
    for (const cand of plan.phoneCandidates) {
      const res = await dynamo.send(
        new QueryCommand({
          TableName: LEADS_TABLE,
          IndexName: LEADS_PHONE_INDEX,
          KeyConditionExpression: "#ph = :p",
          ExpressionAttributeNames: { "#ph": "phone" },
          ExpressionAttributeValues: { ":p": { S: cand } },
          Limit: 1,
        }),
      );
      const hit = res.Items?.[0];
      if (hit?.leadId?.S) {
        leadId = hit.leadId.S;
        break;
      }
    }
    if (!leadId) return; // ningún lead con ese teléfono → nada que estampar
    await dynamo.send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: { S: leadId } },
        UpdateExpression: "SET assignedAgent = :a, updatedAt = :now",
        ConditionExpression:
          "attribute_exists(leadId) AND (attribute_not_exists(assignedAgent) OR assignedAgent <> :a)",
        ExpressionAttributeValues: {
          ":a": { S: plan.agent },
          ":now": { S: new Date().toISOString() },
        },
      }),
    );
    console.log(`[stamp] lead ${leadId} assignedAgent → ${plan.agent}`);
  } catch (err) {
    // El agente ya estaba estampado (condición falló) → no-op esperado.
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") return;
    console.warn("stampCallAgentOnLead failed:", (err as Error)?.message || err);
  }
}

interface ConnectContactEvent {
  detail: {
    contactId: string;
    channel: string;
    instanceArn: string;
    initiationMethod: string;
    eventType: string;
    agentInfo?: {
      agentArn: string;
    };
    queueInfo?: {
      queueArn: string;
    };
    initiationTimestamp?: string;
    disconnectTimestamp?: string;
    disconnectReason?: string;
  };
}

// Find the campaign-contact row linked to this Connect contactId, if any.
async function findCampaignContact(contactId: string): Promise<{
  campaignId: string;
  rowId: string;
  attempts: number;
  status: string;
  connectedAt?: string;
} | null> {
  try {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: CAMPAIGN_CONTACTS_TABLE,
        IndexName: "connectContactId-index",
        KeyConditionExpression: "connectContactId = :cid",
        ExpressionAttributeValues: { ":cid": { S: contactId } },
        Limit: 1,
      }),
    );
    const first = res.Items?.[0];
    if (!first) return null;
    const row = unmarshall(first);
    return {
      campaignId: row.campaignId as string,
      rowId: row.rowId as string,
      attempts: Number(row.attempts || 0),
      status: row.status as string,
      connectedAt: row.connectedAt as string | undefined,
    };
  } catch (err) {
    console.warn("findCampaignContact failed:", err);
    return null;
  }
}

// Classify the disconnect into our campaign contact status.
// `callDurationSec` is the gap between agent connection and disconnect.
// If the agent connected but the customer hung up within a few seconds
// (voicemail, rejection, no answer), we classify as no_answer even though
// technically the agent "got" the contact.
function classifyDisconnect(
  reason: string | undefined,
  previousStatus: string,
  callDurationSec: number | null,
): "done" | "no_answer" | "failed" {
  const r = (reason || "").toUpperCase();

  // Explicit no-answer reasons — always no_answer.
  if (
    r === "CUSTOMER_MISSED_CALL" ||
    r === "TELECOM_PROBLEM" ||
    r === "CALL_ABANDONED" ||
    r.includes("MISSED") ||
    r.includes("ABANDONED") ||
    r.includes("OUTBOUND_RING_TIME_EXCEEDED")
  ) {
    return "no_answer";
  }

  // Connected-to-agent, but very short call: likely voicemail or customer rejected.
  if (previousStatus === "connected" && callDurationSec !== null && callDurationSec < 10) {
    return "no_answer";
  }

  if (previousStatus === "connected") return "done";

  // At this point: the agent never actually picked up.
  // For campaigns, that's almost always "customer didn't answer" regardless of
  // the specific reason (CUSTOMER_DISCONNECT, AGENT_DISCONNECT, UNKNOWN, etc).
  // Only explicit errors caught earlier in the dial path should mark "failed".
  return "no_answer";
}

async function updateCampaignContactStatus(
  link: { campaignId: string; rowId: string; attempts: number; status: string },
  newStatus: string,
  extra: Record<string, string | number> = {},
): Promise<void> {
  const setParts: string[] = ["#st = :new"];
  const exprVals: Record<string, { S?: string; N?: string }> = {
    ":new": { S: newStatus },
  };
  const exprNames: Record<string, string> = { "#st": "status" };

  for (const [k, v] of Object.entries(extra)) {
    setParts.push(`${k} = :${k}`);
    if (typeof v === "number") exprVals[`:${k}`] = { N: String(v) };
    else exprVals[`:${k}`] = { S: v };
  }

  await dynamo.send(
    new UpdateItemCommand({
      TableName: CAMPAIGN_CONTACTS_TABLE,
      Key: {
        campaignId: { S: link.campaignId },
        rowId: { S: link.rowId },
      },
      UpdateExpression: "SET " + setParts.join(", "),
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprVals,
    }),
  );
}

/**
 * Reintento automático del no_answer. La config de la campaña
 * (retryNoAnswerMinutes / retryMaxAttempts) se guardaba desde la creación pero
 * NINGÚN consumidor la usaba: los no_answer quedaban terminales en 1 intento.
 * Aquí se cierra el circuito: si la campaña sigue viva y quedan intentos, el
 * contacto vuelve a `pending` con `nextRetryAt` futuro — TODOS los queries de
 * pending del dialer (bucket + legacy) ya filtran `nextRetryAt <= now`, así que
 * lo retoman solos en el tick correspondiente. Además se le quita
 * `assignedAgentUserId`: vuelve al pool común y se reparte al primer agente con
 * hueco en vez de re-concentrarse en el mismo. Devuelve true si re-encoló.
 */
async function maybeScheduleRetry(
  link: { campaignId: string; rowId: string; attempts: number; status: string },
  extra: Record<string, string | number>,
): Promise<boolean> {
  try {
    const got = await dynamo.send(
      new GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: link.campaignId } },
        ProjectionExpression: "#st, retryNoAnswerMinutes, retryMaxAttempts",
        ExpressionAttributeNames: { "#st": "status" },
      }),
    );
    if (!got.Item) return false;
    const camp = unmarshall(got.Item) as {
      status?: string;
      retryNoAnswerMinutes?: number;
      retryMaxAttempts?: number;
    };
    // Solo campañas vivas: en COMPLETED/STOPPED el retry quedaría huérfano (el
    // dialer solo tickea RUNNING) y cambiaría las stats de una campaña cerrada.
    if (camp.status !== "RUNNING" && camp.status !== "PAUSED") return false;
    const minutes = Number(camp.retryNoAnswerMinutes ?? 0);
    const maxAttempts = Number(camp.retryMaxAttempts ?? 0);
    if (minutes <= 0 || maxAttempts <= 0) return false;
    // `attempts` YA incluye este intento (markAsDialing hace attempts+1 al marcar).
    if (link.attempts >= maxAttempts) return false;

    const nextRetryAt = new Date(Date.now() + minutes * 60_000).toISOString();
    const setParts = ["#st = :p", "nextRetryAt = :nra"];
    const vals: Record<string, { S?: string; N?: string }> = {
      ":p": { S: "pending" },
      ":nra": { S: nextRetryAt },
      ":prev": { S: link.status },
    };
    for (const [k, v] of Object.entries(extra)) {
      setParts.push(`${k} = :${k}`);
      vals[`:${k}`] = typeof v === "number" ? { N: String(v) } : { S: String(v) };
    }
    // Condición sobre el status previo: si otro evento ya movió la fila, no pisamos.
    await dynamo.send(
      new UpdateItemCommand({
        TableName: CAMPAIGN_CONTACTS_TABLE,
        Key: { campaignId: { S: link.campaignId }, rowId: { S: link.rowId } },
        UpdateExpression: `SET ${setParts.join(", ")} REMOVE assignedAgentUserId`,
        ConditionExpression: "#st = :prev",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: vals,
      }),
    );
    await updateCampaignCounters(link.campaignId, "pending", link.status);
    console.log(
      `[retry] ${link.campaignId}/${link.rowId}: no_answer → pending (intento ${link.attempts}/${maxAttempts}, próximo ${nextRetryAt})`,
    );
    return true;
  } catch (err) {
    // ConditionalCheckFailed → otro evento ganó la carrera (la fila ya no está en
    // el status previo): no tocar. Cualquier otro error → dejar el no_answer
    // terminal (no perder la clasificación por un retry fallido).
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") return true;
    console.warn("maybeScheduleRetry falló, dejando no_answer terminal:", err);
    return false;
  }
}

// Bump the aggregate counters on the campaign row. Best-effort; authoritative counts
// come from Query on the contacts GSI.
async function updateCampaignCounters(
  campaignId: string,
  newStatus: string,
  previousStatus: string,
): Promise<void> {
  const counterInc: Record<string, number> = {};
  const counterDec: Record<string, number> = {};

  const statusToCounter: Record<string, string> = {
    pending: "pendingCount",
    dialing: "dialingCount",
    connected: "connectedCount",
    done: "doneCount",
    no_answer: "noAnswerCount",
    failed: "failedCount",
  };
  const incKey = statusToCounter[newStatus];
  const decKey = statusToCounter[previousStatus];
  if (incKey) counterInc[incKey] = 1;
  if (decKey && decKey !== incKey) counterDec[decKey] = 1;

  const allOps = { ...counterInc };
  for (const k of Object.keys(counterDec)) allOps[k] = -1;

  if (Object.keys(allOps).length === 0) return;

  const addParts = Object.entries(allOps).map(([key], i) => `${key} :v${i}`);
  const exprVals: Record<string, { N: string }> = {};
  Object.entries(allOps).forEach(([, val], i) => {
    exprVals[`:v${i}`] = { N: String(val) };
  });

  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
        UpdateExpression: "ADD " + addParts.join(", "),
        ExpressionAttributeValues: exprVals,
      }),
    );
  } catch (err) {
    console.warn("updateCampaignCounters failed:", err);
  }
}

export const handler: EventBridgeHandler<
  "Amazon Connect Contact Event",
  ConnectContactEvent["detail"],
  void
> = async (event) => {
  const detail = event.detail;
  const contactId = detail.contactId;
  const eventType = detail.eventType;

  try {
    // ── 1. Main contacts table (analytics) ─────────────────────────────
    // Skip the Put entirely if we don't have an agent yet — the GSI
    // (agentUsername-initiationTimestamp) rejects empty-string keys, and an
    // analytics row without an agent isn't useful. We'll get a CONNECTED_TO_AGENT
    // event later when the agent picks up, at which point we insert the row.
    if (eventType === "INITIATED" || eventType === "CONNECTED_TO_AGENT") {
      const agentId = detail.agentInfo?.agentArn?.split("/").pop() || "";
      // Same resolve as the campaign-contact write below — keeps both
      // analytics and campaign tables consistent in their username field.
      const agentName = agentId ? await resolveUsername(agentId) : "";
      const queueName = detail.queueInfo?.queueArn?.split("/").pop() || "";
      if (agentName) {
        try {
          await dynamo.send(
            new PutItemCommand({
              TableName: TABLE_NAME,
              Item: {
                contactId: { S: contactId },
                initiationTimestamp: {
                  S: detail.initiationTimestamp || new Date().toISOString(),
                },
                channel: { S: detail.channel || "VOICE" },
                agentUsername: { S: agentName },
                queueName: { S: queueName || "unknown" },
                initiationMethod: { S: detail.initiationMethod || "" },
                status: { S: "ACTIVE" },
              },
              ConditionExpression: "attribute_not_exists(contactId)",
            }),
          );
        } catch (err) {
          if (!(err instanceof Error) || err.name !== "ConditionalCheckFailedException") {
            // Don't rethrow — failing analytics shouldn't block campaign updates (step 2)
            console.warn("analytics table Put failed, continuing:", err);
          }
        }
      }
    } else if (eventType === "DISCONNECTED" || eventType === "CONTACT_END") {
      // Only update analytics row if it exists — avoids failures for contacts
      // we never inserted (e.g. outbound before CONNECTED_TO_AGENT).
      try {
        await dynamo.send(
          new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: { contactId: { S: contactId } },
            UpdateExpression:
              "SET #status = :status, disconnectTimestamp = :dt, disconnectReason = :dr",
            ConditionExpression: "attribute_exists(contactId)",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":status": { S: "COMPLETED" },
              ":dt": {
                S: detail.disconnectTimestamp || new Date().toISOString(),
              },
              ":dr": { S: detail.disconnectReason || "UNKNOWN" },
            },
          }),
        );
        if (ENRICH_FUNCTION_NAME) {
          await lambda.send(
            new InvokeCommand({
              FunctionName: ENRICH_FUNCTION_NAME,
              InvocationType: "Event",
              Payload: Buffer.from(
                JSON.stringify({
                  contactId,
                  instanceId: detail.instanceArn?.split("/").pop() || "",
                }),
              ),
            }),
          );
        }
      } catch (err) {
        if (!(err instanceof Error) || err.name !== "ConditionalCheckFailedException") {
          console.warn("analytics table Update failed, continuing:", err);
        }
      }
      // Materializá el contacto al caché de Grabaciones (#perf Nivel 3 Fase 2) —
      // aparece al instante sin esperar a Customer Profiles. Best-effort.
      // BUG: faltaba el instanceId → el guard `if (!instanceId) return` lo volvía
      // un no-op silencioso (nunca cacheaba). Se pasa el mismo que usa el enrich.
      await materializeContact(contactId, detail.instanceArn?.split("/").pop() || "");
    }

    // ── 2. Campaign-contact link (if this contact belongs to a campaign) ─
    const link = await findCampaignContact(contactId);
    if (!link) return;

    if (eventType === "CONNECTED_TO_AGENT") {
      const agentId = detail.agentInfo?.agentArn?.split("/").pop() || "";
      // Resolve the UUID to the actual username so the campaign detail
      // table doesn't show raw IDs to the admin. Falls back to the UUID
      // if DescribeUser fails (cached after first call per warm Lambda).
      const username = await resolveUsername(agentId);
      await updateCampaignContactStatus(link, "connected", {
        agentUsername: username,
        connectedAt: new Date().toISOString(),
      });
      await updateCampaignCounters(link.campaignId, "connected", link.status);
    } else if (eventType === "DISCONNECTED" || eventType === "CONTACT_END") {
      // Compute call duration (seconds between agent-connected and now) so we
      // can distinguish a real conversation from a quick voicemail / rejection.
      let callDurationSec: number | null = null;
      if (link.connectedAt) {
        const disc = detail.disconnectTimestamp
          ? Date.parse(detail.disconnectTimestamp)
          : Date.now();
        const conn = Date.parse(link.connectedAt);
        if (!isNaN(conn) && !isNaN(disc)) {
          callDurationSec = Math.max(0, Math.round((disc - conn) / 1000));
        }
      }

      const newStatus = classifyDisconnect(detail.disconnectReason, link.status, callDurationSec);
      const extra = {
        disconnectReason: detail.disconnectReason || "UNKNOWN",
        disconnectedAt: new Date().toISOString(),
        callDurationSec: callDurationSec ?? 0,
      };
      // Reintento automático del no_answer (config de la campaña, antes huérfana):
      // re-encola como pending con nextRetryAt futuro. Si re-encoló, terminamos.
      if (newStatus === "no_answer" && (await maybeScheduleRetry(link, extra))) {
        // La llamada terminó → el agente quedó libre. Kick al dialer para que
        // marque el siguiente pendiente YA (no en el próximo sub-tick ≤6-12s).
        await kickDialer();
        return;
      }
      await updateCampaignContactStatus(link, newStatus, extra);
      await updateCampaignCounters(link.campaignId, newStatus, link.status);
      // Idem: agente liberado → siguiente marcado inmediato. Best-effort.
      await kickDialer();
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      return;
    }
    console.error("Error processing contact event:", error);
    throw error;
  }
};
