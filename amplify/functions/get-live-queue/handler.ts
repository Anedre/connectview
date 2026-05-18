import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  GetCurrentUserDataCommand,
  SearchContactsCommand,
  DescribeContactCommand,
  DescribeUserCommand,
  DescribeQueueCommand,
  ListUsersCommand,
  ListQueuesCommand,
  ListAgentStatusesCommand,
  ListRoutingProfileQueuesCommand,
} from "@aws-sdk/client-connect";
import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const connect = new ConnectClient({ maxAttempts: 1 });
const dynamo = new DynamoDBClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const CONTACTS_TABLE = process.env.CONTACTS_TABLE || "connectview-contacts";
const CAMPAIGN_CONTACTS_TABLE =
  process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
const CAMPAIGNS_TABLE =
  process.env.CAMPAIGNS_TABLE || "connectview-campaigns";

// How recently a contact must have been initiated to count as "ARRIVED"
const ARRIVED_WINDOW_SEC = 10;
// How long a disconnected contact stays visible in the "FINISHED" stage
const FINISHED_WINDOW_MS = 10 * 60 * 1000;

// Caches for metadata that doesn't change often.
const userCache = new Map<string, string>();
const queueNameCache = new Map<string, string>();
// routingProfileId → list of { id, name } queues. Cached across warm invokes.
const routingProfileQueuesCache = new Map<
  string,
  { id: string; name: string }[]
>();

async function resolveUser(id: string): Promise<string> {
  if (!id) return "";
  if (userCache.has(id)) return userCache.get(id)!;
  try {
    const r = await connect.send(
      new DescribeUserCommand({ InstanceId: INSTANCE_ID, UserId: id })
    );
    const name = r.User?.Username || id;
    userCache.set(id, name);
    return name;
  } catch {
    userCache.set(id, id);
    return id;
  }
}

async function resolveQueue(id: string): Promise<string> {
  if (!id) return "";
  if (queueNameCache.has(id)) return queueNameCache.get(id)!;
  try {
    const r = await connect.send(
      new DescribeQueueCommand({ InstanceId: INSTANCE_ID, QueueId: id })
    );
    const name = r.Queue?.Name || id;
    queueNameCache.set(id, name);
    return name;
  } catch {
    queueNameCache.set(id, id);
    return id;
  }
}

interface AgentView {
  userId: string;
  username: string;
  statusName: string | null;
  statusStartTimestamp: string | null;
  routingProfile: string | null;
  routingProfileId?: string | null;
  /** Queues attached to this agent's routing profile (for VOICE only). */
  queues?: { id: string; name: string }[];
  // What they're doing right now
  activeContact: {
    contactId: string;
    phone: string | null;
    state: string;
    channel: string;
    queueName: string | null;
    connectedToAgentTimestamp: string | null;
  } | null;
  /** Live pipeline stats for this agent. */
  stats?: {
    /** Contacts currently in this agent's queues waiting for pickup. */
    queuedForMe: number;
    /** Contacts this agent handled today (all channels). */
    completedToday: number;
    /** Contacts today that ended in error / no answer / abandoned. */
    errorsToday: number;
  };
}

interface QueuedContactView {
  contactId: string;
  phone: string | null;
  customerName?: string | null;
  channel: string;
  queueId: string | null;
  queueName: string | null;
  initiationMethod: string;
  initiationTimestamp: string | null;
  /**
   * Which bucket the contact is currently in. The pipeline UI uses this.
   *  - ARRIVED: very recently initiated, no flow state yet
   *  - IN_IVR:  flow running, no queueId assigned yet
   *  - IN_QUEUE: queued, waiting for an agent
   *  - WITH_AGENT: connected to an agent (rendered from the agent side)
   *  - FINISHED: disconnected, shown for a short grace window
   *  - PENDING_TRANSFER / INCOMING / CONNECTING kept for backward compat
   */
  state:
    | "ARRIVED"
    | "IN_IVR"
    | "IN_QUEUE"
    | "WITH_AGENT"
    | "FINISHED"
    | "CONNECTING"
    | "INCOMING"
    | "PENDING_TRANSFER";
  /** Timestamp the contact entered the current stage. */
  stageEnteredAt: string | null;
  waitingSeconds: number;
  /** If FINISHED, why it disconnected. */
  disconnectReason?: string | null;
  /** If WITH_AGENT, who took it. */
  agentUsername?: string | null;
  /** Used to animate from one stage to the next without reshuffling the node. */
  sortKey: string;
  /** Campaign row ID this contact is tied to (if it's a campaign call). */
  campaignRowId?: string | null;
  /** How many dial attempts this row has had (from connectview-campaign-contacts). */
  retryCount?: number | null;
  /** If the row has been pre-assigned to a specific agent's bucket, the
   *  agent user ID is exposed here. Used by the FlowView to render the
   *  pending contact under that agent's column instead of in the global
   *  "Pendientes" block. */
  assignedAgentUserId?: string | null;
}

