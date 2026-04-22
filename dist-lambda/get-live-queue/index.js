"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// amplify/functions/get-live-queue/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var connect = new import_client_connect.ConnectClient({ maxAttempts: 1 });
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
var CONTACTS_TABLE = process.env.CONTACTS_TABLE || "connectview-contacts";
var CAMPAIGN_CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
var ARRIVED_WINDOW_SEC = 10;
var FINISHED_WINDOW_MS = 10 * 60 * 1e3;
var userCache = /* @__PURE__ */ new Map();
var queueNameCache = /* @__PURE__ */ new Map();
var routingProfileQueuesCache = /* @__PURE__ */ new Map();
async function resolveUser(id) {
  if (!id) return "";
  if (userCache.has(id)) return userCache.get(id);
  try {
    const r = await connect.send(
      new import_client_connect.DescribeUserCommand({ InstanceId: INSTANCE_ID, UserId: id })
    );
    const name = r.User?.Username || id;
    userCache.set(id, name);
    return name;
  } catch {
    userCache.set(id, id);
    return id;
  }
}
async function resolveQueue(id) {
  if (!id) return "";
  if (queueNameCache.has(id)) return queueNameCache.get(id);
  try {
    const r = await connect.send(
      new import_client_connect.DescribeQueueCommand({ InstanceId: INSTANCE_ID, QueueId: id })
    );
    const name = r.Queue?.Name || id;
    queueNameCache.set(id, name);
    return name;
  } catch {
    queueNameCache.set(id, id);
    return id;
  }
}
async function resolveRoutingProfileQueues(routingProfileId) {
  if (!routingProfileId) return [];
  if (routingProfileQueuesCache.has(routingProfileId)) {
    return routingProfileQueuesCache.get(routingProfileId);
  }
  try {
    const res = await connect.send(
      new import_client_connect.ListRoutingProfileQueuesCommand({
        InstanceId: INSTANCE_ID,
        RoutingProfileId: routingProfileId,
        MaxResults: 100
      })
    );
    const seen = /* @__PURE__ */ new Set();
    const queues = [];
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
function startOfTodayIso() {
  const d = /* @__PURE__ */ new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function statusToReason(status) {
  const s = (status || "").toLowerCase();
  if (s === "done") return "AGENT_DISCONNECT";
  if (s === "no_answer") return "NO_USER_RESPONSE";
  if (s === "failed") return "OUTBOUND_ATTEMPT_FAILED";
  if (s === "cancelled") return "CUSTOMER_DISCONNECT_ABANDONED";
  return "UNKNOWN";
}
async function fetchRecentlyFinishedFromDynamo() {
  const sinceMs = Date.now() - FINISHED_WINDOW_MS;
  const since = new Date(sinceMs).toISOString();
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  try {
    const res = await dynamo.send(
      new import_client_dynamodb.ScanCommand({
        TableName: CAMPAIGN_CONTACTS_TABLE,
        FilterExpression: "#s IN (:done, :noans, :failed, :cancelled) AND lastAttemptAt >= :since",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":done": { S: "done" },
          ":noans": { S: "no_answer" },
          ":failed": { S: "failed" },
          ":cancelled": { S: "cancelled" },
          ":since": { S: since }
        },
        Limit: 200
      })
    );
    for (const raw of res.Items || []) {
      const row = (0, import_util_dynamodb.unmarshall)(raw);
      const cid = row.connectContactId;
      if (!cid) continue;
      seen.add(cid);
      out.push({
        contactId: cid,
        phone: row.phone || null,
        customerName: row.customerName || null,
        channel: "VOICE",
        queueId: null,
        queueName: null,
        initiationMethod: "CAMPAIGN",
        initiationTimestamp: row.createdAt || null,
        state: "FINISHED",
        stageEnteredAt: row.lastAttemptAt || row.createdAt || since,
        waitingSeconds: 0,
        disconnectReason: statusToReason(row.status),
        agentUsername: null,
        sortKey: row.lastAttemptAt || since,
        campaignRowId: row.rowId || null,
        retryCount: Number(row.attempts) || 0,
        campaignId: row.campaignId || null
      });
    }
  } catch (err) {
    console.warn("fetchRecentlyFinishedFromDynamo[campaign] failed:", err);
  }
  try {
    const res = await dynamo.send(
      new import_client_dynamodb.ScanCommand({
        TableName: CONTACTS_TABLE,
        FilterExpression: "initiationTimestamp >= :since",
        ExpressionAttributeValues: {
          ":since": { S: since }
        },
        Limit: 100
      })
    );
    for (const raw of res.Items || []) {
      const row = (0, import_util_dynamodb.unmarshall)(raw);
      const disc = row.disconnectTimestamp || row.lastUpdateTimestamp;
      if (!disc) continue;
      const cid = row.contactId;
      if (!cid || seen.has(cid)) continue;
      const reason = row.disconnectReason || "UNKNOWN";
      out.push({
        contactId: cid,
        phone: row.customerPhone || null,
        customerName: row.customerName || null,
        channel: row.channel || "VOICE",
        queueId: null,
        queueName: row.queueName || null,
        initiationMethod: row.initiationMethod || "",
        initiationTimestamp: row.initiationTimestamp || null,
        state: "FINISHED",
        stageEnteredAt: disc,
        waitingSeconds: 0,
        disconnectReason: reason,
        agentUsername: row.agentUsername || null,
        sortKey: row.initiationTimestamp || disc,
        campaignRowId: null,
        retryCount: 0
      });
    }
  } catch (err) {
    console.warn("fetchRecentlyFinishedFromDynamo[analytics] failed:", err);
  }
  return out;
}
async function fetchCampaignPendingAndDialing() {
  const pending = [];
  const dialing = [];
  try {
    const res = await dynamo.send(
      new import_client_dynamodb.ScanCommand({
        TableName: CAMPAIGN_CONTACTS_TABLE,
        FilterExpression: "#s = :p OR #s = :d",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":p": { S: "pending" },
          ":d": { S: "dialing" }
        },
        Limit: 500
      })
    );
    for (const raw of res.Items || []) {
      const row = (0, import_util_dynamodb.unmarshall)(raw);
      const status = row.status;
      const rowId = row.rowId;
      const cid = row.connectContactId || `row-${rowId}`;
      const view = {
        contactId: cid,
        phone: row.phone || null,
        customerName: row.customerName || null,
        channel: "VOICE",
        queueId: null,
        queueName: null,
        initiationMethod: "CAMPAIGN",
        initiationTimestamp: row.lastAttemptAt || row.createdAt || null,
        state: status === "dialing" ? "ARRIVED" : "IN_IVR",
        // reused frontend slots
        stageEnteredAt: row.lastAttemptAt || row.createdAt || null,
        waitingSeconds: 0,
        disconnectReason: null,
        agentUsername: null,
        sortKey: row.lastAttemptAt || row.createdAt || "",
        campaignRowId: rowId,
        retryCount: Number(row.attempts) || 0,
        campaignId: row.campaignId || null
      };
      if (status === "dialing") dialing.push(view);
      else pending.push(view);
    }
  } catch (err) {
    console.warn("fetchCampaignPendingAndDialing failed:", err);
  }
  return { pending, dialing };
}
async function fetchRetryScheduled() {
  try {
    const res = await dynamo.send(
      new import_client_dynamodb.QueryCommand({
        TableName: CAMPAIGN_CONTACTS_TABLE,
        IndexName: "status-createdAt-index",
        KeyConditionExpression: "#st = :p",
        ExpressionAttributeNames: { "#st": "status" },
        FilterExpression: "attempts > :zero",
        ExpressionAttributeValues: {
          ":p": { S: "pending" },
          ":zero": { N: "0" }
        },
        Limit: 50
      })
    );
    const out = [];
    for (const raw of res.Items || []) {
      const row = (0, import_util_dynamodb.unmarshall)(raw);
      out.push({
        contactId: `retry-${row.rowId}`,
        phone: row.phone || null,
        customerName: row.customerName || null,
        channel: "VOICE",
        queueId: null,
        queueName: null,
        initiationMethod: "CAMPAIGN",
        initiationTimestamp: row.createdAt || null,
        state: "FINISHED",
        stageEnteredAt: row.lastAttemptAt || null,
        waitingSeconds: 0,
        disconnectReason: "REQUEUED",
        agentUsername: null,
        sortKey: row.lastAttemptAt || "",
        campaignRowId: row.rowId || null,
        // campaignId is not part of the QueuedContactView interface, but we
        // attach it on the wire as an extra field so the frontend can filter
        // retryScheduled items per campaign.
        ...row.campaignId && { campaignId: row.campaignId } || {},
        retryCount: Number(row.attempts) || 0
      });
    }
    return out.slice(0, 25);
  } catch (err) {
    console.warn("fetchRetryScheduled failed:", err);
    return [];
  }
}
async function getAgentDailyStats(agentKey) {
  if (!agentKey) return { completed: 0, errors: 0 };
  const since = startOfTodayIso();
  try {
    const res = await dynamo.send(
      new import_client_dynamodb.QueryCommand({
        TableName: CONTACTS_TABLE,
        IndexName: "agentUsername-initiationTimestamp-index",
        KeyConditionExpression: "agentUsername = :u AND initiationTimestamp >= :since",
        ExpressionAttributeValues: {
          ":u": { S: agentKey },
          ":since": { S: since }
        },
        Limit: 500
      })
    );
    let completed = 0;
    let errors = 0;
    for (const raw of res.Items || []) {
      const it = (0, import_util_dynamodb.unmarshall)(raw);
      const status = String(it.status || "").toUpperCase();
      const reason = String(it.disconnectReason || "").toUpperCase();
      if (status === "FAILED" || status === "MISSED" || status === "ABANDONED" || reason === "CONTACT_FLOW_DISCONNECT" || reason === "NO_USER_RESPONSE" || reason === "CUSTOMER_DISCONNECT_ABANDONED" || reason === "TELECOM_PROBLEM" || reason === "OUTBOUND_DESTINATION_ENDPOINT_ERROR" || reason === "OUTBOUND_RESOURCE_ERROR" || reason === "OUTBOUND_ATTEMPT_FAILED") {
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
var userRoutingProfileCache = /* @__PURE__ */ new Map();
async function getAgents() {
  const users = /* @__PURE__ */ new Map();
  let nextToken;
  do {
    const res = await connect.send(
      new import_client_connect.ListUsersCommand({
        InstanceId: INSTANCE_ID,
        MaxResults: 100,
        NextToken: nextToken
      })
    );
    for (const u of res.UserSummaryList || []) {
      if (u.Id && u.Username) users.set(u.Id, { username: u.Username });
    }
    nextToken = res.NextToken;
  } while (nextToken);
  await Promise.all(
    [...users.entries()].map(async ([userId, meta]) => {
      if (userRoutingProfileCache.has(userId)) {
        meta.routingProfileId = userRoutingProfileCache.get(userId);
        return;
      }
      try {
        const du = await connect.send(
          new import_client_connect.DescribeUserCommand({
            InstanceId: INSTANCE_ID,
            UserId: userId
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
  const allAgents = [];
  const userIds = [...users.keys()];
  for (let i = 0; i < userIds.length; i += 100) {
    const batch = userIds.slice(i, i + 100);
    try {
      const res = await connect.send(
        new import_client_connect.GetCurrentUserDataCommand({
          InstanceId: INSTANCE_ID,
          Filters: { Agents: batch }
        })
      );
      for (const ud of res.UserDataList || []) {
        const userId = ud.User?.Id || "";
        const userMeta = users.get(userId);
        const username = userMeta?.username || userId;
        const contacts = ud.Contacts || [];
        const active = contacts.find(
          (c) => ["CONNECTED", "INCOMING", "CONNECTING", "ON_HOLD"].includes(
            c.ContactState || ""
          )
        );
        let activeContact = null;
        if (active) {
          const queueName = active.Queue?.Arn ? await resolveQueue(active.Queue.Arn.split("/").pop() || "") : active.Queue?.Name || null;
          activeContact = {
            contactId: active.ContactId || "",
            phone: active.CustomerEndpoint?.Address || null,
            state: active.ContactState || "",
            channel: active.Channel || "VOICE",
            queueName,
            connectedToAgentTimestamp: active.ConnectedToAgentTimestamp?.toISOString() || null
          };
        }
        const routingProfileId = ud.RoutingProfile?.Id || userMeta?.routingProfileId || null;
        allAgents.push({
          userId,
          username,
          statusName: ud.Status?.StatusName || null,
          statusStartTimestamp: ud.Status?.StatusStartTimestamp?.toISOString() || null,
          routingProfile: ud.RoutingProfile?.Name || null,
          routingProfileId,
          activeContact
        });
        users.delete(userId);
      }
    } catch (err) {
      console.warn("GetCurrentUserData batch failed:", err);
    }
  }
  for (const [userId, meta] of users.entries()) {
    allAgents.push({
      userId,
      username: meta.username,
      statusName: "Offline",
      statusStartTimestamp: null,
      routingProfile: null,
      routingProfileId: meta.routingProfileId || null,
      activeContact: null
    });
  }
  await Promise.all(
    allAgents.map(async (a) => {
      const [queues, stats] = await Promise.all([
        a.routingProfileId ? resolveRoutingProfileQueues(a.routingProfileId) : Promise.resolve([]),
        // The GSI "agentUsername" holds userIds despite the name.
        getAgentDailyStats(a.userId)
      ]);
      a.queues = queues;
      a.stats = {
        queuedForMe: 0,
        // filled after we know all inQueue contacts
        completedToday: stats.completed,
        errorsToday: stats.errors
      };
    })
  );
  allAgents.sort((a, b) => a.username.localeCompare(b.username));
  return allAgents;
}
async function getQueuedAndFinishedContacts() {
  const now = /* @__PURE__ */ new Date();
  const endTime = new Date(now.getTime() + 6e4);
  const startTime = new Date(now.getTime() - 2 * 3600 * 1e3);
  let nextToken;
  const active = [];
  const finished = [];
  const withAgent = [];
  const finishedCutoff = now.getTime() - FINISHED_WINDOW_MS;
  for (let i = 0; i < 3; i++) {
    const res = await connect.send(
      new import_client_connect.SearchContactsCommand({
        InstanceId: INSTANCE_ID,
        TimeRange: {
          Type: "INITIATION_TIMESTAMP",
          StartTime: startTime,
          EndTime: endTime
        },
        SearchCriteria: {
          Channels: ["VOICE", "CHAT", "TASK", "EMAIL"]
        },
        MaxResults: 100,
        NextToken: nextToken
      })
    );
    for (const c of res.Contacts || []) {
      const discTs = c.DisconnectTimestamp ? new Date(c.DisconnectTimestamp).getTime() : null;
      if (discTs && discTs < finishedCutoff) continue;
      try {
        const detail = await connect.send(
          new import_client_connect.DescribeContactCommand({
            InstanceId: INSTANCE_ID,
            ContactId: c.Id
          })
        );
        const ct = detail.Contact;
        if (!ct) continue;
        const initiationMs = ct.InitiationTimestamp?.getTime() || Date.now();
        const queueId = ct.QueueInfo?.Id || null;
        const agentId = ct.AgentInfo?.Id || null;
        const connectedMs = ct.AgentInfo?.ConnectedToAgentTimestamp?.getTime() || null;
        const queueEnqueueMs = ct.QueueInfo?.EnqueueTimestamp?.getTime() || null;
        const discMs = ct.DisconnectTimestamp?.getTime() || null;
        const customerName = ct.Attributes?.customerName || null;
        const campaignRowId = ct.Attributes?.campaignRowId || ct.Attributes?.campaignrowid || null;
        const campaignId = ct.Attributes?.campaignId || ct.Attributes?.campaignid || null;
        let state;
        let stageEnteredMs = initiationMs;
        if (discMs) {
          state = "FINISHED";
          stageEnteredMs = discMs;
        } else if (agentId && connectedMs) {
          state = "WITH_AGENT";
          stageEnteredMs = connectedMs;
        } else if (queueId) {
          state = "IN_QUEUE";
          stageEnteredMs = queueEnqueueMs || initiationMs;
        } else {
          const ageSec = (now.getTime() - initiationMs) / 1e3;
          state = ageSec < ARRIVED_WINDOW_SEC ? "ARRIVED" : "IN_IVR";
          stageEnteredMs = initiationMs;
        }
        const waitingSeconds = Math.max(
          0,
          Math.round((now.getTime() - stageEnteredMs) / 1e3)
        );
        const agentUsername = agentId ? await resolveUser(agentId) : null;
        let retryCount = null;
        if (campaignId && campaignRowId) {
          try {
            const rowRes = await dynamo.send(
              new import_client_dynamodb.QueryCommand({
                TableName: CAMPAIGN_CONTACTS_TABLE,
                KeyConditionExpression: "campaignId = :cid AND rowId = :rid",
                ExpressionAttributeValues: {
                  ":cid": { S: campaignId },
                  ":rid": { S: campaignRowId }
                },
                Limit: 1
              })
            );
            if (rowRes.Items && rowRes.Items.length > 0) {
              const row = (0, import_util_dynamodb.unmarshall)(rowRes.Items[0]);
              retryCount = typeof row.attempts === "number" ? row.attempts : Number(row.attempts) || null;
            }
          } catch {
          }
        }
        const view = {
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
          campaignRowId,
          retryCount,
          // Include the campaign id pulled from Contact.Attributes so per-
          // campaign FlowView cards can filter active contacts (ARRIVED /
          // IVR / IN_QUEUE), not just finished/requeued.
          campaignId
        };
        if (state === "FINISHED") {
          finished.push(view);
        } else if (state === "WITH_AGENT" && agentId) {
          withAgent.push({
            contactId: view.contactId,
            agentUserId: agentId,
            phone: view.phone,
            customerName,
            channel: view.channel,
            queueName: view.queueName,
            state: "CONNECTED",
            connectedToAgentTimestamp: new Date(stageEnteredMs).toISOString()
          });
        } else if (state !== "WITH_AGENT") {
          active.push(view);
        }
      } catch {
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
      new import_client_connect.ListQueuesCommand({
        InstanceId: INSTANCE_ID,
        QueueTypes: ["STANDARD"],
        MaxResults: 100
      })
    ),
    connect.send(
      new import_client_connect.ListAgentStatusesCommand({
        InstanceId: INSTANCE_ID,
        MaxResults: 100
      })
    )
  ]);
  const queues = (queuesRes.QueueSummaryList || []).map((q) => ({
    id: q.Id || "",
    name: q.Name || ""
  }));
  const statuses = (statusesRes.AgentStatusSummaryList || []).map((s) => ({
    id: s.Id || "",
    name: s.Name || "",
    type: s.Type || ""
  }));
  return { queues, statuses };
}
var handler = async () => {
  try {
    const [agents, contacts, meta, dynamoFinished, campaignActive] = await Promise.all([
      getAgents(),
      getQueuedAndFinishedContacts(),
      listQueuesAndStatuses(),
      fetchRecentlyFinishedFromDynamo(),
      fetchCampaignPendingAndDialing()
    ]);
    const activeByCid = /* @__PURE__ */ new Map();
    for (const c of contacts.active) activeByCid.set(c.contactId, c);
    for (const c of [...campaignActive.pending, ...campaignActive.dialing]) {
      if (!activeByCid.has(c.contactId)) {
        activeByCid.set(c.contactId, c);
      }
    }
    contacts.active = [...activeByCid.values()];
    const finishedByCid = /* @__PURE__ */ new Map();
    for (const c of contacts.finished) finishedByCid.set(c.contactId, c);
    for (const c of dynamoFinished) finishedByCid.set(c.contactId, c);
    contacts.finished = [...finishedByCid.values()].sort(
      (a, b) => (b.stageEnteredAt || "").localeCompare(a.stageEnteredAt || "")
    );
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
          connectedToAgentTimestamp: wa.connectedToAgentTimestamp
        };
      }
    }
    const activeInQueue = contacts.active.filter((c) => c.state === "IN_QUEUE");
    for (const agent of agents) {
      if (!agent.queues || agent.queues.length === 0) continue;
      const myQueueIds = new Set(agent.queues.map((q) => q.id));
      const count = activeInQueue.filter(
        (c) => c.queueId ? myQueueIds.has(c.queueId) : false
      ).length;
      if (agent.stats) {
        agent.stats.queuedForMe = count;
      }
    }
    const retryScheduled = await fetchRetryScheduled();
    const arrived = contacts.active.filter((c) => c.state === "ARRIVED");
    const inIvr = contacts.active.filter((c) => c.state === "IN_IVR");
    const inQueue = contacts.active.filter((c) => c.state === "IN_QUEUE");
    const finished = contacts.finished;
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
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      })
    };
  } catch (err) {
    console.error("get-live-queue error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get live queue",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
