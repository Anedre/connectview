import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ConnectClient,
  StartOutboundVoiceContactCommand,
  GetCurrentUserDataCommand,
  ListUsersCommand,
} from "@aws-sdk/client-connect";
import { getTenantConnect } from "../_shared/tenantConnect";
import { maskPhone } from "../_shared/maskPhone";
import { evaluateSend } from "../_shared/suppression";
import { applyAutoAccept } from "../_shared/campaignAutoAccept";
import {
  isWithinSchedule,
  isScheduleDue,
  isScheduleExpired,
  describeWindow,
  describeSchedule,
  scheduleFromWindow,
  type WeeklySchedule,
} from "../_shared/callWindow";
import { fetchConnectSchedule, parseScheduleSnapshot } from "../_shared/connectHours";

// BYO Data Plane (#46): DDB module-active igual que Connect. Se resetea por
// campaña usando getTenantConnect(campaign.tenantId).dynamo. Lambda procesa
// un evento a la vez por contenedor → seguro.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const legacyConnect = new ConnectClient({ maxAttempts: 1 });
// Module-active: se resetean al inicio de procesar CADA campaña a partir del
// tenantId guardado en el registro de la campaña. Las campañas se procesan
// serialmente en dialCycle() → seguro pasar de un tenant a otro vía estas vars.
let activeConnect = legacyConnect;
let activeInstanceId = "";
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
// Pilar 7 — el pool global de marcación por tenant vive en la config de
// conexiones (orchestration.maxConcurrentDials). Pooled siempre legacyDynamo.
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "connectview-connections";
const CAMPAIGN_AGENTS_TABLE = process.env.CAMPAIGN_AGENTS_TABLE || "connectview-campaign-agents";
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
// Setear activeInstanceId al legacy en boot para no romper el primer tick si
// no hay campañas tenant-scoped todavía.
activeInstanceId = INSTANCE_ID;
// AMD-aware flow that runs CheckOutboundCallStatus FIRST so voicemails/no-answer
// are hung up before reaching an agent. When present, every outbound dial uses
// this flow (AMD is not free — AWS bills per-call — but it is worth it here).
// If unset or empty, falls back to the admin-selected contact flow per campaign.
const AMD_FLOW_ID = process.env.AMD_FLOW_ID || "";
// Turn AMD on or off globally. Defaults to "true" because the whole reason for
// this dialer is filtering out voicemails before the agent picks up.
const AMD_ENABLED = (process.env.AMD_ENABLED ?? "true").toLowerCase() !== "false";

interface Campaign {
  campaignId: string;
  /** Organización que dueña de esta campaña. La asume create-campaign del JWT
   *  del usuario que la creó. El dialer la usa para resolver el Connect del
   *  cliente (assume-role cross-account). Vacío / "default" → cae al Connect
   *  legacy de Vox (transición). */
  tenantId?: string;
  name: string;
  status: string;
  sourcePhoneNumber: string;
  contactFlowId: string;
  dialMode: string;
  concurrency: number;
  timezone: string;
  windowStartHour: number;
  windowEndHour: number;
  windowDaysOfWeek: string; // JSON string of number[]
  retryNoAnswerMinutes: number;
  retryMaxAttempts: number;
  /** How many contacts each Available agent gets in their pre-assigned
   *  bucket. The dialer fills these buckets in advance so the agent has a
   *  predictable queue, and only dials one at a time per agent (the next
   *  pending in their bucket). Defaults to 5. */
  maxContactsPerAgent?: number;
  /** "voice" (default — existing StartOutboundVoiceContact path) or
   *  "whatsapp" (sends a Meta-approved template per lead). When
   *  "whatsapp" the dialer dispatches to send-whatsapp-template and
   *  the voice-specific fields (sourcePhone, dialMode, AMD) are
   *  ignored. */
  campaignType?: string;
  /** Meta template name for WhatsApp campaigns. Must match an APPROVED
   *  template in the connected WABA. */
  templateName?: string;
  /** Template language code (e.g. "es", "en"). Defaults to "es". */
  templateLanguage?: string;
  /** CSV columns whose values fill the template's {{1}}, {{2}}, …
   *  placeholders in order. Stored as a JSON array of column names. */
  templateVarColumns?: string;
  // ── Pilar 7 · orquestación ────────────────────────────────────────────
  /** 1–10 (default 5). Mayor = se sirve primero cuando el pool no alcanza. */
  priority?: number;
  /** Peso relativo para el % del pool global (default 1). El 80/20 sale de aquí. */
  weight?: number;
  /** Meta de la campaña: "contacts" (contactados) | "conversions" | "none". */
  goalType?: string;
  goalTarget?: number;
  /** Contadores (mantenidos por process-contact-event / wrap-up). Para metas. */
  connectedCount?: number;
  conversionsCount?: number;
  // ── Control total (2026-07) ──────────────────────────────────────────
  /** Cola compartida de la campaña (fallback del ruteo dinámico del flow). */
  campaignQueueId?: string;
  /** "shared" (default) | "exclusive": exclusive rutea cada llamada a la cola
   *  PERSONAL del agente del bucket vía atributos que interpreta el flow
   *  ARIA-Outbound-Direct — nadie más puede contestarla. */
  agentRouting?: string;
  /** Conexión directa: sin saludo ni música de espera (flow directo). El
   *  dialer no lo lee (create/update-campaign ya fijaron contactFlowId al
   *  flow directo); tipado para consistencia del registro. */
  directConnect?: boolean;
  /** Aplicar auto-accept a los agentes asignados (lo gestionan
   *  control-campaign / assign-campaign-agents, no el dialer). */
  autoAccept?: boolean;
  // ── Programación con fecha y hora ────────────────────────────────────
  /** ISO UTC. Mientras el status es SCHEDULED, el momento en que la campaña
   *  debe pasar sola a RUNNING. Se limpia al promover. */
  scheduledStartAt?: string;
  /** ISO UTC. Fin de vigencia: al pasar esa fecha el dialer completa la
   *  campaña aunque queden contactos pendientes. */
  scheduledEndAt?: string;
  // ── Horario de atención desde Amazon Connect ─────────────────────────
  /** Id del Hours of Operation de Connect. Si está, MANDA sobre la ventana
   *  manual (windowStartHour/EndHour/DaysOfWeek). */
  hoursOfOperationId?: string;
  /** Nombre cacheado, solo para logs y UI. */
  hoursOfOperationName?: string;
  /** Copia del horario resuelto al guardarlo. Respaldo para cuando Connect no
   *  responde o al rol del tenant le falta DescribeHoursOfOperation. */
  hoursOfOperationSnapshot?: string;
}

interface CampaignContact {
  campaignId: string;
  rowId: string;
  phone: string;
  customerName: string;
  customAttributes: string; // JSON string
  status: string;
  attempts: number;
  nextRetryAt?: string;
  createdAt?: string;
  /** Timestamp (ISO) del último intento de marcado. Lo escribe markAsDialing al
   *  pasar la fila a `dialing`. Los reapers (WhatsApp y voz) lo usan como edad de
   *  la fila para decidir si está colgada. */
  lastAttemptAt?: string;
  /** When non-empty, the contact has been pre-assigned to that agent's
   *  bucket. The dialer will only route this contact to that specific
   *  agent — never to anyone else. */
  assignedAgentUserId?: string;
}

// La lógica de ventana horaria vive en ../_shared/callWindow (espejo de
// src/lib/callWindow.ts, que es lo que el front usa para pintar el banner y el
// visualizador de horario). No reimplementarla acá: cuando estuvo duplicada,
// el fix del bug de medianoche se aplicó solo de un lado.

async function listCampaignsByStatus(status: string): Promise<Campaign[]> {
  const res = await dynamo.send(
    new QueryCommand({
      TableName: CAMPAIGNS_TABLE,
      IndexName: "status-createdAt-index",
      KeyConditionExpression: "#st = :s",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: { ":s": { S: status } },
    }),
  );
  return (res.Items || []).map((it) => unmarshall(it) as Campaign);
}

async function listRunningCampaigns(): Promise<Campaign[]> {
  return listCampaignsByStatus("RUNNING");
}

/**
 * Horario de atención efectivo de una campaña, en cascada:
 *
 *   1. El Hours of Operation de Connect, leído en vivo (cacheado 5 min). Es la
 *      fuente de verdad del cliente: el mismo horario que usan sus colas.
 *   2. El snapshot guardado al elegirlo, si Connect no responde o al rol del
 *      tenant le falta `connect:DescribeHoursOfOperation`.
 *   3. La ventana manual de la campaña — el modelo viejo, que sigue siendo el
 *      de todas las campañas anteriores a esta función.
 *
 * Nunca lanza: cualquier fallo cae al escalón siguiente. Que una campaña deje
 * de marcar por un error de lectura sería peor que usar un horario algo viejo.
 */
