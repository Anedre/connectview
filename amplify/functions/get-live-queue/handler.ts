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
} from "@aws-sdk/client-connect";

const connect = new ConnectClient({ maxAttempts: 1 });
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

// Caches for metadata that doesn't change often.
const userCache = new Map<string, string>();
const queueNameCache = new Map<string, string>();

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
  // What they're doing right now
  activeContact: {
    contactId: string;
    phone: string | null;
    state: string;
    channel: string;
    queueName: string | null;
    connectedToAgentTimestamp: string | null;
  } | null;
}

interface QueuedContactView {
  contactId: string;
  phone: string | null;
  channel: string;
  queueId: string | null;
  queueName: string | null;
  initiationMethod: string;
  initiationTimestamp: string | null;
  state: "IN_QUEUE" | "CONNECTING" | "INCOMING" | "PENDING_TRANSFER";
  waitingSeconds: number;
}

async function getAgents(): Promise<AgentView[]> {
  // Step 1 — list all users (for usernames)
  const users = new Map<string, { username: string; routingProfile?: string }>();
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
        // Pick the first ACTIVE contact (CONNECTED, INCOMING, CONNECTING, ON_HOLD)
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
        allAgents.push({
          userId,
          username,
          statusName: ud.Status?.StatusName || null,
          statusStartTimestamp:
            ud.Status?.StatusStartTimestamp?.toISOString() || null,
          routingProfile: ud.RoutingProfile?.Name || null,
          activeContact,
        });
        // Remove from users map so remaining users (no GetCurrentUserData entry = offline)
        users.delete(userId);
      }
    } catch (err) {
      console.warn("GetCurrentUserData batch failed:", err);
    }
  }

  // Step 3 — users not covered by GetCurrentUserData are offline
  for (const [userId, meta] of users.entries()) {
    allAgents.push({
      userId,
      username: meta.username,
      statusName: "Offline",
      statusStartTimestamp: null,
      routingProfile: null,
      activeContact: null,
    });
  }

  allAgents.sort((a, b) => a.username.localeCompare(b.username));
  return allAgents;
}

async function getQueuedContacts(): Promise<QueuedContactView[]> {
  // SearchContacts with TimeRange CONNECTED_TO_SYSTEM_TIMESTAMP for recent contacts,
  // then filter by state on the client.
  const now = new Date();
  const endTime = new Date(now.getTime() + 60_000); // small future buffer
  const startTime = new Date(now.getTime() - 2 * 3600 * 1000); // last 2 hours

  let nextToken: string | undefined;
  const results: QueuedContactView[] = [];

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
      // Only include ongoing contacts (no DisconnectTimestamp)
      if (c.DisconnectTimestamp) continue;

      // Enrich with DescribeContact for state + queue
      try {
        const detail = await connect.send(
          new DescribeContactCommand({
            InstanceId: INSTANCE_ID,
            ContactId: c.Id,
          })
        );
        const ct = detail.Contact;
        if (!ct || ct.DisconnectTimestamp) continue;

        // Skip if already connected to an agent (those are in agent.activeContact)
        if (ct.AgentInfo?.Id && ct.AgentInfo?.ConnectedToAgentTimestamp) continue;

        // Determine "state" bucket
        let state: QueuedContactView["state"] = "IN_QUEUE";
        if (!ct.QueueInfo?.Id) {
          // Not yet in a queue — still in IVR / flow / connecting
          state = "CONNECTING";
        } else if (!ct.AgentInfo) {
          state = "IN_QUEUE";
        }

        const initiationMs = ct.InitiationTimestamp?.getTime() || Date.now();
        const waitingSeconds = Math.max(
          0,
          Math.round((Date.now() - initiationMs) / 1000)
        );

        results.push({
          contactId: ct.Id || c.Id || "",
          phone: ct.CustomerEndpoint?.Address || null,
          channel: ct.Channel || "VOICE",
          queueId: ct.QueueInfo?.Id || null,
          queueName: ct.QueueInfo?.Id
            ? await resolveQueue(ct.QueueInfo.Id)
            : null,
          initiationMethod: ct.InitiationMethod || "",
          initiationTimestamp: ct.InitiationTimestamp?.toISOString() || null,
          state,
          waitingSeconds,
        });
      } catch {
        /* skip contacts that can't be described */
      }
    }

    nextToken = res.NextToken;
    if (!nextToken) break;
  }

  return results;
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
    const [agents, queued, meta] = await Promise.all([
      getAgents(),
      getQueuedContacts(),
      listQueuesAndStatuses(),
    ]);

    // Split queued by state
    const preQueue = queued.filter((c) => c.state === "CONNECTING");
    const inQueue = queued.filter((c) => c.state === "IN_QUEUE");
    const pendingTransfer = queued.filter((c) => c.state === "PENDING_TRANSFER");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agents,
        preQueue,
        inQueue,
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