async function resolveRoutingProfileQueues(
  routingProfileId: string
): Promise<{ id: string; name: string }[]> {
  if (!routingProfileId) return [];
  if (routingProfileQueuesCache.has(routingProfileId)) {
    return routingProfileQueuesCache.get(routingProfileId)!;
  }
  try {
    const res = await connect.send(
      new ListRoutingProfileQueuesCommand({
        InstanceId: INSTANCE_ID,
        RoutingProfileId: routingProfileId,
        MaxResults: 100,
      })
    );
    // Deduplicate by queueId (multiple entries for VOICE/CHAT/EMAIL/TASK).
    const seen = new Set<string>();
    const queues: { id: string; name: string }[] = [];
    for (const q of res.RoutingProfileQueueConfigSummaryList || []) {
      if (!q.QueueId || seen.has(q.QueueId)) continue;
      seen.add(q.QueueId);
      queues.push({ id: q.QueueId, name: q.QueueName || q.QueueId });
    }
    routingProfileQueuesCache.set(routingProfileId, queues);
    return queues;
  } catch (err) {
    console.warn("ListRoutingProfileQueues failed:", err);
    routingProfileQueuesCache.set(routingProfileId, []);
    return [];
  }
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Campaign rows that will be dialed again. These don't live in Connect yet —
 * they're rows in connectview-campaign-contacts that the campaign-dialer
 * Lambda will re-attempt on its next tick. We surface up to 25 so the UI
 * can show a "Reencoladas" bucket.
 */
/**
 * Pull recently-finished contacts from our analytics table. This is a
 * backstop for Connect's `DescribeContact` which starts returning 404
 * shortly after disconnect — by joining DynamoDB we can still surface
 * the call in the right "Completadas / No contestadas / Errores /
 * Abandonadas" bucket for the 10 min window the UI shows.
 */
/**
 * Map a campaign-contacts row status to a Connect-style disconnectReason
 * so the UI can bucket it into Completadas / No contestadas / Errores / etc.
 */
function statusToReason(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "done") return "AGENT_DISCONNECT"; // → Completadas
  if (s === "no_answer") return "NO_USER_RESPONSE"; // → No contestadas
  if (s === "failed") return "OUTBOUND_ATTEMPT_FAILED"; // → Errores
  if (s === "cancelled") return "CUSTOMER_DISCONNECT_ABANDONED"; // → Abandonadas
  return "UNKNOWN";
}