async function resolveCampaignSchedule(campaign: Campaign): Promise<WeeklySchedule> {
  if (!campaign.hoursOfOperationId) return scheduleFromWindow(campaign);
  try {
    const tc = campaign.tenantId ? await getTenantConnect(campaign.tenantId) : null;
    const client = tc?.client || legacyConnect;
    const instanceId = tc?.instanceId || INSTANCE_ID;
    const live = await fetchConnectSchedule(client, instanceId, campaign.hoursOfOperationId);
    if (live) return live;
  } catch (err) {
    console.warn(`[dialer] ${campaign.campaignId}: fallo resolviendo el horario de Connect`, err);
  }
  const snapshot = parseScheduleSnapshot(campaign.hoursOfOperationSnapshot);
  if (snapshot) {
    console.log(
      `[dialer] ${campaign.campaignId}: usando el horario guardado (Connect no respondió)`,
    );
    return snapshot;
  }
  console.warn(
    `[dialer] ${campaign.campaignId}: sin horario de Connect ni copia guardada → ventana manual`,
  );
  return scheduleFromWindow(campaign);
}

/**
 * Promueve a RUNNING las campañas SCHEDULED cuyo `scheduledStartAt` ya venció.
 *
 * Se apoya en el tick de 1 minuto que ya existe — no hace falta un scheduler
 * nuevo ni un GSI nuevo. Las campañas en espera son pocas (decenas), así que
 * consultar el GSI por status y filtrar la fecha en memoria es más barato que
 * mantener un índice extra sobre `connectview-campaigns`.
 *
 * El UpdateItem lleva ConditionExpression sobre el status: si dos invocaciones
 * del dialer se solapan (no hay reserved-concurrency en los crons), solo una
 * gana la promoción y la otra recibe ConditionalCheckFailed y sigue de largo.
 *
 * OJO: la campaña arranca aunque esté fuera de su ventana horaria. Es
 * deliberado — pasa a RUNNING y el filtro de ventana la deja esperando el
 * primer horario hábil, que es lo que el admin espera al programarla un
 * domingo para el lunes.
 */
async function promoteScheduledCampaigns(): Promise<number> {
  let promoted = 0;
  let scheduled: Campaign[];
  try {
    scheduled = await listCampaignsByStatus("SCHEDULED");
  } catch (err) {
    console.error("[dialer] no se pudo listar campañas programadas", err);
    return 0;
  }
  const now = new Date();
  for (const campaign of scheduled) {
    const due = isScheduleDue(
      (campaign as Campaign & { scheduledStartAt?: string }).scheduledStartAt,
      now,
    );
    if (!due) continue;
    try {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: CAMPAIGNS_TABLE,
          Key: { campaignId: { S: campaign.campaignId } },
          UpdateExpression: "SET #st = :running, startedAt = :now, scheduledStartAt = :null",
          ConditionExpression: "#st = :scheduled",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: {
            ":running": { S: "RUNNING" },
            ":scheduled": { S: "SCHEDULED" },
            ":now": { S: now.toISOString() },
            ":null": { NULL: true },
          },
        }),
      );
      promoted++;
      console.log(
        `[dialer] campaña programada ${campaign.campaignId} (${campaign.name}) → RUNNING · ventana ${describeWindow(campaign)}`,
      );
    } catch (err) {
      const name = (err as { name?: string })?.name || "";
      if (name === "ConditionalCheckFailedException") {
        // Otra invocación la promovió primero. Normal, no es un error.
        continue;
      }
      console.error(`[dialer] no se pudo promover ${campaign.campaignId}`, err);
    }
  }
  return promoted;
}

async function countDialingForCampaign(campaignId: string): Promise<number> {
  const res = await dynamo.send(
    new QueryCommand({
      TableName: CONTACTS_TABLE,
      IndexName: "campaignId-status-index",
      KeyConditionExpression: "campaignId = :cid AND #st = :s",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":cid": { S: campaignId },
        ":s": { S: "dialing" },
      },
      Select: "COUNT",
    }),
  );
  return res.Count || 0;
}

async function findPendingContacts(campaignId: string, limit: number): Promise<CampaignContact[]> {
  const nowIso = new Date().toISOString();
  // Pending contacts whose nextRetryAt <= now (initial insert uses now, so all eligible)
  const res = await dynamo.send(
    new QueryCommand({
      TableName: CONTACTS_TABLE,
      IndexName: "campaignId-status-index",
      KeyConditionExpression: "campaignId = :cid AND #st = :s",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":cid": { S: campaignId },
        ":s": { S: "pending" },
        ":now": { S: nowIso },
      },
      FilterExpression: "attribute_not_exists(nextRetryAt) OR nextRetryAt <= :now",
      Limit: limit,
    }),
  );
  const items = (res.Items || []).map((it) => unmarshall(it) as CampaignContact);
  // Extra filter client-side because FilterExpression after Query limit may over-filter
  return items.filter((c) => !c.nextRetryAt || c.nextRetryAt <= nowIso);
}

/**
 * Cheap count of pending contacts for a campaign. Used by the self-chain
 * logic to decide whether there's still work to do. Returns 0 on error
 * (treated as "no work left" — safe default that just stops the chain).
 */
async function countPendingContacts(campaignId: string): Promise<number> {
  try {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: CONTACTS_TABLE,
        IndexName: "campaignId-status-index",
        KeyConditionExpression: "campaignId = :cid AND #st = :s",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":cid": { S: campaignId },
          ":s": { S: "pending" },
        },
        Select: "COUNT",
      }),
    );
    return res.Count || 0;
  } catch (err) {
    console.error("countPendingContacts error:", err);
    return 0;
  }
}

/**
 * Fetch every pending contact for the campaign (paginated). Used by the
 * per-agent-bucket logic to compute buckets and unassigned pool client-side.
 * Capped at 10 pages (~10k contacts) to bound the Lambda run time.
 */
async function listAllPendingForCampaign(campaignId: string): Promise<CampaignContact[]> {
  const nowIso = new Date().toISOString();
  const out: CampaignContact[] = [];
  let lastKey: Record<string, unknown> | undefined;
  for (let i = 0; i < 10; i++) {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: CONTACTS_TABLE,
        IndexName: "campaignId-status-index",
        KeyConditionExpression: "campaignId = :cid AND #st = :s",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":cid": { S: campaignId },
          ":s": { S: "pending" },
          ":now": { S: nowIso },
        },
        FilterExpression: "attribute_not_exists(nextRetryAt) OR nextRetryAt <= :now",
        ExclusiveStartKey: lastKey as never,
      }),
    );
    for (const it of res.Items || []) out.push(unmarshall(it) as CampaignContact);
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    if (!lastKey) break;
  }
  return out;
}

/**
 * Count contacts that are currently "in-flight" for a given agent — dialing
 * or connected. They occupy a slot in the agent's bucket so the bucket
 * refill calculation needs to include them.
 */
async function countAgentInFlight(campaignId: string, userId: string): Promise<number> {
  let total = 0;
  for (const status of ["dialing", "connected"]) {
    try {
      // COUNT + FilterExpression PAGINA obligatorio: DynamoDB filtra DESPUÉS de
      // leer ≤1MB por página, así que Count es solo de la primera página. Sin el
      // bucle de LastEvaluatedKey subestima los contactos en vuelo y el dialer
      // termina sobre-marcando (viola maxConcurrency/maxPerAgent).
      let lastKey: Record<string, unknown> | undefined;
      do {
        const res = await dynamo.send(
          new QueryCommand({
            TableName: CONTACTS_TABLE,
            IndexName: "campaignId-status-index",
            KeyConditionExpression: "campaignId = :cid AND #st = :s",
            ExpressionAttributeNames: { "#st": "status" },
            ExpressionAttributeValues: {
              ":cid": { S: campaignId },
              ":s": { S: status },
              ":uid": { S: userId },
            },
            FilterExpression: "assignedAgentUserId = :uid",
            Select: "COUNT",
            ExclusiveStartKey: lastKey as never,
          }),
        );
        total += res.Count || 0;
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);
    } catch (err) {
      console.warn("countAgentInFlight:", err);
    }
  }
  return total;
}

/**
 * Atomically mark an unassigned pending row as belonging to a specific agent.
 * Uses ConditionExpression to avoid races between concurrent dialer ticks.
 */
async function assignContactToAgent(contact: CampaignContact, userId: string): Promise<boolean> {
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: CONTACTS_TABLE,
        Key: {
          campaignId: { S: contact.campaignId },
          rowId: { S: contact.rowId },
        },
        UpdateExpression: "SET assignedAgentUserId = :uid",
        ConditionExpression:
          "attribute_not_exists(assignedAgentUserId) OR assignedAgentUserId = :empty",
        ExpressionAttributeValues: {
          ":uid": { S: userId },
          ":empty": { S: "" },
        },
      }),
    );
    return true;
  } catch {
    return false; // Already claimed by another dialer tick
  }
}

// List all users in the instance so we can use them as an `Agents` filter for
// GetCurrentUserData (which requires one filter). Cached within the warm
// container, keyeado por instanceId para que dos tenants no se mezclen.
const allUserIdsCacheByInstance = new Map<string, string[]>();
async function listAllUserIds(): Promise<string[]> {
  const hit = allUserIdsCacheByInstance.get(activeInstanceId);
  if (hit) return hit;
  const ids: string[] = [];
  let nextToken: string | undefined;
  do {
    const res = await activeConnect.send(
      new ListUsersCommand({
        InstanceId: activeInstanceId,
        MaxResults: 100,
        NextToken: nextToken,
      }),
    );
    for (const u of res.UserSummaryList || []) {
      if (u.Id) ids.push(u.Id);
    }
    nextToken = res.NextToken;
  } while (nextToken);
  allUserIdsCacheByInstance.set(activeInstanceId, ids);
  return ids;
}

