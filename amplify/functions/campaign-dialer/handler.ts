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

const dynamo = new DynamoDBClient({});
const connect = new ConnectClient({ maxAttempts: 1 });
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
    return hour >= campaign.windowStartHour && hour < campaign.windowEndHour;
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
  // Bump failed counter on campaign
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: c.campaignId } },
        UpdateExpression:
          "ADD failedCount :one, pendingCount :neg",
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

async function startOutbound(
  campaign: Campaign,
  contact: CampaignContact
): Promise<string | null> {
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

export const handler: Handler = async () => {
  try {
    const campaigns = await listRunningCampaigns();
    console.log(`[dialer] running campaigns: ${campaigns.length}`);

    if (campaigns.length === 0) {
      return { ok: true, campaignsProcessed: 0 };
    }

    for (const campaign of campaigns) {
      // Check time window
      if (!isWithinWindow(campaign)) {
        console.log(`[dialer] ${campaign.campaignId} outside calling window`);
        continue;
      }

      // Concurrency cap for this campaign
      const currentlyDialing = await countDialingForCampaign(campaign.campaignId);
      const maxConcurrency = Number(campaign.concurrency) || 1;
      const availableSlots = Math.max(0, maxConcurrency - currentlyDialing);

      const ratio = campaign.dialMode === "power" ? 2 : 1;
      let toDial: number;
      let slotsRemaining = 0;

      if (campaign.dialMode === "agentless") {
        toDial = availableSlots;
      } else {
        // Count agents specifically assigned to THIS campaign who are Available.
        // If none assigned, fall back to any Available user in the instance.
        const assignedIds = await getAssignedAgents(campaign.campaignId);
        const poolIds =
          assignedIds.length > 0 ? assignedIds : await listAllUserIds();
        slotsRemaining = await countAvailableFromUsers(poolIds);
        console.log(
          `[dialer] ${campaign.campaignId}: assigned=${assignedIds.length}, pool=${poolIds.length}, available=${slotsRemaining}`
        );
        // progressive: 1 dial per available agent. power: `ratio` dials per agent.
        toDial = Math.min(availableSlots, slotsRemaining * ratio);
      }
      if (toDial <= 0) continue;

      const candidates = await findPendingContacts(campaign.campaignId, toDial);
      if (candidates.length === 0) {
        // No eligible pending contacts → maybe all done
        await maybeCompleteCampaign(campaign);
        continue;
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
          // Each dial consumes 1/ratio of an agent slot (per-campaign counter).
          slotsRemaining -= 1 / ratio;
        }
        if (slotsRemaining <= 0 && campaign.dialMode !== "agentless") break;
      }
      // Best-effort rollback of any remaining over-claimed is skipped; the concurrency
      // cap + agent counter make over-dialing impossible in progressive mode.
      void rollbackToPending;
    }

    return { ok: true, campaignsProcessed: campaigns.length };
  } catch (err) {
    console.error("dialer error", err);
    throw err;
  }
};
