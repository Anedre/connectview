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

// amplify/functions/get-contact-history/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var import_client_customer_profiles = require("@aws-sdk/client-customer-profiles");
var connect = new import_client_connect.ConnectClient({ maxAttempts: 1 });
var profiles = new import_client_customer_profiles.CustomerProfilesClient({ maxAttempts: 1 });
var INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
var CUSTOMER_PROFILES_DOMAIN = process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";
var userCache = /* @__PURE__ */ new Map();
var queueCache = /* @__PURE__ */ new Map();
async function resolveAgentUsername(agentId) {
  if (!agentId) return "";
  if (userCache.has(agentId)) return userCache.get(agentId);
  try {
    const res = await connect.send(
      new import_client_connect.DescribeUserCommand({
        InstanceId: INSTANCE_ID,
        UserId: agentId
      })
    );
    const username = res.User?.Username || agentId;
    userCache.set(agentId, username);
    return username;
  } catch {
    userCache.set(agentId, agentId);
    return agentId;
  }
}
async function resolveQueueName(queueId) {
  if (!queueId) return "";
  if (queueCache.has(queueId)) return queueCache.get(queueId);
  try {
    const res = await connect.send(
      new import_client_connect.DescribeQueueCommand({
        InstanceId: INSTANCE_ID,
        QueueId: queueId
      })
    );
    const name = res.Queue?.Name || queueId;
    queueCache.set(queueId, name);
    return name;
  } catch {
    queueCache.set(queueId, queueId);
    return queueId;
  }
}
function deriveSubChannel(channel, initiationMethod, customerEndpointType) {
  if (channel !== "CHAT") return void 0;
  if (initiationMethod === "API") return "Messaging API";
  if (initiationMethod === "MESSAGING_PLATFORM") {
    if (customerEndpointType === "PHONE_NUMBER" || customerEndpointType === "TELEPHONE_NUMBER")
      return "WhatsApp/SMS";
    return "Messaging";
  }
  if (initiationMethod === "EXTERNAL_OUTBOUND") return "Outbound";
  return void 0;
}
function parseCtr(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function findProfileId(phone) {
  try {
    const res = await profiles.send(
      new import_client_customer_profiles.SearchProfilesCommand({
        DomainName: CUSTOMER_PROFILES_DOMAIN,
        KeyName: "_phone",
        Values: [phone]
      })
    );
    return res.Items?.[0]?.ProfileId || null;
  } catch (err) {
    console.warn("SearchProfiles failed, will fall back to SearchContacts:", err);
    return null;
  }
}
async function listProfileCtrs(profileId) {
  const res = await profiles.send(
    new import_client_customer_profiles.ListProfileObjectsCommand({
      DomainName: CUSTOMER_PROFILES_DOMAIN,
      ProfileId: profileId,
      ObjectTypeName: "CTR",
      MaxResults: 100
    })
  );
  const parsed = (res.Items || []).map((item) => parseCtr(item.Object || "{}")).filter((ctr) => ctr && ctr.contactId);
  const rows = await Promise.all(
    parsed.map(async (ctr) => {
      const agentId = ctr.agent?.arn?.split("/").pop() || ctr.agent?.id || "";
      const queueId = ctr.queue?.arn?.split("/").pop() || ctr.queue?.id || "";
      const [agentUsername, queueName] = await Promise.all([
        agentId ? resolveAgentUsername(agentId) : Promise.resolve(""),
        queueId ? resolveQueueName(queueId) : Promise.resolve(ctr.queue?.name || "")
      ]);
      const initiationMs = typeof ctr.initiationTimestamp === "number" ? ctr.initiationTimestamp : Date.parse(ctr.initiationTimestamp || "") || 0;
      const disconnectMs = typeof ctr.disconnectTimestamp === "number" ? ctr.disconnectTimestamp : Date.parse(ctr.disconnectTimestamp || "") || 0;
      const duration = initiationMs && disconnectMs ? Math.max(0, Math.round((disconnectMs - initiationMs) / 1e3)) : 0;
      return {
        contactId: ctr.contactId,
        channel: ctr.channel || "UNKNOWN",
        subChannel: deriveSubChannel(
          ctr.channel,
          ctr.initiationMethod,
          ctr.customerEndpoint?.type
        ),
        initiationTimestamp: initiationMs ? new Date(initiationMs).toISOString() : "",
        disconnectTimestamp: disconnectMs ? new Date(disconnectMs).toISOString() : "",
        duration,
        agentUsername,
        queueName: queueName || ctr.queue?.name || "",
        initiationMethod: ctr.initiationMethod,
        disconnectReason: ctr.disconnectReason,
        customerEndpoint: ctr.customerEndpoint?.address,
        hasRecording: Array.isArray(ctr.recordings) && ctr.recordings.length > 0
      };
    })
  );
  return rows;
}
async function searchContactsFallback(phone, maxDays) {
  const endTime = /* @__PURE__ */ new Date();
  const startTime = /* @__PURE__ */ new Date();
  startTime.setDate(startTime.getDate() - maxDays);
  const result = await connect.send(
    new import_client_connect.SearchContactsCommand({
      InstanceId: INSTANCE_ID,
      TimeRange: {
        Type: "INITIATION_TIMESTAMP",
        StartTime: startTime,
        EndTime: endTime
      },
      // Explicit list — make sure we don't miss any channel AWS adds later.
      SearchCriteria: {
        Channels: ["VOICE", "CHAT", "TASK", "EMAIL"]
      },
      MaxResults: 100
    })
  );
  const matching = (result.Contacts || []).filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c) => c.CustomerEndpoint?.Address === phone || c.CustomerEndpoint?.Value === phone
  );
  const rows = await Promise.all(
    matching.slice(0, 20).map(async (c) => {
      try {
        const detail = await connect.send(
          new import_client_connect.DescribeContactCommand({
            InstanceId: INSTANCE_ID,
            ContactId: c.Id
          })
        );
        const contact = detail.Contact;
        const duration = contact?.DisconnectTimestamp && contact?.InitiationTimestamp ? Math.round(
          (contact.DisconnectTimestamp.getTime() - contact.InitiationTimestamp.getTime()) / 1e3
        ) : 0;
        const agentId = contact?.AgentInfo?.Id || "";
        const queueId = contact?.QueueInfo?.Id || "";
        const [agentUsername, queueName] = await Promise.all([
          agentId ? resolveAgentUsername(agentId) : Promise.resolve(""),
          queueId ? resolveQueueName(queueId) : Promise.resolve("")
        ]);
        return {
          contactId: c.Id,
          channel: contact?.Channel || "UNKNOWN",
          subChannel: deriveSubChannel(
            contact?.Channel || "",
            contact?.InitiationMethod,
            contact?.CustomerEndpoint?.Type
          ),
          initiationTimestamp: contact?.InitiationTimestamp?.toISOString() || "",
          disconnectTimestamp: contact?.DisconnectTimestamp?.toISOString() || "",
          duration,
          agentUsername,
          queueName,
          initiationMethod: contact?.InitiationMethod,
          disconnectReason: contact?.DisconnectReason,
          customerEndpoint: contact?.CustomerEndpoint?.Address,
          hasRecording: (contact?.Recordings?.length || 0) > 0
        };
      } catch {
        return {
          contactId: c.Id,
          channel: "UNKNOWN",
          initiationTimestamp: c.InitiationTimestamp?.toISOString?.() || "",
          disconnectTimestamp: "",
          duration: 0,
          agentUsername: "",
          queueName: "",
          hasRecording: false
        };
      }
    })
  );
  return rows;
}
var handler = async (event) => {
  const phone = event.queryStringParameters?.phone;
  const maxDays = parseInt(event.queryStringParameters?.days || "90");
  if (!phone) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "phone parameter required" })
    };
  }
  try {
    let contacts = [];
    let source = "none";
    const profileId = await findProfileId(phone);
    if (profileId) {
      try {
        contacts = await listProfileCtrs(profileId);
        source = "customer-profiles";
      } catch (err) {
        console.warn("ListProfileObjects failed, falling back:", err);
      }
    }
    if (contacts.length === 0) {
      contacts = await searchContactsFallback(phone, maxDays);
      source = contacts.length > 0 ? "search-contacts" : "none";
    }
    contacts.sort(
      (a, b) => new Date(b.initiationTimestamp).getTime() - new Date(a.initiationTimestamp).getTime()
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        source,
        totalContacts: contacts.length,
        contacts
      })
    };
  } catch (error) {
    console.error("Error getting contact history:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get contact history",
        message: error instanceof Error ? error.message : "Unknown error"
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