// Fetch the user IDs assigned to a specific campaign (from connectview-campaign-agents).
async function getAssignedAgents(campaignId: string): Promise<string[]> {
  const res = await dynamo.send(
    new QueryCommand({
      TableName: CAMPAIGN_AGENTS_TABLE,
      KeyConditionExpression: "campaignId = :cid",
      ExpressionAttributeValues: { ":cid": { S: campaignId } },
    }),
  );
  return (res.Items || []).map((it) => (it.userId?.S as string) || "").filter(Boolean);
}

// Count how many users from the given list are Available AND not on an active contact.
// GetCurrentUserData needs a non-empty filter — pass the userIds in Agents.
// Batched in chunks of 100 (API limit).
async function countAvailableFromUsers(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  let available = 0;
  try {
    for (let i = 0; i < userIds.length; i += 100) {
      const batch = userIds.slice(i, i + 100);
      const res = await activeConnect.send(
        new GetCurrentUserDataCommand({
          InstanceId: activeInstanceId,
          Filters: { Agents: batch },
        }),
      );
      for (const u of res.UserDataList || []) {
        const contacts = u.Contacts || [];
        if (u.Status?.StatusName === "Available" && contacts.length === 0) {
          available++;
        }
      }
    }
  } catch (err) {
    console.warn("countAvailableFromUsers failed:", err);
  }
  return available;
}

/**
 * Returns the subset of userIds whose current status is Available AND who
 * have no active contact. Used by the per-agent-bucket dialer to decide
 * which buckets are ready to fire their next call.
 */
async function listIdleAvailableUsers(userIds: string[]): Promise<Set<string>> {
  const idle = new Set<string>();
  if (userIds.length === 0) return idle;
  try {
    for (let i = 0; i < userIds.length; i += 100) {
      const batch = userIds.slice(i, i + 100);
      const res = await activeConnect.send(
        new GetCurrentUserDataCommand({
          InstanceId: activeInstanceId,
          Filters: { Agents: batch },
        }),
      );
      for (const u of res.UserDataList || []) {
        const id = u.User?.Id;
        const contacts = u.Contacts || [];
        if (id && u.Status?.StatusName === "Available" && contacts.length === 0) {
          idle.add(id);
        }
      }
    }
  } catch (err) {
    console.warn("listIdleAvailableUsers failed:", err);
  }
  return idle;
}

async function markAsDialing(c: CampaignContact): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: CONTACTS_TABLE,
        Key: {
          campaignId: { S: c.campaignId },
          rowId: { S: c.rowId },
        },
        UpdateExpression: "SET #st = :dialing, lastAttemptAt = :now, attempts = attempts + :one",
        ConditionExpression: "#st = :pending",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":dialing": { S: "dialing" },
          ":pending": { S: "pending" },
          ":now": { S: now },
          ":one": { N: "1" },
        },
      }),
    );
    // Mirror the transition into the campaign meta counters so the list
    // page doesn't show stale or negative values. Without this, when
    // process-contact-event later sees status=dialing → terminal it will
    // decrement dialingCount that was never incremented, taking it
    // negative.
    await dynamo
      .send(
        new UpdateItemCommand({
          TableName: CAMPAIGNS_TABLE,
          Key: { campaignId: { S: c.campaignId } },
          UpdateExpression: "ADD dialingCount :one, pendingCount :neg",
          ExpressionAttributeValues: {
            ":one": { N: "1" },
            ":neg": { N: "-1" },
          },
        }),
      )
      .catch(() => {
        /* counter drift is acceptable — real source of truth is the rows */
      });
    return true;
  } catch (err) {
    // ConditionalCheckFailedException → another dialer grabbed it
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
      return false;
    }
    throw err;
  }
}

async function markAsFailed(c: CampaignContact, reason: string): Promise<void> {
  const now = new Date().toISOString();
  await dynamo.send(
    new UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: c.campaignId },
        rowId: { S: c.rowId },
      },
      UpdateExpression: "SET #st = :failed, lastAttemptAt = :now, lastError = :err",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":failed": { S: "failed" },
        ":now": { S: now },
        ":err": { S: reason.slice(0, 500) },
      },
    }),
  );
  // markAsFailed only runs when StartOutboundVoiceContact rejected the
  // dial — at that point markAsDialing already moved the contact OUT of
  // pending and INTO dialing (and updated the campaign counters
  // accordingly). So failing it should decrement DIALING (not pending)
  // and increment FAILED.
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: c.campaignId } },
        UpdateExpression: "ADD failedCount :one, dialingCount :neg",
        ExpressionAttributeValues: {
          ":one": { N: "1" },
          ":neg": { N: "-1" },
        },
      }),
    )
    .catch(() => {
      /* counter drift is OK, authoritative counts via Query */
    });
}

/** Marca un contacto de WhatsApp como ENVIADO (terminal). No hay eventos de
 *  Connect para WhatsApp, así que cerramos el contacto aquí mismo. */
async function markWhatsAppSent(c: CampaignContact, messageId: string): Promise<void> {
  const now = new Date().toISOString();
  await dynamo.send(
    new UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: { campaignId: { S: c.campaignId }, rowId: { S: c.rowId } },
      UpdateExpression:
        "SET #st = :done, lastAttemptAt = :now, connectContactId = :mid, whatsappMessageId = :mid",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":done": { S: "done" },
        ":now": { S: now },
        ":mid": { S: messageId },
      },
    }),
  );
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: c.campaignId } },
        UpdateExpression: "ADD doneCount :one, dialingCount :neg",
        ExpressionAttributeValues: { ":one": { N: "1" }, ":neg": { N: "-1" } },
      }),
    )
    .catch(() => {
      /* counter drift is OK */
    });
}

/** Pilar 3: contacto suprimido por el motor (opt-out/DNC/dedup/frecuencia/horario).
 *  Estado TERMINAL "suppressed" — NO es fallo y NO se reintenta. Cuenta como
 *  "resuelto" (doneCount) para que la campaña drene y complete. */
async function markSuppressed(c: CampaignContact, reason?: string): Promise<void> {
  const now = new Date().toISOString();
  await dynamo.send(
    new UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: { campaignId: { S: c.campaignId }, rowId: { S: c.rowId } },
      UpdateExpression: "SET #st = :sup, lastAttemptAt = :now, lastError = :err",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":sup": { S: "suppressed" },
        ":now": { S: now },
        ":err": { S: `suprimido: ${reason || "política"}`.slice(0, 500) },
      },
    }),
  );
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: c.campaignId } },
        UpdateExpression: "ADD doneCount :one, dialingCount :neg",
        ExpressionAttributeValues: { ":one": { N: "1" }, ":neg": { N: "-1" } },
      }),
    )
    .catch(() => {
      /* counter drift is OK */
    });
}

/**
 * Pilar 3 Fase C — gate de supresión para VOZ. Antes de marcar y llamar, consulta
 * el motor: opt-out/DNC/cuarentena (duros, channel-scoped a "voice"), horario
 * silencioso de voz, y "no contactar tras conversión". Si el contacto está
 * suprimido lo deja en estado TERMINAL "suppressed" (drena la campaña, NO se
 * reintenta) y devuelve true para que el caller lo salte.
 *
 * FAIL-OPEN: si el motor falla (DDB caído, etc.) NO bloqueamos la marcación —
 * un error de infraestructura no debe paralizar la campaña. Mismo criterio que
 * el gate de WhatsApp (evaluateSend ya es fail-open internamente; este try/catch
 * cubre además un throw inesperado).
 */
async function voiceSuppressed(campaign: Campaign, contact: CampaignContact): Promise<boolean> {
  try {
    const v = await evaluateSend(dynamo, {
      phone: contact.phone,
      channel: "voice",
      tenantId: campaign.tenantId,
    });
    if (!v.allowed) {
      await markSuppressed(contact, v.blockedBy);
      return true;
    }
  } catch (err) {
    console.warn(
      `[dialer] voice suppression check failed (fail-open) for ${maskPhone(contact.phone)}:`,
      err,
    );
  }
  return false;
}

/**
 * Recupera contactos de WhatsApp que quedaron trabados en "dialing": como el
 * envío de WhatsApp es síncrono (sub-segundo), cualquier contacto que lleve
 * rato en "dialing" es basura de un tick anterior interrumpido (p. ej. la
 * campaña se pausó a mitad de envío). Los devolvemos a "pending" para que el
 * próximo ciclo los reenvíe. Devuelve cuántos recuperó.
 */