async function fetchRecentlyFinishedFromDynamo(): Promise<QueuedContactView[]> {
  const sinceMs = Date.now() - FINISHED_WINDOW_MS;
  const since = new Date(sinceMs).toISOString();
  const out: QueuedContactView[] = [];
  const seen = new Set<string>();

  // 1) Primary source for campaign calls: the campaign-contacts table.
  //    This has the accurate per-attempt status (done / no_answer / failed /
  //    cancelled) AND the campaignId stamp so per-campaign FlowView cards can
  //    filter their Finished buckets.
  try {
    const res = await dynamo.send(
      new ScanCommand({
        TableName: CAMPAIGN_CONTACTS_TABLE,
        FilterExpression:
          "#s IN (:done, :noans, :failed, :cancelled) AND lastAttemptAt >= :since",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":done": { S: "done" },
          ":noans": { S: "no_answer" },
          ":failed": { S: "failed" },
          ":cancelled": { S: "cancelled" },
          ":since": { S: since },
        },
        Limit: 200,
      })
    );
    for (const raw of res.Items || []) {
      const row = unmarshall(raw);
      const cid = row.connectContactId;
      if (!cid) continue;
      seen.add(cid);
      out.push({
        contactId: cid,
        phone: (row.phone as string) || null,
        customerName: (row.customerName as string) || null,
        channel: "VOICE",
        queueId: null,
        queueName: null,
        initiationMethod: "CAMPAIGN",
        initiationTimestamp: (row.createdAt as string) || null,
        state: "FINISHED",
        stageEnteredAt:
          (row.lastAttemptAt as string) || (row.createdAt as string) || since,
        waitingSeconds: 0,
        disconnectReason: statusToReason(row.status as string),
        agentUsername: null,
        sortKey: (row.lastAttemptAt as string) || since,
        campaignRowId: (row.rowId as string) || null,
        retryCount: Number(row.attempts) || 0,
        campaignId: (row.campaignId as string) || null,
      } as QueuedContactView & { campaignId?: string | null });
    }
  } catch (err) {
    console.warn("fetchRecentlyFinishedFromDynamo[campaign] failed:", err);
  }

  // 2) Secondary source: generic analytics for inbound / non-campaign calls.
  //    Skip anything we already got via campaign-contacts (identity = cid).
  try {
    const res = await dynamo.send(
      new ScanCommand({
        TableName: CONTACTS_TABLE,
        FilterExpression: "initiationTimestamp >= :since",
        ExpressionAttributeValues: {
          ":since": { S: since },
        },
        Limit: 100,
      })
    );
    for (const raw of res.Items || []) {
      const row = unmarshall(raw);
      const disc = row.disconnectTimestamp || row.lastUpdateTimestamp;
      if (!disc) continue;
      const cid = row.contactId as string;
      if (!cid || seen.has(cid)) continue;
      const reason = (row.disconnectReason as string) || "UNKNOWN";
      out.push({
        contactId: cid,
        phone: (row.customerPhone as string) || null,
        customerName: (row.customerName as string) || null,
        channel: (row.channel as string) || "VOICE",
        queueId: null,
        queueName: (row.queueName as string) || null,
        initiationMethod: (row.initiationMethod as string) || "",
        initiationTimestamp: (row.initiationTimestamp as string) || null,
        state: "FINISHED",
        stageEnteredAt: disc,
        waitingSeconds: 0,
        disconnectReason: reason,
        agentUsername: (row.agentUsername as string) || null,
        sortKey: (row.initiationTimestamp as string) || disc,
        campaignRowId: null,
        retryCount: 0,
      } as QueuedContactView);
    }
  } catch (err) {
    console.warn("fetchRecentlyFinishedFromDynamo[analytics] failed:", err);
  }

  return out;
}

/**
 * Campaign rows currently being dialed. Connect's SearchContacts takes a few
 * seconds to index a freshly-dialed contact, so we surface them from our own
 * DynamoDB as synthetic ARRIVED bubbles in the meantime. Once SearchContacts
 * catches up, the real contact takes over (we de-dupe on contactId).
 */
/**
 * For every RUNNING/PAUSED campaign, pull its pending + dialing rows from
 * DynamoDB and expose them as two synthetic stages. These feed the
 * "Pendientes" and "Marcando" blocks that replace the inbound-oriented
 * "Llegada / IVR" labels for campaign graphs.
 *
 * IMPORTANT: We filter out rows belonging to campaigns that are not currently
 * active (DRAFT/COMPLETED/CANCELLED). Without this guard, a cancelled
 * campaign's pending rows leak into the live queue forever — the cancel
 * action only flips the campaign meta status and doesn't touch the row
 * statuses, so they remain "pending" in the DB.
 */
/**
 * Returns `null` when we couldn't determine the active set (IAM denied, etc.) —
 * callers treat null as "skip the filter" so the live queue degrades to its
 * pre-filter behaviour instead of hiding every pending row. When we DO have
 * a definitive answer, returns the Set (possibly empty if no campaigns are
 * running/paused).
 */
async function fetchActiveCampaignIds(): Promise<Set<string> | null> {
  const active = new Set<string>();
  try {
    for (const status of ["RUNNING", "PAUSED"]) {
      const res = await dynamo.send(
        new QueryCommand({
          TableName: CAMPAIGNS_TABLE,
          IndexName: "status-createdAt-index",
          KeyConditionExpression: "#st = :s",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: { ":s": { S: status } },
        })
      );
      for (const it of res.Items || []) {
        const row = unmarshall(it);
        if (row.campaignId) active.add(row.campaignId as string);
      }
    }
    return active;
  } catch (err) {
    // Most common failure mode: the Lambda role doesn't have
    // dynamodb:Query on the campaigns table. Rather than silently hiding
    // every row, we surface a null so the caller skips the filter.
    console.warn("fetchActiveCampaignIds failed (returning null):", err);
    return null;
  }
}

