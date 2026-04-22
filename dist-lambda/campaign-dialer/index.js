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

// amplify/functions/campaign-dialer/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_util_dynamodb = require("@aws-sdk/util-dynamodb");
var import_client_connect = require("@aws-sdk/client-connect");
var dynamo = new import_client_dynamodb.DynamoDBClient({});
var connect = new import_client_connect.ConnectClient({ maxAttempts: 1 });
var CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
var CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
var CAMPAIGN_AGENTS_TABLE = process.env.CAMPAIGN_AGENTS_TABLE || "connectview-campaign-agents";
var INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
var AMD_FLOW_ID = process.env.AMD_FLOW_ID || "";
var AMD_ENABLED = (process.env.AMD_ENABLED ?? "true").toLowerCase() !== "false";
function isWithinWindow(campaign) {
  try {
    const allowedDays = JSON.parse(
      campaign.windowDaysOfWeek || "[1,2,3,4,5]"
    );
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: campaign.timezone || "America/Lima",
      hour: "2-digit",
      hour12: false,
      weekday: "short"
    });
    const parts = fmt.formatToParts(/* @__PURE__ */ new Date());
    const hour = parseInt(
      parts.find((p) => p.type === "hour")?.value || "0"
    );
    const weekdayStr = parts.find((p) => p.type === "weekday")?.value || "";
    const weekdayMap = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6
    };
    const weekday = weekdayMap[weekdayStr] ?? -1;
    if (weekday < 0) return true;
    if (!allowedDays.includes(weekday)) return false;
    return hour >= campaign.windowStartHour && hour < campaign.windowEndHour;
  } catch {
    return true;
  }
}
async function listRunningCampaigns() {
  const res = await dynamo.send(
    new import_client_dynamodb.QueryCommand({
      TableName: CAMPAIGNS_TABLE,
      IndexName: "status-createdAt-index",
      KeyConditionExpression: "#st = :s",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: { ":s": { S: "RUNNING" } }
    })
  );
  return (res.Items || []).map((it) => (0, import_util_dynamodb.unmarshall)(it));
}
async function countDialingForCampaign(campaignId) {
  const res = await dynamo.send(
    new import_client_dynamodb.QueryCommand({
      TableName: CONTACTS_TABLE,
      IndexName: "campaignId-status-index",
      KeyConditionExpression: "campaignId = :cid AND #st = :s",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":cid": { S: campaignId },
        ":s": { S: "dialing" }
      },
      Select: "COUNT"
    })
  );
  return res.Count || 0;
}
async function findPendingContacts(campaignId, limit) {
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const res = await dynamo.send(
    new import_client_dynamodb.QueryCommand({
      TableName: CONTACTS_TABLE,
      IndexName: "campaignId-status-index",
      KeyConditionExpression: "campaignId = :cid AND #st = :s",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":cid": { S: campaignId },
        ":s": { S: "pending" },
        ":now": { S: nowIso }
      },
      FilterExpression: "attribute_not_exists(nextRetryAt) OR nextRetryAt <= :now",
      Limit: limit
    })
  );
  const items = (res.Items || []).map(
    (it) => (0, import_util_dynamodb.unmarshall)(it)
  );
  return items.filter((c) => !c.nextRetryAt || c.nextRetryAt <= nowIso);
}
var allUserIdsCache = null;
async function listAllUserIds() {
  if (allUserIdsCache) return allUserIdsCache;
  const ids = [];
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
      if (u.Id) ids.push(u.Id);
    }
    nextToken = res.NextToken;
  } while (nextToken);
  allUserIdsCache = ids;
  return ids;
}
async function getAssignedAgents(campaignId) {
  const res = await dynamo.send(
    new import_client_dynamodb.QueryCommand({
      TableName: CAMPAIGN_AGENTS_TABLE,
      KeyConditionExpression: "campaignId = :cid",
      ExpressionAttributeValues: { ":cid": { S: campaignId } }
    })
  );
  return (res.Items || []).map((it) => it.userId?.S || "").filter(Boolean);
}
async function countAvailableFromUsers(userIds) {
  if (userIds.length === 0) return 0;
  let available = 0;
  try {
    for (let i = 0; i < userIds.length; i += 100) {
      const batch = userIds.slice(i, i + 100);
      const res = await connect.send(
        new import_client_connect.GetCurrentUserDataCommand({
          InstanceId: INSTANCE_ID,
          Filters: { Agents: batch }
        })
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
async function markAsDialing(c) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await dynamo.send(
      new import_client_dynamodb.UpdateItemCommand({
        TableName: CONTACTS_TABLE,
        Key: {
          campaignId: { S: c.campaignId },
          rowId: { S: c.rowId }
        },
        UpdateExpression: "SET #st = :dialing, lastAttemptAt = :now, attempts = attempts + :one",
        ConditionExpression: "#st = :pending",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":dialing": { S: "dialing" },
          ":pending": { S: "pending" },
          ":now": { S: now },
          ":one": { N: "1" }
        }
      })
    );
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
      return false;
    }
    throw err;
  }
}
async function markAsFailed(c, reason) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await dynamo.send(
    new import_client_dynamodb.UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: c.campaignId },
        rowId: { S: c.rowId }
      },
      UpdateExpression: "SET #st = :failed, lastAttemptAt = :now, lastError = :err",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":failed": { S: "failed" },
        ":now": { S: now },
        ":err": { S: reason.slice(0, 500) }
      }
    })
  );
  await dynamo.send(
    new import_client_dynamodb.UpdateItemCommand({
      TableName: CAMPAIGNS_TABLE,
      Key: { campaignId: { S: c.campaignId } },
      UpdateExpression: "ADD failedCount :one, pendingCount :neg",
      ExpressionAttributeValues: {
        ":one": { N: "1" },
        ":neg": { N: "-1" }
      }
    })
  ).catch(() => {
  });
}
async function startOutbound(campaign, contact) {
  try {
    let customAttrs = {};
    try {
      customAttrs = JSON.parse(contact.customAttributes || "{}");
    } catch {
    }
    const attributes = {
      campaignId: campaign.campaignId,
      campaignName: campaign.name.slice(0, 256),
      campaignRowId: contact.rowId,
      customerName: contact.customerName.slice(0, 256),
      ...Object.fromEntries(
        Object.entries(customAttrs).slice(0, 30).map(([k, v]) => [k.slice(0, 127), String(v).slice(0, 256)])
      )
    };
    const useAmd = AMD_ENABLED && !!AMD_FLOW_ID;
    const contactFlowId = useAmd ? AMD_FLOW_ID : campaign.contactFlowId;
    const res = await connect.send(
      new import_client_connect.StartOutboundVoiceContactCommand({
        InstanceId: INSTANCE_ID,
        ContactFlowId: contactFlowId,
        DestinationPhoneNumber: contact.phone,
        SourcePhoneNumber: campaign.sourcePhoneNumber,
        Attributes: attributes,
        ClientToken: `${contact.rowId}-${contact.attempts}-${Date.now()}`.slice(0, 500),
        // AMD config — works on GENERAL traffic. The contact flow (AMD_FLOW_ID)
        // reads the result via CheckOutboundCallStatus and branches.
        ...useAmd ? {
          AnswerMachineDetectionConfig: {
            EnableAnswerMachineDetection: true,
            AwaitAnswerMachinePrompt: false
          }
        } : {}
      })
    );
    return res.ContactId || null;
  } catch (err) {
    console.error("StartOutboundVoiceContact failed:", err);
    return null;
  }
}
async function linkConnectContact(c, connectContactId) {
  await dynamo.send(
    new import_client_dynamodb.UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: c.campaignId },
        rowId: { S: c.rowId }
      },
      UpdateExpression: "SET connectContactId = :cid",
      ExpressionAttributeValues: { ":cid": { S: connectContactId } }
    })
  );
}
async function rollbackToPending(c) {
  await dynamo.send(
    new import_client_dynamodb.UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: c.campaignId },
        rowId: { S: c.rowId }
      },
      UpdateExpression: "SET #st = :pending",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: { ":pending": { S: "pending" } }
    })
  );
}
async function maybeCompleteCampaign(campaign) {
  const statuses = ["pending", "dialing", "connected"];
  let total = 0;
  for (const st of statuses) {
    const r = await dynamo.send(
      new import_client_dynamodb.QueryCommand({
        TableName: CONTACTS_TABLE,
        IndexName: "campaignId-status-index",
        KeyConditionExpression: "campaignId = :cid AND #st = :s",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":cid": { S: campaign.campaignId },
          ":s": { S: st }
        },
        Select: "COUNT"
      })
    );
    total += r.Count || 0;
  }
  if (total === 0) {
    await dynamo.send(
      new import_client_dynamodb.UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaign.campaignId } },
        UpdateExpression: "SET #st = :c, completedAt = :now",
        ConditionExpression: "#st = :running",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":c": { S: "COMPLETED" },
          ":running": { S: "RUNNING" },
          ":now": { S: (/* @__PURE__ */ new Date()).toISOString() }
        }
      })
    ).catch(() => {
    });
  }
}
var handler = async () => {
  try {
    const campaigns = await listRunningCampaigns();
    console.log(`[dialer] running campaigns: ${campaigns.length}`);
    if (campaigns.length === 0) {
      return { ok: true, campaignsProcessed: 0 };
    }
    for (const campaign of campaigns) {
      if (!isWithinWindow(campaign)) {
        console.log(`[dialer] ${campaign.campaignId} outside calling window`);
        continue;
      }
      const currentlyDialing = await countDialingForCampaign(campaign.campaignId);
      const maxConcurrency = Number(campaign.concurrency) || 1;
      const availableSlots = Math.max(0, maxConcurrency - currentlyDialing);
      const ratio = campaign.dialMode === "power" ? 2 : 1;
      let toDial;
      let slotsRemaining = 0;
      if (campaign.dialMode === "agentless") {
        toDial = availableSlots;
      } else {
        const assignedIds = await getAssignedAgents(campaign.campaignId);
        const poolIds = assignedIds.length > 0 ? assignedIds : await listAllUserIds();
        slotsRemaining = await countAvailableFromUsers(poolIds);
        console.log(
          `[dialer] ${campaign.campaignId}: assigned=${assignedIds.length}, pool=${poolIds.length}, available=${slotsRemaining}`
        );
        toDial = Math.min(availableSlots, slotsRemaining * ratio);
      }
      if (toDial <= 0) continue;
      const candidates = await findPendingContacts(campaign.campaignId, toDial);
      if (candidates.length === 0) {
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
          slotsRemaining -= 1 / ratio;
        }
        if (slotsRemaining <= 0 && campaign.dialMode !== "agentless") break;
      }
      void rollbackToPending;
    }
    return { ok: true, campaignsProcessed: campaigns.length };
  } catch (err) {
    console.error("dialer error", err);
    throw err;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