async function reclaimStaleWhatsAppDialing(campaignId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 120_000).toISOString(); // 2 min de gracia
  let reclaimed = 0;
  try {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: CONTACTS_TABLE,
        IndexName: "campaignId-status-index",
        KeyConditionExpression: "campaignId = :cid AND #st = :s",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: { ":cid": { S: campaignId }, ":s": { S: "dialing" } },
        Limit: 50,
      }),
    );
    const items = (res.Items || []).map((it) => unmarshall(it) as CampaignContact);
    for (const c of items) {
      // No tocar un envío potencialmente en curso de otro tick concurrente.
      if (c.lastAttemptAt && c.lastAttemptAt > cutoff) continue;
      try {
        await dynamo.send(
          new UpdateItemCommand({
            TableName: CONTACTS_TABLE,
            Key: { campaignId: { S: c.campaignId }, rowId: { S: c.rowId } },
            UpdateExpression: "SET #st = :pending",
            ConditionExpression: "#st = :dialing",
            ExpressionAttributeNames: { "#st": "status" },
            ExpressionAttributeValues: {
              ":pending": { S: "pending" },
              ":dialing": { S: "dialing" },
            },
          }),
        );
        // Espejar contadores (dialing→pending) para que la lista no quede desfasada.
        await dynamo
          .send(
            new UpdateItemCommand({
              TableName: CAMPAIGNS_TABLE,
              Key: { campaignId: { S: campaignId } },
              UpdateExpression: "ADD dialingCount :neg, pendingCount :one",
              ExpressionAttributeValues: { ":neg": { N: "-1" }, ":one": { N: "1" } },
            }),
          )
          .catch(() => {
            /* drift aceptable, fuente real son las filas */
          });
        reclaimed++;
      } catch (e) {
        // Otro tick lo movió primero → ignorar.
        if (!(e instanceof Error && e.name === "ConditionalCheckFailedException")) throw e;
      }
    }
  } catch (err) {
    console.error("reclaimStaleWhatsAppDialing error:", err);
  }
  if (reclaimed > 0)
    console.log(`reclaimed ${reclaimed} stale dialing contacts (whatsapp) for ${campaignId}`);
  return reclaimed;
}

// FIX 4: umbral para considerar una fila de VOZ colgada en `dialing`. Ninguna
// llamada real permanece en `dialing` tanto tiempo (al conectar pasa a
// `connected`; al no contestar / colgar, process-contact-event la mueve a
// terminal o a retry). Si sigue en `dialing` pasado el umbral, su evento de
// Connect se perdió (o linkConnectContact falló y quedó sin connectContactId) →
// la reciclamos. 10 min por defecto; reutiliza STALE_DIALING_MS si está seteada.
const STALE_DIALING_MS = Number(process.env.STALE_DIALING_MS) || 10 * 60 * 1000;

/**
 * FIX 4 — reaper de VOZ, análogo a reclaimStaleWhatsAppDialing. Una fila que se
 * queda en `dialing` deja `inFlightByAgent>0` de forma permanente para su agente
 * y ese agente NUNCA vuelve a recibir marcado. Busca filas `dialing` cuya
 * `lastAttemptAt` sea más vieja que STALE_DIALING_MS y las devuelve a `pending`.
 * El filtro server-side por `lastAttemptAt` evita traer las llamadas activas
 * (que son la mayoría de las filas `dialing`), y el ConditionExpression re-valida
 * status + antigüedad para NO pisar una llamada recién marcada entre el query y
 * el update (respeta el umbral → no mata llamadas en progreso). Devuelve cuántas
 * recuperó. Best-effort: cualquier error se loguea y no interrumpe el tick.
 */
async function reclaimStaleVoiceDialing(campaignId: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_DIALING_MS).toISOString();
  let reclaimed = 0;
  let lastKey: Record<string, unknown> | undefined;
  try {
    // Paginado acotado (como listAllPendingForCampaign) por si hay muchas filas
    // `dialing` activas y las vencidas quedan más allá de la primera página.
    for (let page = 0; page < 10; page++) {
      const res = await dynamo.send(
        new QueryCommand({
          TableName: CONTACTS_TABLE,
          IndexName: "campaignId-status-index",
          KeyConditionExpression: "campaignId = :cid AND #st = :s",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: {
            ":cid": { S: campaignId },
            ":s": { S: "dialing" },
            ":cutoff": { S: cutoff },
          },
          FilterExpression: "attribute_not_exists(lastAttemptAt) OR lastAttemptAt <= :cutoff",
          ExclusiveStartKey: lastKey as never,
        }),
      );
      const items = (res.Items || []).map((it) => unmarshall(it) as CampaignContact);
      for (const c of items) {
        try {
          await dynamo.send(
            new UpdateItemCommand({
              TableName: CONTACTS_TABLE,
              Key: { campaignId: { S: c.campaignId }, rowId: { S: c.rowId } },
              UpdateExpression: "SET #st = :pending",
              // Sigue en `dialing` Y su intento sigue vencido → evita revertir
              // una llamada re-marcada entre el query y este update.
              ConditionExpression:
                "#st = :dialing AND (attribute_not_exists(lastAttemptAt) OR lastAttemptAt <= :cutoff)",
              ExpressionAttributeNames: { "#st": "status" },
              ExpressionAttributeValues: {
                ":pending": { S: "pending" },
                ":dialing": { S: "dialing" },
                ":cutoff": { S: cutoff },
              },
            }),
          );
          // Espejar contadores (dialing→pending), igual que el reaper de WhatsApp.
          await dynamo
            .send(
              new UpdateItemCommand({
                TableName: CAMPAIGNS_TABLE,
                Key: { campaignId: { S: campaignId } },
                UpdateExpression: "ADD dialingCount :neg, pendingCount :one",
                ExpressionAttributeValues: { ":neg": { N: "-1" }, ":one": { N: "1" } },
              }),
            )
            .catch(() => {
              /* drift aceptable, la verdad son las filas */
            });
          reclaimed++;
        } catch (e) {
          // Otro tick/evento la movió primero → ignorar.
          if (!(e instanceof Error && e.name === "ConditionalCheckFailedException")) throw e;
        }
      }
      lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      if (!lastKey) break;
    }
  } catch (err) {
    console.error("reclaimStaleVoiceDialing error:", err);
  }
  if (reclaimed > 0)
    console.log(`reclaimed ${reclaimed} stale dialing contacts (voice) for ${campaignId}`);
  return reclaimed;
}

/**
 * Procesa una campaña de WhatsApp: envía el template a cada contacto PENDIENTE
 * y lo marca "done". NO usa agentes ni el ciclo de voz (dialing→eventos Connect).
 * Acotado por tick (BATCH) para no exceder el timeout con listas grandes.
 */
async function processCampaignWhatsApp(campaign: Campaign): Promise<void> {
  const BATCH = 25;
  // Rescatar contactos trabados en "dialing" de ticks interrumpidos antes de
  // decidir si la campaña está completa.
  await reclaimStaleWhatsAppDialing(campaign.campaignId);
  const candidates = await findPendingContacts(campaign.campaignId, BATCH);
  if (candidates.length === 0) {
    await maybeCompleteCampaign(campaign);
    return;
  }
  for (const contact of candidates) {
    // Claim atómico (pending→dialing) para evitar doble envío entre ticks.
    const claimed = await markAsDialing(contact);
    if (!claimed) continue;
    const res = await sendWhatsAppTemplate(campaign, contact);
    if (res.messageId) {
      await markWhatsAppSent(contact, res.messageId);
    } else if (res.suppressed) {
      // Pilar 3: el número está suprimido (opt-out/DNC/dedup/frecuencia/horario)
      // → estado TERMINAL "suppressed", no es un fallo y NO se reintenta.
      await markSuppressed(contact, res.reason);
    } else {
      await markAsFailed(contact, "Envío de template de WhatsApp falló");
    }
  }
}

/**
 * Send a WhatsApp template for one contact. Returns a fake "contactId"
 * (the Meta messageId) on success so the rest of the dialer pipeline
 * treats it the same as a placed call. We don't follow up with the
 * usual Connect events — Meta delivery webhooks would be needed for
 * accurate per-lead delivered/read tracking, and that's out of scope.
 */
interface WaSendResult {
  messageId: string | null;
  suppressed?: boolean;
  reason?: string;
}

async function sendWhatsAppTemplate(
  campaign: Campaign,
  contact: CampaignContact,
): Promise<WaSendResult> {
  if (!campaign.templateName) {
    console.error("whatsapp campaign missing templateName");
    return { messageId: null };
  }
  let customAttrs: Record<string, string> = {};
  try {
    customAttrs = JSON.parse(contact.customAttributes || "{}");
  } catch {
    /* ignore */
  }
  // Fill the template variables from the CSV columns the manager
  // selected (templateVarColumns is a JSON array of column names).
  let varColumns: string[] = [];
  try {
    varColumns = JSON.parse(campaign.templateVarColumns || "[]");
  } catch {
    /* ignore */
  }
  const variables = varColumns.map((col) => {
    if (col === "__customerName__") return contact.customerName || "";
    if (col.startsWith("lit:")) return col.slice(4); // valor fijo, igual para todos
    return customAttrs[col] != null ? String(customAttrs[col]) : "";
  });

  const url = process.env.SEND_WHATSAPP_TEMPLATE_URL;
  if (!url) {
    console.error("SEND_WHATSAPP_TEMPLATE_URL env not set");
    return { messageId: null };
  }
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Secreto interno: prueba que es el dialer (server-to-server, sin JWT) y
        // autoriza a send-whatsapp-template a respetar el body.tenantId. Sin esto,
        // send-whatsapp-template ignora body.tenantId (anti-impersonación pública).
        "x-vox-internal": process.env.VOX_INTERNAL_SECRET || "",
      },
      body: JSON.stringify({
        phone: contact.phone,
        templateName: campaign.templateName,
        language: campaign.templateLanguage || "es",
        variables,
        // WhatsApp BYO: el dialer no tiene JWT → pasa el tenant explícito para
        // que send-whatsapp-template mande desde el número del CLIENTE (su End
        // User Messaging), no el de Vox.
        tenantId: campaign.tenantId,
        campaignId: campaign.campaignId,
      }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      sent?: boolean;
      messageId?: string;
      error?: string;
      suppressed?: boolean;
      blockedBy?: string;
    };
    // Pilar 3: el gate de supresión cortó el envío (HTTP 200 + suppressed:true).
    if (body.suppressed) {
      console.log(`WhatsApp suppressed for ${maskPhone(contact.phone)}: ${body.blockedBy || "?"}`);
      return { messageId: null, suppressed: true, reason: body.blockedBy };
    }
    if (!r.ok || !body.sent) {
      console.error("WhatsApp template send failed:", body.error || `HTTP ${r.status}`);
      return { messageId: null };
    }
    return { messageId: body.messageId || `wa-${Date.now()}-${contact.rowId.slice(0, 6)}` };
  } catch (err) {
    console.error("WhatsApp template fetch failed:", err);
    return { messageId: null };
  }
}

