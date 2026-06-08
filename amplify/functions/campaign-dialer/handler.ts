import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
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
const CONTACTS_TABLE =
  process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
const CAMPAIGN_AGENTS_TABLE =
  process.env.CAMPAIGN_AGENTS_TABLE || "connectview-campaign-agents";
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
  /** When non-empty, the contact has been pre-assigned to that agent's
   *  bucket. The dialer will only route this contact to that specific
   *  agent — never to anyone else. */
  assignedAgentUserId?: string;
}

// Check whether we're inside the allowed calling window for the campaign timezone.
function isWithinWindow(campaign: Campaign): boolean {
  try {
    const allowedDays: number[] = JSON.parse(
      campaign.windowDaysOfWeek || "[1,2,3,4,5]"
    );
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: campaign.timezone || "America/Lima",
      hour: "2-digit",
      hour12: false,
      weekday: "short",
    });
    const parts = fmt.formatToParts(new Date());
    const hour = parseInt(
      parts.find((p) => p.type === "hour")?.value || "0"
    );
    const weekdayStr = parts.find((p) => p.type === "weekday")?.value || "";
    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const weekday = weekdayMap[weekdayStr] ?? -1;
    if (weekday < 0) return true; // if we can't determine, be permissive
    if (!allowedDays.includes(weekday)) return false;
    return (
      hour >= Number(campaign.windowStartHour) &&
      hour < Number(campaign.windowEndHour)
    );
  } catch {
    return true;
  }
}

async function listRunningCampaigns(): Promise<Campaign[]> {
  const res = await dynamo.send(
    new QueryCommand({
      TableName: CAMPAIGNS_TABLE,
      IndexName: "status-createdAt-index",
      KeyConditionExpression: "#st = :s",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: { ":s": { S: "RUNNING" } },
    })
  );
  return (res.Items || []).map((it) => unmarshall(it) as Campaign);
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
    })
  );
  return res.Count || 0;
}

async function findPendingContacts(
  campaignId: string,
  limit: number
): Promise<CampaignContact[]> {
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
      FilterExpression:
        "attribute_not_exists(nextRetryAt) OR nextRetryAt <= :now",
      Limit: limit,
    })
  );
  const items = (res.Items || []).map(
    (it) => unmarshall(it) as CampaignContact
  );
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
      })
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
async function listAllPendingForCampaign(
  campaignId: string
): Promise<CampaignContact[]> {
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
        FilterExpression:
          "attribute_not_exists(nextRetryAt) OR nextRetryAt <= :now",
        ExclusiveStartKey: lastKey as never,
      })
    );
    for (const it of res.Items || [])
      out.push(unmarshall(it) as CampaignContact);
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
async function countAgentInFlight(
  campaignId: string,
  userId: string
): Promise<number> {
  let total = 0;
  for (const status of ["dialing", "connected"]) {
    try {
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
        })
      );
      total += res.Count || 0;
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
async function assignContactToAgent(
  contact: CampaignContact,
  userId: string
): Promise<boolean> {
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
      })
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
      })
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
    })
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
        })
      );
      for (const u of res.UserDataList || []) {
        const contacts = u.Contacts || [];
        if (
          u.Status?.StatusName === "Available" &&
          contacts.length === 0
        ) {
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
async function listIdleAvailableUsers(
  userIds: string[]
): Promise<Set<string>> {
  const idle = new Set<string>();
  if (userIds.length === 0) return idle;
  try {
    for (let i = 0; i < userIds.length; i += 100) {
      const batch = userIds.slice(i, i + 100);
      const res = await activeConnect.send(
        new GetCurrentUserDataCommand({
          InstanceId: activeInstanceId,
          Filters: { Agents: batch },
        })
      );
      for (const u of res.UserDataList || []) {
        const id = u.User?.Id;
        const contacts = u.Contacts || [];
        if (
          id &&
          u.Status?.StatusName === "Available" &&
          contacts.length === 0
        ) {
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
        UpdateExpression:
          "SET #st = :dialing, lastAttemptAt = :now, attempts = attempts + :one",
        ConditionExpression: "#st = :pending",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":dialing": { S: "dialing" },
          ":pending": { S: "pending" },
          ":now": { S: now },
          ":one": { N: "1" },
        },
      })
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
        })
      )
      .catch(() => {
        /* counter drift is acceptable — real source of truth is the rows */
      });
    return true;
  } catch (err) {
    // ConditionalCheckFailedException → another dialer grabbed it
    if (
      err instanceof Error &&
      err.name === "ConditionalCheckFailedException"
    ) {
      return false;
    }
    throw err;
  }
}