async function fetchCampaignPendingAndDialing(): Promise<{
  pending: QueuedContactView[];
  dialing: QueuedContactView[];
}> {
  const pending: QueuedContactView[] = [];
  const dialing: QueuedContactView[] = [];
  // Resolve which campaigns are currently active so we can filter the scan
  // results client-side. We could push this into a per-campaign Query loop
  // but Scan is fine at the current scale (≤500 active rows total).
  // When `null` we couldn't determine the active set (likely IAM denied)
  // and we DON'T filter — falling back to the pre-filter behaviour so the
  // live queue still works even with reduced permissions.
  const activeCampaignIds = await fetchActiveCampaignIds();
  try {
    const res = await dynamo.send(
      new ScanCommand({
        TableName: CAMPAIGN_CONTACTS_TABLE,
        FilterExpression: "#s = :p OR #s = :d",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":p": { S: "pending" },
          ":d": { S: "dialing" },
        },
        Limit: 500,
      })
    );
    for (const raw of res.Items || []) {
      const row = unmarshall(raw);
      const campaignId = row.campaignId as string;
      // Skip rows from campaigns that are not currently RUNNING/PAUSED. This
      // is the root cause of the "zombie pending rows" bug. Only applies
      // when we successfully determined which campaigns are active.
      if (
        activeCampaignIds !== null &&
        campaignId &&
        !activeCampaignIds.has(campaignId)
      )
        continue;
      const status = row.status as string;
      const rowId = row.rowId as string;
      const cid = (row.connectContactId as string) || `row-${rowId}`;
      const view: QueuedContactView & { campaignId?: string | null } = {
        contactId: cid,
        phone: (row.phone as string) || null,
        customerName: (row.customerName as string) || null,
        channel: "VOICE",
        queueId: null,
        queueName: null,
        initiationMethod: "CAMPAIGN",
        initiationTimestamp:
          (row.lastAttemptAt as string) || (row.createdAt as string) || null,
        state: status === "dialing" ? "ARRIVED" : "IN_IVR", // reused frontend slots
        stageEnteredAt:
          (row.lastAttemptAt as string) || (row.createdAt as string) || null,
        waitingSeconds: 0,
        disconnectReason: null,
        agentUsername: null,
        sortKey: (row.lastAttemptAt as string) || (row.createdAt as string) || "",
        campaignRowId: rowId,
        retryCount: Number(row.attempts) || 0,
        campaignId: campaignId || null,
        assignedAgentUserId:
          (row.assignedAgentUserId as string) || null,
      };
      if (status === "dialing") dialing.push(view);
      else pending.push(view);
    }
  } catch (err) {
    console.warn("fetchCampaignPendingAndDialing failed:", err);
  }
  return { pending, dialing };
}

async function fetchRetryScheduled(
  activeCampaignIds?: Set<string> | null
): Promise<QueuedContactView[]> {
  // If the caller didn't pass a set of currently-active campaign ids, fetch
  // them so retry rows from cancelled/completed campaigns don't leak.
  // `null` means we couldn't determine the active set — skip the filter.
  const activeIds =
    activeCampaignIds !== undefined
      ? activeCampaignIds
      : await fetchActiveCampaignIds();
  try {
    // The original code used a Query on `status-createdAt-index`, but that
    // GSI doesn't exist on the campaign-contacts table — the query was
    // failing silently and the "Reencoladas" section was always empty.
    // A Scan with FilterExpression is more expensive but it's bounded to
    // 100 items and only runs when the live-queue is polled (every 3s
    // worst case). At realistic campaign sizes (<10k contacts) this is
    // cheaper than creating + waiting on a new GSI.
    const res = await dynamo.send(
      new ScanCommand({
        TableName: CAMPAIGN_CONTACTS_TABLE,
        FilterExpression: "#st = :p AND attempts > :zero",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":p": { S: "pending" },
          ":zero": { N: "0" },
        },
        Limit: 100,
      })
    );
    const out: QueuedContactView[] = [];
    for (const raw of res.Items || []) {
      const row = unmarshall(raw);
      const campaignId = row.campaignId as string | undefined;
      if (activeIds !== null && campaignId && !activeIds.has(campaignId))
        continue;
      out.push({
        contactId: `retry-${row.rowId}`,
        phone: (row.phone as string) || null,
        customerName: (row.customerName as string) || null,
        channel: "VOICE",
        queueId: null,
        queueName: null,
        initiationMethod: "CAMPAIGN",
        initiationTimestamp: (row.createdAt as string) || null,
        state: "FINISHED",
        stageEnteredAt: (row.lastAttemptAt as string) || null,
        waitingSeconds: 0,
        disconnectReason: "REQUEUED",
        agentUsername: null,
        sortKey: (row.lastAttemptAt as string) || "",
        campaignRowId: (row.rowId as string) || null,
        // campaignId is not part of the QueuedContactView interface, but we
        // attach it on the wire as an extra field so the frontend can filter
        // retryScheduled items per campaign.
        ...((row.campaignId && { campaignId: row.campaignId as string }) ||
          {}),
        retryCount: Number(row.attempts) || 0,
      });
    }
    return out.slice(0, 25);
  } catch (err) {
    console.warn("fetchRetryScheduled failed:", err);
    return [];
  }
}