async function startOutbound(campaign: Campaign, contact: CampaignContact): Promise<string | null> {
  // Route to the right dispatcher based on campaign type.
  if ((campaign.campaignType || "voice").toLowerCase() === "whatsapp") {
    return (await sendWhatsAppTemplate(campaign, contact)).messageId;
  }
  try {
    // Pass custom attributes + campaign/name so the flow can identify the call
    let customAttrs: Record<string, string> = {};
    try {
      customAttrs = JSON.parse(contact.customAttributes || "{}");
    } catch {
      /* ignore */
    }
    const attributes: Record<string, string> = {
      campaignId: campaign.campaignId,
      campaignName: campaign.name.slice(0, 256),
      campaignRowId: contact.rowId,
      customerName: contact.customerName.slice(0, 256),
      ...Object.fromEntries(
        Object.entries(customAttrs)
          .slice(0, 30) // Connect attribute limit safety
          .map(([k, v]) => [k.slice(0, 127), String(v).slice(0, 256)]),
      ),
    };

    // ── Ruteo del flow directo (ARIA-Outbound-Direct) ────────────────────
    // Se asignan DESPUÉS del spread para que un CSV con columnas "aria*" no
    // pueda pisar el ruteo. En "exclusive" la llamada va a la cola PERSONAL
    // del agente del bucket; fail-open: sin dueño → ruteo compartido normal.
    const exclusive =
      (campaign.agentRouting || "shared") === "exclusive" && !!contact.assignedAgentUserId;
    attributes.ariaRouting = exclusive ? "agent" : "shared";
    if (exclusive) attributes.ariaAgentId = contact.assignedAgentUserId as string;
    if (campaign.campaignQueueId) attributes.ariaQueueId = campaign.campaignQueueId;

    // If AMD is enabled and we have a dedicated AMD flow, use it in place of
    // the admin-selected flow. The AMD flow runs CheckOutboundCallStatus first
    // and only transfers to the queue on CallAnswered. Voicemails and no-answer
    // are hung up before an agent ever sees the call.
    //
    // IMPORTANT (2026): Outbound Campaigns v2 is required for Peru is NOT
    // supported by AWS (only US, MX, BR from us-east-1). So we keep
    // TrafficType=GENERAL (default) + AnswerMachineDetectionConfig on the
    // StartOutboundVoiceContact itself — this DOES work for Peru.
    // El override de AMD NO aplica a campañas con flujo directo/exclusivo: el
    // flow AMD transfiere a cola a su manera y se perdería el ruteo por
    // atributos (exclusividad rota en silencio).
    const usesDirectFlow = exclusive || campaign.directConnect === true;
    const useAmd = AMD_ENABLED && !!AMD_FLOW_ID && !usesDirectFlow;
    const contactFlowId = useAmd ? AMD_FLOW_ID : campaign.contactFlowId;

    const res = await activeConnect.send(
      new StartOutboundVoiceContactCommand({
        InstanceId: activeInstanceId,
        ContactFlowId: contactFlowId,
        DestinationPhoneNumber: contact.phone,
        SourcePhoneNumber: campaign.sourcePhoneNumber,
        Attributes: attributes,
        ClientToken: `${contact.rowId}-${contact.attempts}-${Date.now()}`.slice(0, 500),
        // AMD config — works on GENERAL traffic. The contact flow (AMD_FLOW_ID)
        // reads the result via CheckOutboundCallStatus and branches.
        ...(useAmd
          ? {
              AnswerMachineDetectionConfig: {
                EnableAnswerMachineDetection: true,
                AwaitAnswerMachinePrompt: false,
              },
            }
          : {}),
      }),
    );
    return res.ContactId || null;
  } catch (err) {
    // FIX 2: propagar la excepción REAL de la API para que el caller la trate
    // como fallo TERMINAL (markAsFailed). El retorno `null` queda reservado para
    // "la API respondió sin ContactId" (no se pudo iniciar sin excepción →
    // transitorio → rollbackToPending, se reintenta).
    console.error("StartOutboundVoiceContact failed:", err);
    throw err;
  }
}

async function linkConnectContact(c: CampaignContact, connectContactId: string): Promise<void> {
  await dynamo.send(
    new UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: c.campaignId },
        rowId: { S: c.rowId },
      },
      UpdateExpression: "SET connectContactId = :cid",
      ExpressionAttributeValues: { ":cid": { S: connectContactId } },
    }),
  );
}

// FIX 2: revierte un intento de marcación que NO llegó a colocar llamada
// (dialing → pending) para que se reintente en un tick posterior, en vez de
// morir terminal en `failed`. markAsDialing ya movió la fila a `dialing` (e
// incrementó dialingCount / decrementó pendingCount); aquí condicionamos a que
// siga en `dialing` para no pisar un cambio concurrente y espejamos los
// contadores de vuelta. Best-effort: nunca lanza — si el revert falla, el reaper
// de voz (FIX 4) recuperará la fila igualmente.
async function rollbackToPending(c: CampaignContact): Promise<void> {
  let reverted = false;
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: CONTACTS_TABLE,
        Key: {
          campaignId: { S: c.campaignId },
          rowId: { S: c.rowId },
        },
        UpdateExpression: "SET #st = :pending",
        ConditionExpression: "#st = :dialing",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: { ":pending": { S: "pending" }, ":dialing": { S: "dialing" } },
      }),
    );
    reverted = true;
  } catch (e) {
    // ConditionalCheckFailed → otro tick/evento ya la movió (no revertimos
    // contadores). Cualquier otro error → best-effort, el reaper la recupera.
    if (!(e instanceof Error && e.name === "ConditionalCheckFailedException")) {
      console.warn("rollbackToPending failed (el reaper la recuperará):", e);
    }
  }
  if (!reverted) return;
  // Espejar contadores (dialing→pending) que markAsDialing había incrementado.
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: c.campaignId } },
        UpdateExpression: "ADD dialingCount :neg, pendingCount :one",
        ExpressionAttributeValues: { ":neg": { N: "-1" }, ":one": { N: "1" } },
      }),
    )
    .catch(() => {
      /* drift aceptable, la verdad son las filas */
    });
}

// Check whether any contacts are left for this campaign — if zero pending/dialing/connected,
// mark campaign COMPLETED.
async function maybeCompleteCampaign(campaign: Campaign): Promise<void> {
  const statuses = ["pending", "dialing", "connected"];
  let total = 0;
  for (const st of statuses) {
    const r = await dynamo.send(
      new QueryCommand({
        TableName: CONTACTS_TABLE,
        IndexName: "campaignId-status-index",
        KeyConditionExpression: "campaignId = :cid AND #st = :s",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":cid": { S: campaign.campaignId },
          ":s": { S: st },
        },
        Select: "COUNT",
      }),
    );
    total += r.Count || 0;
  }
  if (total === 0) {
    try {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: CAMPAIGNS_TABLE,
          Key: { campaignId: { S: campaign.campaignId } },
          UpdateExpression: "SET #st = :c, completedAt = :now",
          ConditionExpression: "#st = :running",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: {
            ":c": { S: "COMPLETED" },
            ":running": { S: "RUNNING" },
            ":now": { S: new Date().toISOString() },
          },
        }),
      );
      // La condición pasó → transición real RUNNING→COMPLETED: revertir el
      // auto-accept de los agentes (si la campaña lo activó).
      await revertAutoAcceptOnComplete(campaign);
    } catch {
      /* already not running, ignore */
    }
  }
}

/** Campaña completada con autoAccept: revertir el auto-contestar de sus
 *  agentes para que no siga afectando llamadas fuera de campaña. Best-effort:
 *  si falla, el admin puede revertirlo quitando/re-agregando agentes. */
async function revertAutoAcceptOnComplete(campaign: Campaign): Promise<void> {
  if (campaign.autoAccept !== true) return;
  try {
    let client = activeConnect;
    let iid = activeInstanceId;
    if (campaign.tenantId) {
      const tc = await getTenantConnect(campaign.tenantId).catch(() => null);
      if (tc) {
        client = tc.client;
        iid = tc.instanceId;
      }
    }
    const userIds = await getAssignedAgents(campaign.campaignId);
    if (userIds.length > 0 && iid) {
      const r = await applyAutoAccept(client, iid, userIds, false);
      console.log(`autoAccept revertido al completar ${campaign.campaignId}: ok=${r.ok}`);
    }
  } catch (err) {
    console.warn("revertAutoAcceptOnComplete falló:", err);
  }
}

/** Pilar 7 — completar la campaña por meta alcanzada (incondicional). Resuelve
 *  el dynamo del tenant dueño porque el goal-check corre antes del switch. */
