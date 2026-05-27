import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ConnectClient,
  StartOutboundVoiceContactCommand,
  GetCurrentUserDataCommand,
  ListUsersCommand,
} from "@aws-sdk/client-connect";
import {
  LambdaClient,
  InvokeCommand,
  InvocationType,
} from "@aws-sdk/client-lambda";

const dynamo = new DynamoDBClient({});
const connect = new ConnectClient({ maxAttempts: 1 });
const lambda = new LambdaClient({});
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CONTACTS_TABLE =
  process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
const CAMPAIGN_AGENTS_TABLE =
  process.env.CAMPAIGN_AGENTS_TABLE || "connectview-campaign-agents";
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
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
// GetCurrentUserData (which requires one filter). Cached within the warm container.
let allUserIdsCache: string[] | null = null;
async function listAllUserIds(): Promise<string[]> {
  if (allUserIdsCache) return allUserIdsCache;
  const ids: string[] = [];
  let nextToken: string | undefined;
  do {
    const res = await connect.send(
      new ListUsersCommand({
        InstanceId: INSTANCE_ID,
        MaxResults: 100,
        NextToken: nextToken,
      })
    );
    for (const u of res.UserSummaryList || []) {
      if (u.Id) ids.push(u.Id);
    }
    nextToken = res.NextToken;
  } while (nextToken);
  allUserIdsCache = ids;
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
      const res = await connect.send(
        new GetCurrentUserDataCommand({
          InstanceId: INSTANCE_ID,
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
      const res = await connect.send(
        new GetCurrentUserDataCommand({
          InstanceId: INSTANCE_ID,
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

    const res = await connect.send(
      new StartOutboundVoiceContactCommand({
        InstanceId: INSTANCE_ID,
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

// Maximum chain depth — each invocation can self-invoke up to this many
// times before the EventBridge tick takes over again. With chain depth 6
// the worst-case sub-second gap covers the first 6 contacts after a
// terminal call; the 7th waits for the next minute tick. In practice we
// only chain while we keep dialing, so the depth caps runaway not
// throughput.
const MAX_CHAIN_DEPTH = 6;
// Tiny pause between chain links so DynamoDB has time to commit the
// markAsDialing UpdateItem and so Connect's user data API reflects the
// new state. Without this, the next chain link sees stale data and
// thinks the agent is still idle.
const CHAIN_DELAY_MS = 2000;

interface DialerEvent {
  /** Set by self-invocations to track chain depth. Absent on EventBridge ticks. */
  chainDepth?: number;
}

async function selfInvoke(depth: number): Promise<void> {
  const fnName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!fnName) {
    console.warn("[dialer] AWS_LAMBDA_FUNCTION_NAME unset — skipping chain");
    return;
  }
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: fnName,
        InvocationType: InvocationType.Event, // fire-and-forget
        Payload: new TextEncoder().encode(
          JSON.stringify({ chainDepth: depth } satisfies DialerEvent)
        ),
      })
    );
    console.log(`[dialer] chained self at depth=${depth}`);
  } catch (err) {
    console.error("[dialer] chain self-invoke failed:", err);
  }
}

export const handler: Handler<DialerEvent> = async (event) => {
  const chainDepth = event?.chainDepth ?? 0;
  try {
    const campaigns = await listRunningCampaigns();
    console.log(
      `[dialer] running campaigns: ${campaigns.length} · chainDepth=${chainDepth}`
    );

    if (campaigns.length === 0) {
      return { ok: true, campaignsProcessed: 0 };
    }

    // Track whether this tick made progress AND still has more to do.
    // If so, we chain ourselves so the next contact dials in seconds
    // instead of waiting up to 60s for the next EventBridge tick.
    let anyProgressInTick = false;
    let anyPendingLeft = false;

    for (const campaign of campaigns) {
      // Check time window
      if (!isWithinWindow(campaign)) {
        console.log(`[dialer] ${campaign.campaignId} outside calling window`);
        continue;
      }

      const assignedAgentIds = await getAssignedAgents(campaign.campaignId);
      const useBuckets =
        campaign.dialMode !== "agentless" && assignedAgentIds.length > 0;

      const before = await countPendingContacts(campaign.campaignId);

      if (useBuckets) {
        await processCampaignWithBuckets(campaign, assignedAgentIds);
      } else {
        // No assigned agents or agentless mode → original behavior.
        await processCampaignLegacy(campaign);
      }

      const after = await countPendingContacts(campaign.campaignId);
      if (after < before) anyProgressInTick = true;
      if (after > 0) anyPendingLeft = true;
    }

    // Chain ourselves if (a) we made progress (so the bottleneck is the
    // 60s tick, not agent availability) and (b) there's still pending
    // work and (c) we haven't exceeded the safety cap.
    if (
      anyProgressInTick &&
      anyPendingLeft &&
      chainDepth < MAX_CHAIN_DEPTH
    ) {
      // Brief wait so DynamoDB writes propagate before the next link reads.
      await new Promise((r) => setTimeout(r, CHAIN_DELAY_MS));
      await selfInvoke(chainDepth + 1);
    }

    return {
      ok: true,
      campaignsProcessed: campaigns.length,
      chainDepth,
      chained: anyProgressInTick && anyPendingLeft,
    };
  } catch (err) {
    console.error("dialer error", err);
    throw err;
  }
};