async function markAsFailed(
  c: CampaignContact,
  reason: string
): Promise<void> {
  const now = new Date().toISOString();
  await dynamo.send(
    new UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: c.campaignId },
        rowId: { S: c.rowId },
      },
      UpdateExpression:
        "SET #st = :failed, lastAttemptAt = :now, lastError = :err",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":failed": { S: "failed" },
        ":now": { S: now },
        ":err": { S: reason.slice(0, 500) },
      },
    })
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
        UpdateExpression:
          "ADD failedCount :one, dialingCount :neg",
        ExpressionAttributeValues: {
          ":one": { N: "1" },
          ":neg": { N: "-1" },
        },
      })
    )
    .catch(() => {
      /* counter drift is OK, authoritative counts via Query */
    });
}

/** Marca un contacto de WhatsApp como ENVIADO (terminal). No hay eventos de
 *  Connect para WhatsApp, así que cerramos el contacto acá mismo. */
async function markWhatsAppSent(
  c: CampaignContact,
  messageId: string
): Promise<void> {
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
    })
  );
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: c.campaignId } },
        UpdateExpression: "ADD doneCount :one, dialingCount :neg",
        ExpressionAttributeValues: { ":one": { N: "1" }, ":neg": { N: "-1" } },
      })
    )
    .catch(() => {
      /* counter drift is OK */
    });
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
      })
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
            ExpressionAttributeValues: { ":pending": { S: "pending" }, ":dialing": { S: "dialing" } },
          })
        );
        // Espejar contadores (dialing→pending) para que la lista no quede desfasada.
        await dynamo
          .send(
            new UpdateItemCommand({
              TableName: CAMPAIGNS_TABLE,
              Key: { campaignId: { S: campaignId } },
              UpdateExpression: "ADD dialingCount :neg, pendingCount :one",
              ExpressionAttributeValues: { ":neg": { N: "-1" }, ":one": { N: "1" } },
            })
          )
          .catch(() => { /* drift aceptable, fuente real son las filas */ });
        reclaimed++;
      } catch (e) {
        // Otro tick lo movió primero → ignorar.
        if (!(e instanceof Error && e.name === "ConditionalCheckFailedException")) throw e;
      }
    }
  } catch (err) {
    console.error("reclaimStaleWhatsAppDialing error:", err);
  }
  if (reclaimed > 0) console.log(`reclaimed ${reclaimed} stale dialing contacts (whatsapp) for ${campaignId}`);
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
    const messageId = await sendWhatsAppTemplate(campaign, contact);
    if (messageId) {
      await markWhatsAppSent(contact, messageId);
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
async function sendWhatsAppTemplate(
  campaign: Campaign,
  contact: CampaignContact
): Promise<string | null> {
  if (!campaign.templateName) {
    console.error("whatsapp campaign missing templateName");
    return null;
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
    return null;
  }
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    };
    if (!r.ok || !body.sent) {
      console.error(
        "WhatsApp template send failed:",
        body.error || `HTTP ${r.status}`
      );
      return null;
    }
    return body.messageId || `wa-${Date.now()}-${contact.rowId.slice(0, 6)}`;
  } catch (err) {
    console.error("WhatsApp template fetch failed:", err);
    return null;
  }
}