async function forceCompleteCampaign(campaign: Campaign, reason: string): Promise<void> {
  let d = legacyDynamo;
  if (campaign.tenantId) {
    try {
      const tc = await getTenantConnect(campaign.tenantId);
      if (tc) d = tc.dynamo;
    } catch {
      /* sin Connect → legacy */
    }
  }
  try {
    await d.send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaign.campaignId } },
        UpdateExpression: "SET #st = :c, completedAt = :now, completedReason = :r",
        ConditionExpression: "#st = :running",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":c": { S: "COMPLETED" },
          ":running": { S: "RUNNING" },
          ":now": { S: new Date().toISOString() },
          ":r": { S: reason },
        },
      }),
    );
    await revertAutoAcceptOnComplete(campaign);
  } catch {
    /* already not running */
  }
}

/**
 * Process a single campaign with the per-agent-bucket dialing strategy.
 * Each assigned agent gets a pre-allocated bucket of `maxContactsPerAgent`
 * pending contacts (FIFO by createdAt). On every tick, idle agents pop the
 * next contact from THEIR bucket. When a bucket runs low it's refilled
 * from the unassigned pool. This makes the agent's queue predictable and
 * visible in the UI instead of a single global "pendientes" pile.
 */
async function processCampaignWithBuckets(
  campaign: Campaign,
  assignedAgentIds: string[],
): Promise<void> {
  const maxPerAgent = Math.max(1, Math.min(50, Number(campaign.maxContactsPerAgent) || 5));

  // 1. Load every pending contact for this campaign in one query.
  const allPending = await listAllPendingForCampaign(campaign.campaignId);

  // 2. Split into per-agent buckets + unassigned pool.
  const buckets = new Map<string, CampaignContact[]>();
  const unassigned: CampaignContact[] = [];
  for (const c of allPending) {
    const uid = c.assignedAgentUserId || "";
    if (uid && assignedAgentIds.includes(uid)) {
      if (!buckets.has(uid)) buckets.set(uid, []);
      buckets.get(uid)!.push(c);
    } else {
      // Either the contact has no assignment OR it's assigned to an agent
      // that's no longer assigned to the campaign — treat as unassigned.
      unassigned.push(c);
    }
  }
  // Fase 2 · F2.4 — prioridad por SCORE del lead (estampado en customAttributes
  // al crear la campaña) DESC, y FIFO (createdAt) como desempate. El lead más
  // caliente se marca primero en vez del más viejo. Sin score → 0 (va al final,
  // igual que antes por createdAt).
  const scoreOf = (c: CampaignContact): number => {
    try {
      return Number(JSON.parse(c.customAttributes || "{}").score) || 0;
    } catch {
      return 0;
    }
  };
  const byScoreThenCreatedAt = (a: CampaignContact, b: CampaignContact) =>
    scoreOf(b) - scoreOf(a) || (a.createdAt || "").localeCompare(b.createdAt || "");
  for (const list of buckets.values()) list.sort(byScoreThenCreatedAt);
  unassigned.sort(byScoreThenCreatedAt);

  // 3. Refill de buckets en RONDAS (round-robin) + recordar el in-flight para
  //    que el paso de marcado lo reuse sin re-consultar.
  //    ANTES se llenaba el bucket del PRIMER agente hasta maxPerAgent y recién
  //    después el del siguiente: con pocos contactos TODOS caían en un solo
  //    bucket y la campaña marcaba EN SERIE aunque hubiera N agentes libres
  //    (el loop de marcado dispara 1 por agente, pero solo un bucket tenía
  //    contenido). Repartiendo 1-a-1 por turnos, 2 contactos + 2 agentes =
  //    1 c/u → ambos se marcan en el MISMO tick (timbrado simultáneo real).
  const inFlightByAgent = new Map<string, number>();
  const needByAgent = new Map<string, number>();
  for (const userId of assignedAgentIds) {
    const inFlight = await countAgentInFlight(campaign.campaignId, userId);
    inFlightByAgent.set(userId, inFlight);
    const bucketSize = buckets.get(userId)?.length || 0;
    needByAgent.set(userId, Math.max(0, maxPerAgent - bucketSize - inFlight));
  }
  let dealt = true;
  while (dealt && unassigned.length > 0) {
    dealt = false;
    for (const userId of assignedAgentIds) {
      if (unassigned.length === 0) break;
      const need = needByAgent.get(userId) || 0;
      if (need <= 0) continue;
      const c = unassigned.shift()!;
      const ok = await assignContactToAgent(c, userId);
      if (ok) {
        c.assignedAgentUserId = userId;
        if (!buckets.has(userId)) buckets.set(userId, []);
        buckets.get(userId)!.push(c);
      }
      // Consumimos el cupo aunque el claim falle (carrera) para no ciclar.
      needByAgent.set(userId, need - 1);
      dealt = true;
    }
  }

  // 3.5. Manual / preview mode: stop here. We've assigned contacts to
  //      agent buckets but we don't auto-dial — the agent's UI will
  //      surface the bucket and call edit-campaign-contacts with action
  //      manual-call (or manual-skip) per contact. This is the standard
  //      "preview dialing" pattern from contact-center playbooks: give
  //      the agent context BEFORE the call so they can decide whether to
  //      call now, skip, or reschedule.
  if (campaign.dialMode === "manual") {
    console.log(`[dialer] ${campaign.campaignId}: manual mode · buckets ready, no auto-dial`);
    if (allPending.length === 0) {
      await maybeCompleteCampaign(campaign);
    }
    return;
  }

  // 4. For each idle Available agent, dial the head of their bucket.
  //    "Idle" here is the conjunction of:
  //      a) Connect reports them as Available with no active contact
  //         (GetCurrentUserData), AND
  //      b) Our DB has zero dialing/connected rows for them
  //    The DB check matters because Connect can briefly report an agent as
  //    Available between StartOutboundVoiceContact and the moment the
  //    contact flow transfers the call to them — the welcome TTS and AMD
  //    blocks run BEFORE the agent is occupied. Without (b) the dialer
  //    fires a second call in that gap, which manifests as spurious
  //    no_answer rows and double-rings on the customer.
  const idleSet = await listIdleAvailableUsers(assignedAgentIds);
  console.log(
    `[dialer] ${campaign.campaignId}: bucket-mode · agents=${assignedAgentIds.length}, idle=${idleSet.size}, unassignedLeft=${unassigned.length}`,
  );

  // Auditoría campañas 2026-07: en modo bucket el RITMO lo dan los agentes — una
  // llamada por agente libre. El loop de abajo ya está acotado por assignedAgentIds
  // (y por el chequeo idle + inFlightByAgent), así que basta con eso. Se ELIMINÓ el
  // tope de concurrencia y el slotOverride del pool: eran vestigios del modelo de
  // marcación por pool compartido y solo podían FRENAR a los agentes por debajo de
  // su capacidad (p.ej. concurrencia=1 con 5 agentes → 1 sola llamada). El camino
  // por pool (processCampaignLegacy) conserva ambos para el modo agentless.
  let slotsLeft = assignedAgentIds.length;

  let dialedAny = false;
  for (const userId of assignedAgentIds) {
    if (slotsLeft <= 0) break;
    if (!idleSet.has(userId)) continue;
    // DB-side busy check: if there's already a dialing/connected row for
    // this agent, do NOT dial another — Connect just hasn't transferred
    // the previous call yet.
    if ((inFlightByAgent.get(userId) || 0) > 0) continue;
    const bucket = buckets.get(userId);
    if (!bucket || bucket.length === 0) continue;
    const next = bucket.shift()!;
    const claimed = await markAsDialing(next);
    if (!claimed) continue;
    // Pilar 3 Fase C: gate de supresión de voz (opt-out/DNC/cuarentena/horario
    // silencioso/no-tras-conversión). Suprimido → terminal, sin marcar.
    if (await voiceSuppressed(campaign, next)) continue;
    // FIX 2: excepción REAL de la API → markAsFailed (terminal); retorno null sin
    // excepción ("no se pudo iniciar") → rollbackToPending (vuelve a `pending` y
    // se reintenta) en vez de morir en `failed`.
    let connectContactId: string | null = null;
    try {
      connectContactId = await startOutbound(campaign, next);
    } catch (err) {
      await markAsFailed(next, err instanceof Error ? err.message : "StartOutbound exception");
      continue;
    }
    if (!connectContactId) {
      await rollbackToPending(next);
      continue;
    }
    // FIX 3: linkConnectContact escribe el connectContactId DESPUÉS de que la
    // llamada ya salió. Si ese write falla NO abortamos el tick (la llamada ya
    // está en curso): logueamos y seguimos; el reaper de voz (FIX 4) recuperará
    // la fila si queda huérfana en `dialing` sin connectContactId.
    try {
      await linkConnectContact(next, connectContactId);
    } catch (err) {
      console.error("linkConnectContact failed (call already placed):", err);
    }
    dialedAny = true;
    slotsLeft -= 1;
    // Bump our local counter so a subsequent iteration in this same tick
    // doesn't try to dial again for the same agent.
    inFlightByAgent.set(userId, (inFlightByAgent.get(userId) || 0) + 1);
  }

  // FIX 5: (variante CONSERVADORA elegida) — devolver al pool los contactos
  // `pending` que quedaron pre-asignados a agentes que NO están disponibles este
  // tick y que NO tienen trabajo en vuelo (offline / bloqueados / en otro
  // contacto). Sin esto, un contacto pre-asignado a un agente ausente queda
  // atrapado en su bucket y ningún agente libre lo toma. Limpiamos
  // assignedAgentUserId (→ "") y el refill del próximo tick lo redistribuye a un
  // agente idle. NO tocamos agentes con inFlight>0 (están trabajando la campaña:
  // su cola es legítima) para no romper el pacing, ni el modo manual (retornó
  // antes). Los agentes idle conservan su bucket (lo están marcando).
  let released = 0;
  for (const userId of assignedAgentIds) {
    if (idleSet.has(userId)) continue; // disponible → conserva su bucket
    if ((inFlightByAgent.get(userId) || 0) > 0) continue; // ocupado/trabajando → conserva
    const bucket = buckets.get(userId);
    if (!bucket || bucket.length === 0) continue;
    for (const c of bucket) {
      try {
        await dynamo.send(
          new UpdateItemCommand({
            TableName: CONTACTS_TABLE,
            Key: { campaignId: { S: c.campaignId }, rowId: { S: c.rowId } },
            UpdateExpression: "SET assignedAgentUserId = :empty",
            // Solo si sigue `pending` y aún es de este agente → no pisa un dial
            // ni una reasignación concurrente de otro tick.
            ConditionExpression: "#st = :pending AND assignedAgentUserId = :uid",
            ExpressionAttributeNames: { "#st": "status" },
            ExpressionAttributeValues: {
              ":empty": { S: "" },
              ":pending": { S: "pending" },
              ":uid": { S: userId },
            },
          }),
        );
        released++;
      } catch (e) {
        // Otro tick lo movió/tomó → ignorar; solo avisar errores inesperados.
        if (!(e instanceof Error && e.name === "ConditionalCheckFailedException")) {
          console.warn("FIX5 release failed:", e);
        }
      }
    }
  }
  if (released > 0) {
    console.log(
      `[dialer] ${campaign.campaignId}: FIX5 devolvió ${released} pending de agentes ausentes al pool`,
    );
  }

  // 5. If nothing got dialed and there's nothing left to do, maybe complete.
  if (!dialedAny && allPending.length === 0) {
    await maybeCompleteCampaign(campaign);
  }
}