/**
 * Query connectview-contacts for every contact this agent handled since
 * midnight. Returns per-status counts. Considered "error" if DisconnectReason
 * is one of the failure signals, or status is FAILED / MISSED / ABANDONED.
 */
async function getAgentDailyStats(
  agentKey: string
): Promise<{ completed: number; errors: number }> {
  // The "agentUsername" GSI actually stores the Connect user ID as its hash,
  // despite the attribute name. Callers pass the agent's userId here.
  if (!agentKey) return { completed: 0, errors: 0 };
  const since = startOfTodayIso();
  try {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: CONTACTS_TABLE,
        IndexName: "agentUsername-initiationTimestamp-index",
        KeyConditionExpression:
          "agentUsername = :u AND initiationTimestamp >= :since",
        ExpressionAttributeValues: {
          ":u": { S: agentKey },
          ":since": { S: since },
        },
        Limit: 500,
      })
    );
    let completed = 0;
    let errors = 0;
    for (const raw of res.Items || []) {
      const it = unmarshall(raw);
      const status = String(it.status || "").toUpperCase();
      const reason = String(it.disconnectReason || "").toUpperCase();
      if (
        status === "FAILED" ||
        status === "MISSED" ||
        status === "ABANDONED" ||
        reason === "CONTACT_FLOW_DISCONNECT" ||
        reason === "NO_USER_RESPONSE" ||
        reason === "CUSTOMER_DISCONNECT_ABANDONED" ||
        reason === "TELECOM_PROBLEM" ||
        reason === "OUTBOUND_DESTINATION_ENDPOINT_ERROR" ||
        reason === "OUTBOUND_RESOURCE_ERROR" ||
        reason === "OUTBOUND_ATTEMPT_FAILED"
      ) {
        errors++;
      } else if (status === "COMPLETED" || status === "DISCONNECTED") {
        completed++;
      }
    }
    return { completed, errors };
  } catch (err) {
    console.warn(`agent stats query failed for ${agentKey}:`, err);
    return { completed: 0, errors: 0 };
  }
}

// Cache routingProfileId per userId — doesn't change often.
const userRoutingProfileCache = new Map<string, string | null>();

async function getAgents(): Promise<AgentView[]> {
  // Step 1 — list all users (for usernames)
  const users = new Map<
    string,
    { username: string; routingProfileId?: string | null }
  >();
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
      if (u.Id && u.Username) users.set(u.Id, { username: u.Username });
    }
    nextToken = res.NextToken;
  } while (nextToken);

  // Step 1b — enrich every user with their routing profile ID. ListUsers
  // doesn't return it, and offline agents won't appear in GetCurrentUserData,
  // so DescribeUser is the reliable source. Cache per warm container.
  await Promise.all(
    [...users.entries()].map(async ([userId, meta]) => {
      if (userRoutingProfileCache.has(userId)) {
        meta.routingProfileId = userRoutingProfileCache.get(userId)!;
        return;
      }
      try {
        const du = await connect.send(
          new DescribeUserCommand({
            InstanceId: INSTANCE_ID,
            UserId: userId,
          })
        );
        const rid = du.User?.RoutingProfileId || null;
        userRoutingProfileCache.set(userId, rid);
        meta.routingProfileId = rid;
      } catch {
        meta.routingProfileId = null;
      }
    })
  );

  // Step 2 — call GetCurrentUserData for all users (chunks of 100 agents per call)
  const allAgents: AgentView[] = [];
  const userIds = [...users.keys()];
  for (let i = 0; i < userIds.length; i += 100) {
    const batch = userIds.slice(i, i + 100);
    try {
      const res = await connect.send(
        new GetCurrentUserDataCommand({
          InstanceId: INSTANCE_ID,
          Filters: { Agents: batch },
        })
      );
      for (const ud of res.UserDataList || []) {
        const userId = ud.User?.Id || "";
        const userMeta = users.get(userId);
        const username = userMeta?.username || userId;
        const contacts = ud.Contacts || [];
        const active = contacts.find((c) =>
          ["CONNECTED", "INCOMING", "CONNECTING", "ON_HOLD"].includes(
            c.ContactState || ""
          )
        );
        let activeContact: AgentView["activeContact"] = null;
        if (active) {
          const queueName = active.Queue?.Arn
            ? await resolveQueue(active.Queue.Arn.split("/").pop() || "")
            : active.Queue?.Name || null;
          activeContact = {
            contactId: active.ContactId || "",
            phone: active.CustomerEndpoint?.Address || null,
            state: active.ContactState || "",
            channel: active.Channel || "VOICE",
            queueName,
            connectedToAgentTimestamp:
              active.ConnectedToAgentTimestamp?.toISOString() || null,
          };
        }
        const routingProfileId =
          ud.RoutingProfile?.Id || userMeta?.routingProfileId || null;
        allAgents.push({
          userId,
          username,
          statusName: ud.Status?.StatusName || null,
          statusStartTimestamp:
            ud.Status?.StatusStartTimestamp?.toISOString() || null,
          routingProfile: ud.RoutingProfile?.Name || null,
          routingProfileId,
          activeContact,
        });
        users.delete(userId);
      }
    } catch (err) {
      console.warn("GetCurrentUserData batch failed:", err);
    }
  }

  // Step 3 — offline users (those not returned by GetCurrentUserData)
  for (const [userId, meta] of users.entries()) {
    allAgents.push({
      userId,
      username: meta.username,
      statusName: "Offline",
      statusStartTimestamp: null,
      routingProfile: null,
      routingProfileId: meta.routingProfileId || null,
      activeContact: null,
    });
  }

  // Step 4 — enrich each agent with their routing profile queues + today stats
  // IN PARALLEL (12 agents × ~2 calls = 24 parallel calls is fine).
  await Promise.all(
    allAgents.map(async (a) => {
      const [queues, stats] = await Promise.all([
        a.routingProfileId
          ? resolveRoutingProfileQueues(a.routingProfileId)
          : Promise.resolve([]),
        // The GSI "agentUsername" holds userIds despite the name.
        getAgentDailyStats(a.userId),
      ]);
      a.queues = queues;
      a.stats = {
        queuedForMe: 0, // filled after we know all inQueue contacts
        completedToday: stats.completed,
        errorsToday: stats.errors,
      };
    })
  );

  allAgents.sort((a, b) => a.username.localeCompare(b.username));
  return allAgents;
}


