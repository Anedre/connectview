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
var connect = new import_client_connect.ConnectClient({ maxAttempts: 1 });
var INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
var queueNameCache = /* @__PURE__ */ new Map();
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
        allAgents.push({
          userId,
          username,
          statusName: ud.Status?.StatusName || null,
          statusStartTimestamp: ud.Status?.StatusStartTimestamp?.toISOString() || null,
          routingProfile: ud.RoutingProfile?.Name || null,
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
      activeContact: null
    });
  }
  allAgents.sort((a, b) => a.username.localeCompare(b.username));
  return allAgents;
}
async function getQueuedContacts() {
  const now = /* @__PURE__ */ new Date();
  const endTime = new Date(now.getTime() + 6e4);
  const startTime = new Date(now.getTime() - 2 * 3600 * 1e3);
  let nextToken;
  const results = [];
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
      if (c.DisconnectTimestamp) continue;
      try {
        const detail = await connect.send(
          new import_client_connect.DescribeContactCommand({
            InstanceId: INSTANCE_ID,
            ContactId: c.Id
          })
        );
        const ct = detail.Contact;
        if (!ct || ct.DisconnectTimestamp) continue;
        if (ct.AgentInfo?.Id && ct.AgentInfo?.ConnectedToAgentTimestamp) continue;
        let state = "IN_QUEUE";
        if (!ct.QueueInfo?.Id) {
          state = "CONNECTING";
        } else if (!ct.AgentInfo) {
          state = "IN_QUEUE";
        }
        const initiationMs = ct.InitiationTimestamp?.getTime() || Date.now();
        const waitingSeconds = Math.max(
          0,
          Math.round((Date.now() - initiationMs) / 1e3)
        );
        results.push({
          contactId: ct.Id || c.Id || "",
          phone: ct.CustomerEndpoint?.Address || null,
          channel: ct.Channel || "VOICE",
          queueId: ct.QueueInfo?.Id || null,
          queueName: ct.QueueInfo?.Id ? await resolveQueue(ct.QueueInfo.Id) : null,
          initiationMethod: ct.InitiationMethod || "",
          initiationTimestamp: ct.InitiationTimestamp?.toISOString() || null,
          state,
          waitingSeconds
        });
      } catch {
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
    const [agents, queued, meta] = await Promise.all([
      getAgents(),
      getQueuedContacts(),
      listQueuesAndStatuses()
    ]);
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