/**
 * Legacy single-pool dialing — used for `agentless` mode or campaigns
 * that don't have any assigned agents (no bucket targets to fill).
 */
async function processCampaignLegacy(campaign: Campaign, slotOverride?: number): Promise<void> {
  const currentlyDialing = await countDialingForCampaign(campaign.campaignId);
  const maxConcurrency = Number(campaign.concurrency) || 1;
  // Pilar 7: el presupuesto del orquestador acota la concurrencia de la campaña.
  const availableSlots =
    slotOverride !== undefined
      ? Math.min(slotOverride, Math.max(0, maxConcurrency - currentlyDialing))
      : Math.max(0, maxConcurrency - currentlyDialing);

  const ratio = campaign.dialMode === "power" ? 2 : 1;
  let toDial: number;
  let slotsRemaining = 0;

  if (campaign.dialMode === "agentless") {
    toDial = availableSlots;
  } else {
    const poolIds = await listAllUserIds();
    slotsRemaining = await countAvailableFromUsers(poolIds);
    console.log(
      `[dialer] ${campaign.campaignId}: legacy · pool=${poolIds.length}, available=${slotsRemaining}`,
    );
    toDial = Math.min(availableSlots, slotsRemaining * ratio);
  }
  if (toDial <= 0) return;

  const candidates = await findPendingContacts(campaign.campaignId, toDial);
  if (candidates.length === 0) {
    await maybeCompleteCampaign(campaign);
    return;
  }

  for (const contact of candidates) {
    const claimed = await markAsDialing(contact);
    if (!claimed) continue;
    // Pilar 3 Fase C: gate de supresión de voz antes de marcar.
    if (await voiceSuppressed(campaign, contact)) continue;
    // FIX 2: excepción REAL de la API → markAsFailed (terminal); retorno null sin
    // excepción → rollbackToPending (vuelve a `pending`, se reintenta).
    let connectContactId: string | null = null;
    try {
      connectContactId = await startOutbound(campaign, contact);
    } catch (err) {
      await markAsFailed(contact, err instanceof Error ? err.message : "StartOutbound exception");
      continue;
    }
    if (!connectContactId) {
      await rollbackToPending(contact);
      continue;
    }
    // FIX 3: no abortar el tick si falla el link del connectContactId (la llamada
    // ya salió; el reaper de voz la recupera si queda huérfana en `dialing`).
    try {
      await linkConnectContact(contact, connectContactId);
    } catch (err) {
      console.error("linkConnectContact failed (call already placed):", err);
    }
    if (campaign.dialMode !== "agentless") {
      slotsRemaining -= 1 / ratio;
    }
    if (slotsRemaining <= 0 && campaign.dialMode !== "agentless") break;
  }
}

/**
 * Sub-minute pacing without recursion. EventBridge fires the dialer
 * every 1 minute (its floor). To dial faster than that, the handler
 * runs MULTIPLE dial cycles per invocation with setTimeout between
 * them — a single Lambda invocation lasting ~50s replaces what would
 * have been 4 separate EB ticks. No self-invoke = no recursive-loop
 * detector tripping.
 *
 *   t=0    cycle 1 dispatches dials
 *   t=15s  cycle 2 dispatches dials
 *   t=30s  cycle 3 dispatches dials
 *   t=45s  cycle 4 dispatches dials
 *   t=50s  Lambda returns; next EB tick fires at t≈60
 *
 * Trade-off: one Lambda invocation now runs ~50s instead of ~3s. At
 * 256MB and 1440 invocations/day that's ~500k GB-seconds/month,
 * comfortably within the free tier (400k) plus ~$0.01/day after. Worth
 * it for the 4× faster dispatch cadence.
 *
 * If no campaign has pending work, cycles short-circuit out of the
 * sleep early so we don't burn duration time for nothing.
 */
const SUB_TICK_COUNT = Number(process.env.SUB_TICK_COUNT) || 4;
const SUB_TICK_INTERVAL_MS = Number(process.env.SUB_TICK_INTERVAL_MS) || 15_000;
/** Hard cap on Lambda duration so we always finish before EB fires
 *  again. EB fires every 60s; we cap at 55s for safety margin. */
const HANDLER_BUDGET_MS = 55_000;

interface DialerEvent {
  /** Reserved for future use. EventBridge ticks always arrive empty. */
  reserved?: never;
}

/**
 * Pilar 7 — pool global de marcación por tenant (config de conexiones).
 * Default = suma de concurrencias activas (sin throttle, = comportamiento de
 * hoy). El supervisor lo baja a ~Nº de agentes para que el peso (80/20) muerda.
 */
async function resolvePoolCap(tenantId: string | undefined, defaultCap: number): Promise<number> {
  if (!tenantId) return defaultCap;
  try {
    const it = await legacyDynamo.send(
      new GetItemCommand({ TableName: CONNECTIONS_TABLE, Key: { tenantId: { S: tenantId } } }),
    );
    if (it.Item) {
      const cfg = JSON.parse((unmarshall(it.Item) as { configJson?: string }).configJson || "{}");
      const m = Number(cfg.orchestration?.maxConcurrentDials);
      if (Number.isFinite(m) && m > 0) return m;
    }
  } catch {
    /* sin config → default */
  }
  return defaultCap;
}

/**
 * Pilar 7 — calcula los slots de marcación de ESTE ciclo por campaña de voz.
 * Reparte el pool global de cada tenant entre sus campañas activas según
 * **peso** (% del pool) en orden de **prioridad** (la de mayor prioridad toma
 * su parte primero; si el pool se agota, las de menor prioridad reciben 0).
 * Fail-safe: ante cualquier error devuelve un mapa vacío → cada campaña cae a
 * su concurrencia normal (comportamiento de hoy, sin regresión).
 */
async function computeSlotBudget(voiceCampaigns: Campaign[]): Promise<Map<string, number>> {
  const budget = new Map<string, number>();
  if (voiceCampaigns.length <= 1) return budget; // sin contención → sin reparto
  try {
    type Row = { c: Campaign; dialing: number; headroom: number };
    const byTenant = new Map<string, Row[]>();
    for (const c of voiceCampaigns) {
      // Contar dialing con el dynamo del tenant dueño.
      if (c.tenantId) {
        const tc = await getTenantConnect(c.tenantId);
        dynamo = tc ? tc.dynamo : legacyDynamo;
      } else {
        dynamo = legacyDynamo;
      }
      const dialing = await countDialingForCampaign(c.campaignId);
      const conc = Number(c.concurrency) || 1;
      const row: Row = { c, dialing, headroom: Math.max(0, conc - dialing) };
      const key = c.tenantId || "default";
      const arr = byTenant.get(key) || [];
      arr.push(row);
      byTenant.set(key, arr);
    }
    for (const [tenantKey, group] of byTenant) {
      if (group.length <= 1) continue; // una sola campaña → sin reparto (usa su concurrencia)
      const sumConc = group.reduce((n, r) => n + (Number(r.c.concurrency) || 1), 0);
      const poolCap = await resolvePoolCap(
        tenantKey === "default" ? undefined : tenantKey,
        sumConc,
      );
      const inFlight = group.reduce((n, r) => n + r.dialing, 0);
      let remainingPool = Math.max(0, poolCap - inFlight);
      // Orden: prioridad DESC, peso DESC, antigüedad ASC.
      group.sort((a, b) => {
        const pa = Number(a.c.priority ?? 5),
          pb = Number(b.c.priority ?? 5);
        if (pb !== pa) return pb - pa;
        const wa = Number(a.c.weight ?? 1),
          wb = Number(b.c.weight ?? 1);
        return wb - wa;
      });
      let remainingWeight = group.reduce((n, r) => n + (Number(r.c.weight ?? 1) || 1), 0);
      for (const r of group) {
        const w = Number(r.c.weight ?? 1) || 1;
        const share =
          remainingWeight > 0 ? Math.round((remainingPool * w) / remainingWeight) : remainingPool;
        const alloc = Math.max(0, Math.min(r.headroom, share, remainingPool));
        budget.set(r.c.campaignId, alloc);
        remainingPool -= alloc;
        remainingWeight -= w;
      }
    }
  } catch (e) {
    console.error("[dialer] computeSlotBudget falló (fail-safe a concurrencia):", e);
    return new Map();
  }
  return budget;
}