export interface WithAgentContact {
  contactId: string;
  agentUserId: string;
  phone: string | null;
  customerName: string | null;
  channel: string;
  queueName: string | null;
  state: string;
  connectedToAgentTimestamp: string | null;
}

async function getQueuedAndFinishedContacts(): Promise<{
  active: QueuedContactView[];
  finished: QueuedContactView[];
  withAgent: WithAgentContact[];
}> {
  const now = new Date();
  const endTime = new Date(now.getTime() + 60_000);
  // We need at least 2h back for long-waiting contacts AND 10 min for recently-disconnected.
  const startTime = new Date(now.getTime() - 2 * 3600 * 1000);

  let nextToken: string | undefined;
  const active: QueuedContactView[] = [];
  const finished: QueuedContactView[] = [];
  const withAgent: WithAgentContact[] = [];
  const finishedCutoff = now.getTime() - FINISHED_WINDOW_MS;

  for (let i = 0; i < 3; i++) {
    const res = await connect.send(
      new SearchContactsCommand({
        InstanceId: INSTANCE_ID,
        TimeRange: {
          Type: "INITIATION_TIMESTAMP",
          StartTime: startTime,
          EndTime: endTime,
        },
        SearchCriteria: {
          Channels: ["VOICE", "CHAT", "TASK", "EMAIL"],
        },
        MaxResults: 100,
        NextToken: nextToken,
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const c of (res.Contacts as any[]) || []) {
      const discTs = c.DisconnectTimestamp
        ? new Date(c.DisconnectTimestamp).getTime()
        : null;

      // Fast-skip: disconnected and already outside the FINISHED window
      if (discTs && discTs < finishedCutoff) continue;

      try {
        const detail = await connect.send(
          new DescribeContactCommand({
            InstanceId: INSTANCE_ID,
            ContactId: c.Id,
          })
        );
        const ct = detail.Contact;
        if (!ct) continue;

        const initiationMs = ct.InitiationTimestamp?.getTime() || Date.now();
        const queueId = ct.QueueInfo?.Id || null;
        const agentId = ct.AgentInfo?.Id || null;
        const connectedMs =
          ct.AgentInfo?.ConnectedToAgentTimestamp?.getTime() || null;
        const queueEnqueueMs = ct.QueueInfo?.EnqueueTimestamp?.getTime() || null;
        const discMs = ct.DisconnectTimestamp?.getTime() || null;
        const customerName =
          (ct.Attributes?.customerName as string | undefined) || null;
        const campaignRowId =
          (ct.Attributes?.campaignRowId as string | undefined) ||
          (ct.Attributes?.campaignrowid as string | undefined) ||
          null;
        const campaignId =
          (ct.Attributes?.campaignId as string | undefined) ||
          (ct.Attributes?.campaignid as string | undefined) ||
          null;

        // Classify into one of the 5 pipeline stages.
        //  - FINISHED: DisconnectTimestamp is set, stageEnteredAt = disconnect
        //  - WITH_AGENT: ConnectedToAgentTimestamp set, no disconnect
        //  - IN_QUEUE: queueId set, no agent, no disconnect
        //  - IN_IVR: initiated long enough ago, no queue yet
        //  - ARRIVED: just initiated, no queue
        let state: QueuedContactView["state"];
        let stageEnteredMs = initiationMs;

        if (discMs) {
          state = "FINISHED";
          stageEnteredMs = discMs;
        } else if (agentId && connectedMs) {
          // Already surfaced via the agent card; do not show in pipeline columns.
          state = "WITH_AGENT";
          stageEnteredMs = connectedMs;
        } else if (queueId) {
          state = "IN_QUEUE";
          stageEnteredMs = queueEnqueueMs || initiationMs;
        } else {
          // No queue yet. If the contact was initiated very recently treat it as
          // ARRIVED; otherwise it's still executing the flow (IN_IVR).
          const ageSec = (now.getTime() - initiationMs) / 1000;
          state = ageSec < ARRIVED_WINDOW_SEC ? "ARRIVED" : "IN_IVR";
          stageEnteredMs = initiationMs;
        }

        const waitingSeconds = Math.max(
          0,
          Math.round((now.getTime() - stageEnteredMs) / 1000)
        );
        const agentUsername = agentId ? await resolveUser(agentId) : null;

        // If this is a campaign contact, look up the row to get attempt count.
        let retryCount: number | null = null;
        if (campaignId && campaignRowId) {
          try {
            const rowRes = await dynamo.send(
              new QueryCommand({
                TableName: CAMPAIGN_CONTACTS_TABLE,
                KeyConditionExpression:
                  "campaignId = :cid AND rowId = :rid",
                ExpressionAttributeValues: {
                  ":cid": { S: campaignId },
                  ":rid": { S: campaignRowId },
                },
                Limit: 1,
              })
            );
            if (rowRes.Items && rowRes.Items.length > 0) {
              const row = unmarshall(rowRes.Items[0]);
              retryCount =
                typeof row.attempts === "number"
                  ? row.attempts
                  : Number(row.attempts) || null;
            }
          } catch {
            /* ignore */
          }
        }

        const view: QueuedContactView & { campaignId?: string | null } = {
          contactId: ct.Id || c.Id || "",
          phone: ct.CustomerEndpoint?.Address || null,
          customerName,
          channel: ct.Channel || "VOICE",
          queueId,
          queueName: queueId ? await resolveQueue(queueId) : null,
          initiationMethod: ct.InitiationMethod || "",
          initiationTimestamp: ct.InitiationTimestamp?.toISOString() || null,
          state,
          stageEnteredAt: new Date(stageEnteredMs).toISOString(),
          waitingSeconds,
          disconnectReason: ct.DisconnectReason || null,
          agentUsername,
          sortKey: new Date(initiationMs).toISOString(),
          campaignRowId: campaignRowId,
          retryCount,
          // Include the campaign id pulled from Contact.Attributes so per-
          // campaign FlowView cards can filter active contacts (ARRIVED /
          // IVR / IN_QUEUE), not just finished/requeued.
          campaignId,
        };

        if (state === "FINISHED") {
          finished.push(view);
        } else if (state === "WITH_AGENT" && agentId) {
          // Push into withAgent so we can fill in agent.activeContact even
          // when GetCurrentUserData returns activeContact=null (happens when
          // the agent's CCP is not actively connected in a browser tab).
          withAgent.push({
            contactId: view.contactId,
            agentUserId: agentId,
            phone: view.phone,
            customerName: customerName,
            channel: view.channel,
            queueName: view.queueName,
            state: "CONNECTED",
            connectedToAgentTimestamp: new Date(stageEnteredMs).toISOString(),
          });
        } else if (state !== "WITH_AGENT") {
          active.push(view);
        }
      } catch {
        /* skip contacts that can't be described */
      }
    }

    nextToken = res.NextToken;
    if (!nextToken) break;
  }

  return { active, finished, withAgent };
}

async function listQueuesAndStatuses() {
  const [queuesRes, statusesRes] = await Promise.all([
    connect.send(
      new ListQueuesCommand({
        InstanceId: INSTANCE_ID,
        QueueTypes: ["STANDARD"],
        MaxResults: 100,
      })
    ),
    connect.send(
      new ListAgentStatusesCommand({
        InstanceId: INSTANCE_ID,
        MaxResults: 100,
      })
    ),
  ]);

  const queues = (queuesRes.QueueSummaryList || []).map((q) => ({
    id: q.Id || "",
    name: q.Name || "",
  }));
  const statuses = (statusesRes.AgentStatusSummaryList || []).map((s) => ({
    id: s.Id || "",
    name: s.Name || "",
    type: s.Type || "",
  }));

  return { queues, statuses };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async () => {
  try {
    const [agents, contacts, meta, dynamoFinished, campaignActive] =
      await Promise.all([
        getAgents(),
        getQueuedAndFinishedContacts(),
        listQueuesAndStatuses(),
        fetchRecentlyFinishedFromDynamo(),
        fetchCampaignPendingAndDialing(),
      ]);

    // Merge campaign pending/dialing rows into the active set. We reuse the
    // IN_IVR slot for "Pendientes" (not-yet-dialed) and ARRIVED for
    // "Marcando" (currently ringing) — the frontend just relabels the
    // stage titles for campaign graphs.
    const activeByCid = new Map<string, QueuedContactView>();
    for (const c of contacts.active) activeByCid.set(c.contactId, c);
    for (const c of [...campaignActive.pending, ...campaignActive.dialing]) {
      if (!activeByCid.has(c.contactId)) {
        activeByCid.set(c.contactId, c);
      }
    }
    contacts.active = [...activeByCid.values()];

    // Merge DynamoDB-side finished contacts with the ones we pulled via
    // DescribeContact (live). De-dupe by contactId — Dynamo wins when both
    // are present because it has the final disconnectReason.
    const finishedByCid = new Map<string, QueuedContactView>();
    for (const c of contacts.finished) finishedByCid.set(c.contactId, c);
    for (const c of dynamoFinished) finishedByCid.set(c.contactId, c);
    contacts.finished = [...finishedByCid.values()].sort(
      (a, b) =>
        (b.stageEnteredAt || "").localeCompare(a.stageEnteredAt || "")
    );

    // Enrich: if DescribeContact shows a contact connected to an agent but
    // GetCurrentUserData returned activeContact=null for that agent (common
    // when the agent's CCP isn't actively connected), fill it in so the
    // Queue Manager pipeline still shows the call under "Con agente".
    for (const wa of contacts.withAgent) {
      const agent = agents.find((a) => a.userId === wa.agentUserId);
      if (!agent) continue;
      if (!agent.activeContact) {
        agent.activeContact = {
          contactId: wa.contactId,
          phone: wa.phone,
          state: wa.state,
          channel: wa.channel,
          queueName: wa.queueName,
          connectedToAgentTimestamp: wa.connectedToAgentTimestamp,
        };
      }
    }

    // Per-agent queuedForMe: count active in-queue contacts in any queue that
    // the agent's routing profile includes.
    const activeInQueue = contacts.active.filter((c) => c.state === "IN_QUEUE");
    for (const agent of agents) {
      if (!agent.queues || agent.queues.length === 0) continue;
      const myQueueIds = new Set(agent.queues.map((q) => q.id));
      const count = activeInQueue.filter((c) =>
        c.queueId ? myQueueIds.has(c.queueId) : false
      ).length;
      if (agent.stats) {
        agent.stats.queuedForMe = count;
      }
    }

    // Contacts scheduled for a retry: rows in connectview-campaign-contacts
    // with status=pending AND attempts > 0 AND nextRetryAt in the future OR
    // very recent past (we show them for the UI's "Reencoladas" bucket).
    const retryScheduled: QueuedContactView[] = await fetchRetryScheduled();

    // Split by stage for convenience on the client.
    const arrived = contacts.active.filter((c) => c.state === "ARRIVED");
    const inIvr = contacts.active.filter((c) => c.state === "IN_IVR");
    const inQueue = contacts.active.filter((c) => c.state === "IN_QUEUE");
    const finished = contacts.finished;

    // Backward-compatible buckets for anything still reading the old shape.
    const preQueue = [...arrived, ...inIvr];
    const pendingTransfer = contacts.active.filter(
      (c) => c.state === "PENDING_TRANSFER"
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agents,
        // New pipeline-shaped payload:
        arrived,
        inIvr,
        inQueue,
        finished,
        retryScheduled,
        // Legacy fields (kept so older UI code keeps working during rollout):
        preQueue,
        pendingTransfer,
        queues: meta.queues,
        statuses: meta.statuses,
        generatedAt: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error("get-live-queue error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get live queue",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