async function startOutbound(
  campaign: Campaign,
  contact: CampaignContact
): Promise<string | null> {
  // Route to the right dispatcher based on campaign type.
  if ((campaign.campaignType || "voice").toLowerCase() === "whatsapp") {
    return sendWhatsAppTemplate(campaign, contact);
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
          .map(([k, v]) => [k.slice(0, 127), String(v).slice(0, 256)])
      ),
    };

    // If AMD is enabled and we have a dedicated AMD flow, use it in place of
    // the admin-selected flow. The AMD flow runs CheckOutboundCallStatus first
    // and only transfers to the queue on CallAnswered. Voicemails and no-answer
    // are hung up before an agent ever sees the call.
    //
    // IMPORTANT (2026): Outbound Campaigns v2 is required for Peru is NOT
    // supported by AWS (only US, MX, BR from us-east-1). So we keep
    // TrafficType=GENERAL (default) + AnswerMachineDetectionConfig on the
    // StartOutboundVoiceContact itself — this DOES work for Peru.
    const useAmd = AMD_ENABLED && !!AMD_FLOW_ID;
    const contactFlowId = useAmd ? AMD_FLOW_ID : campaign.contactFlowId;

    const res = await activeConnect.send(
      new StartOutboundVoiceContactCommand({
        InstanceId: activeInstanceId,
        ContactFlowId: contactFlowId,
        DestinationPhoneNumber: contact.phone,
        SourcePhoneNumber: campaign.sourcePhoneNumber,
        Attributes: attributes,
        ClientToken:
          `${contact.rowId}-${contact.attempts}-${Date.now()}`.slice(0, 500),
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
      })
    );
    return res.ContactId || null;
  } catch (err) {
    console.error("StartOutboundVoiceContact failed:", err);
    return null;
  }
}

async function linkConnectContact(
  c: CampaignContact,
  connectContactId: string
): Promise<void> {
  await dynamo.send(
    new UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: c.campaignId },
        rowId: { S: c.rowId },
      },
      UpdateExpression: "SET connectContactId = :cid",
      ExpressionAttributeValues: { ":cid": { S: connectContactId } },
    })
  );
}