/** Pilar 7 — ¿la campaña alcanzó su meta? (contactados / conversiones). */
function goalReached(c: Campaign): boolean {
  const target = Number(c.goalTarget) || 0;
  if (target <= 0) return false;
  if (c.goalType === "contacts") return (Number(c.connectedCount) || 0) >= target;
  if (c.goalType === "conversions") return (Number(c.conversionsCount) || 0) >= target;
  return false;
}

/** Run one dial cycle across all RUNNING campaigns. Extracted so the
 *  handler can call it N times per invocation. Returns true when there
 *  is still work pending (so we keep cycling) and false when every
 *  campaign is drained (so we can exit early and save duration cost). */
async function dialCycle(): Promise<{
  campaignsProcessed: number;
  anyPendingLeft: boolean;
}> {
  // Programación: las campañas cuya fecha de arranque ya venció pasan a RUNNING
  // ANTES de listar, así entran a este mismo ciclo y no pierden un minuto.
  await promoteScheduledCampaigns();
  const campaigns = await listRunningCampaigns();
  if (campaigns.length === 0) {
    return { campaignsProcessed: 0, anyPendingLeft: false };
  }
  // Pilar 7 — orden por prioridad (no FIFO por creación) + presupuesto de slots
  // del ciclo repartido por peso entre campañas de voz activas.
  campaigns.sort((a, b) => {
    const pa = Number(a.priority ?? 5),
      pb = Number(b.priority ?? 5);
    if (pb !== pa) return pb - pa;
    return Number(b.weight ?? 1) - Number(a.weight ?? 1);
  });
  // Resolver el horario de CADA campaña de una sola vez, antes de repartir slots
  // y de entrar al loop. Es asíncrono (puede leer el Hours of Operation de
  // Connect), y `Array.filter` no acepta promesas, así que se precomputa acá.
  // Ambas lecturas están cacheadas —el rol del tenant ~50 min, el horario 5
  // min—, de modo que en régimen esto no genera tráfico por tick.
  const schedules = new Map<string, WeeklySchedule>();
  await Promise.all(
    campaigns.map(async (c) => {
      schedules.set(c.campaignId, await resolveCampaignSchedule(c));
    }),
  );
  const isOpen = (c: Campaign): boolean => {
    const s = schedules.get(c.campaignId);
    return s ? isWithinSchedule(s) : true; // sin horario resuelto → no bloquear
  };

  const voiceCampaigns = campaigns.filter(
    (c) => isOpen(c) && (c.campaignType || "voice").toLowerCase() !== "whatsapp",
  );
  const slotBudget = await computeSlotBudget(voiceCampaigns);
  let anyPendingLeft = false;
  for (const campaign of campaigns) {
    // FIX 1: aislar CADA campaña en su propio try/catch. Sin esto, si una campaña
    // lanzaba (getTenantConnect, getAssignedAgents, listAllPendingForCampaign,
    // markAsDialing, el reaper, etc.) se abortaba el tick ENTERO y las demás
    // campañas quedaban sin procesar. Capturamos, logueamos y seguimos con la
    // siguiente (no re-lanzar).
    try {
      // Fin de vigencia: la campaña se cierra aunque queden pendientes. Va
      // ANTES del filtro de ventana — si no, una campaña vencida fuera de
      // horario quedaría RUNNING para siempre sin que nadie la complete.
      if (isScheduleExpired(campaign.scheduledEndAt)) {
        console.log(
          `[dialer] ${campaign.campaignId} venció su vigencia (${campaign.scheduledEndAt}) → completar`,
        );
        await forceCompleteCampaign(campaign, "expired");
        continue;
      }
      if (!isOpen(campaign)) {
        const s = schedules.get(campaign.campaignId);
        console.log(
          `[dialer] ${campaign.campaignId} fuera del horario de atención · ${
            s ? describeSchedule(s) : describeWindow(campaign)
          }`,
        );
        continue;
      }
      // Pilar 7 — meta alcanzada → completar y saltar (no marca más).
      if (goalReached(campaign)) {
        console.log(
          `[dialer] ${campaign.campaignId} meta alcanzada (${campaign.goalType}=${campaign.goalTarget}) → completar`,
        );
        await forceCompleteCampaign(campaign, "goal");
        continue;
      }
      // Resolver el Connect del tenant dueño de esta campaña. Si no hay tenantId
      // (campañas legacy pre-#43) o no tiene Connect configurado, caemos al
      // Connect de Vox (transición). Las campañas se procesan SERIALMENTE, así
      // que mutar las vars module-active aquí es seguro.
      {
        const tc = campaign.tenantId ? await getTenantConnect(campaign.tenantId) : null;
        if (tc) {
          activeConnect = tc.client;
          activeInstanceId = tc.instanceId;
          // #46: tabla de campaigns/campaign-contacts también en cuenta del tenant.
          dynamo = tc.dynamo;
        } else {
          activeConnect = legacyConnect;
          dynamo = legacyDynamo;
          activeInstanceId = INSTANCE_ID;
        }
      }
      // WhatsApp: ruta dedicada (envía template, sin agentes ni ciclo de voz).
      if ((campaign.campaignType || "voice").toLowerCase() === "whatsapp") {
        await processCampaignWhatsApp(campaign);
        if ((await countPendingContacts(campaign.campaignId)) > 0) anyPendingLeft = true;
        continue;
      }
      // FIX 4: reaper de VOZ — recicla filas colgadas en `dialing` (evento de
      // Connect perdido o linkConnectContact fallido) ANTES de calcular buckets y
      // marcar, para liberar el inFlight del agente y redistribuir su bucket este
      // mismo tick. `dynamo` ya quedó scopeado al tenant dueño (resuelto arriba).
      await reclaimStaleVoiceDialing(campaign.campaignId);
      const assignedAgentIds = await getAssignedAgents(campaign.campaignId);
      const useBuckets = campaign.dialMode !== "agentless" && assignedAgentIds.length > 0;
      // Pilar 7 — presupuesto de slots de este ciclo (si hubo reparto por peso).
      const slotOverride = slotBudget.get(campaign.campaignId);
      if (useBuckets) {
        // Modo bucket (agentes): el ritmo lo dan los agentes, sin tope de pool.
        await processCampaignWithBuckets(campaign, assignedAgentIds);
      } else {
        // Modo pool / agentless (dormido): conserva el presupuesto de orquestación.
        await processCampaignLegacy(campaign, slotOverride);
      }
      const pending = await countPendingContacts(campaign.campaignId);
      if (pending > 0) anyPendingLeft = true;
    } catch (err) {
      // FIX 1: una campaña que falla NO debe frenar a las demás del tick.
      console.error(`dialCycle: campaña ${campaign.campaignId} falló`, err);
    }
  }
  return { campaignsProcessed: campaigns.length, anyPendingLeft };
}

export const handler: Handler<DialerEvent> = async () => {
  const start = Date.now();
  try {
    let cyclesRun = 0;
    let lastProcessed = 0;
    for (let i = 0; i < SUB_TICK_COUNT; i++) {
      const { campaignsProcessed, anyPendingLeft } = await dialCycle();
      cyclesRun++;
      lastProcessed = campaignsProcessed;
      console.log(
        `[dialer] cycle ${i + 1}/${SUB_TICK_COUNT} · campaigns=${campaignsProcessed} · pending=${anyPendingLeft}`,
      );
      // Exit early when there's nothing to do — no point burning
      // duration time sleeping if every campaign is drained.
      if (campaignsProcessed === 0 || !anyPendingLeft) break;
      // Don't sleep after the LAST cycle.
      if (i === SUB_TICK_COUNT - 1) break;
      // Stop early if we're about to overflow our duration budget.
      if (Date.now() - start + SUB_TICK_INTERVAL_MS > HANDLER_BUDGET_MS) {
        console.log("[dialer] budget reached — skipping remaining cycles");
        break;
      }
      await new Promise((r) => setTimeout(r, SUB_TICK_INTERVAL_MS));
    }
    return {
      ok: true,
      campaignsProcessed: lastProcessed,
      cyclesRun,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    console.error("dialer error", err);
    throw err;
  }
};