async function rollbackToPending(c: CampaignContact): Promise<void> {
  // Decrement attempts in case we want to retry later and cap attempts.
  await dynamo.send(
    new UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: c.campaignId },
        rowId: { S: c.rowId },
      },
      UpdateExpression: "SET #st = :pending",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: { ":pending": { S: "pending" } },
    })
  );
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
      })
    );
    total += r.Count || 0;
  }
  if (total === 0) {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaign.campaignId } },
        UpdateExpression:
          "SET #st = :c, completedAt = :now",
        ConditionExpression: "#st = :running",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":c": { S: "COMPLETED" },
          ":running": { S: "RUNNING" },
          ":now": { S: new Date().toISOString() },
        },
      })
    ).catch(() => { /* already not running, ignore */ });
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
  assignedAgentIds: string[]
): Promise<void> {
  const maxPerAgent = Math.max(
    1,
    Math.min(50, Number(campaign.maxContactsPerAgent) || 5)
  );

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
  // FIFO: oldest contact first within each bucket and the pool.
  const byCreatedAt = (a: CampaignContact, b: CampaignContact) =>
    (a.createdAt || "").localeCompare(b.createdAt || "");
  for (const list of buckets.values()) list.sort(byCreatedAt);
  unassigned.sort(byCreatedAt);

  // 3. Refill each agent's bucket up to maxPerAgent + remember the in-flight
  //    count so the dial step can reuse it without re-querying.
  const inFlightByAgent = new Map<string, number>();
  for (const userId of assignedAgentIds) {
    const inFlight = await countAgentInFlight(campaign.campaignId, userId);
    inFlightByAgent.set(userId, inFlight);
    const bucketSize = buckets.get(userId)?.length || 0;
    const need = Math.max(0, maxPerAgent - bucketSize - inFlight);
    if (need <= 0 || unassigned.length === 0) continue;
    const toClaim = unassigned.splice(0, need);
    for (const c of toClaim) {
      const ok = await assignContactToAgent(c, userId);
      if (ok) {
        c.assignedAgentUserId = userId;
        if (!buckets.has(userId)) buckets.set(userId, []);
        buckets.get(userId)!.push(c);
      }
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
    console.log(
      `[dialer] ${campaign.campaignId}: manual mode · buckets ready, no auto-dial`
    );
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
    `[dialer] ${campaign.campaignId}: bucket-mode · agents=${assignedAgentIds.length}, idle=${idleSet.size}, unassignedLeft=${unassigned.length}`
  );

  // Concurrency cap still applies (campaign-level safety).
  const currentlyDialing = await countDialingForCampaign(campaign.campaignId);
  const maxConcurrency = Number(campaign.concurrency) || 1;
  let slotsLeft = Math.max(0, maxConcurrency - currentlyDialing);

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
    const connectContactId = await startOutbound(campaign, next);
    if (!connectContactId) {
      await markAsFailed(next, "StartOutboundVoiceContact returned null");
      continue;
    }
    await linkConnectContact(next, connectContactId);
    dialedAny = true;
    slotsLeft -= 1;
    // Bump our local counter so a subsequent iteration in this same tick
    // doesn't try to dial again for the same agent.
    inFlightByAgent.set(userId, (inFlightByAgent.get(userId) || 0) + 1);
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
async function processCampaignLegacy(campaign: Campaign): Promise<void> {
  const currentlyDialing = await countDialingForCampaign(campaign.campaignId);
  const maxConcurrency = Number(campaign.concurrency) || 1;
  const availableSlots = Math.max(0, maxConcurrency - currentlyDialing);

  const ratio = campaign.dialMode === "power" ? 2 : 1;
  let toDial: number;
  let slotsRemaining = 0;

  if (campaign.dialMode === "agentless") {
    toDial = availableSlots;
  } else {
    const poolIds = await listAllUserIds();
    slotsRemaining = await countAvailableFromUsers(poolIds);
    console.log(
      `[dialer] ${campaign.campaignId}: legacy · pool=${poolIds.length}, available=${slotsRemaining}`
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
    const connectContactId = await startOutbound(campaign, contact);
    if (!connectContactId) {
      await markAsFailed(contact, "StartOutboundVoiceContact returned null");
      continue;
    }
    await linkConnectContact(contact, connectContactId);
    if (campaign.dialMode !== "agentless") {
      slotsRemaining -= 1 / ratio;
    }
    if (slotsRemaining <= 0 && campaign.dialMode !== "agentless") break;
  }
  void rollbackToPending;
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

/** Run one dial cycle across all RUNNING campaigns. Extracted so the
 *  handler can call it N times per invocation. Returns true when there
 *  is still work pending (so we keep cycling) and false when every
 *  campaign is drained (so we can exit early and save duration cost). */
async function dialCycle(): Promise<{
  campaignsProcessed: number;
  anyPendingLeft: boolean;
}> {
  const campaigns = await listRunningCampaigns();
  if (campaigns.length === 0) {
    return { campaignsProcessed: 0, anyPendingLeft: false };
  }
  let anyPendingLeft = false;
  for (const campaign of campaigns) {
    if (!isWithinWindow(campaign)) {
      console.log(`[dialer] ${campaign.campaignId} outside calling window`);
      continue;
    }
    // Resolver el Connect del tenant dueño de esta campaña. Si no hay tenantId
    // (campañas legacy pre-#43) o no tiene Connect configurado, caemos al
    // Connect de Vox (transición). Las campañas se procesan SERIALMENTE, así
    // que mutar las vars module-active acá es seguro.
    {
      const tc = campaign.tenantId
        ? await getTenantConnect(campaign.tenantId)
        : null;
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
    const assignedAgentIds = await getAssignedAgents(campaign.campaignId);
    const useBuckets =
      campaign.dialMode !== "agentless" && assignedAgentIds.length > 0;
    if (useBuckets) {
      await processCampaignWithBuckets(campaign, assignedAgentIds);
    } else {
      await processCampaignLegacy(campaign);
    }
    const pending = await countPendingContacts(campaign.campaignId);
    if (pending > 0) anyPendingLeft = true;
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
        `[dialer] cycle ${i + 1}/${SUB_TICK_COUNT} · campaigns=${campaignsProcessed} · pending=${anyPendingLeft}`
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
