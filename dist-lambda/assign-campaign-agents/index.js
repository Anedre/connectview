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

// amplify/functions/assign-campaign-agents/handler.ts
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
var CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
var AGENTS_TABLE = process.env.CAMPAIGN_AGENTS_TABLE || "connectview-campaign-agents";
async function getCampaign(campaignId) {
  const res = await dynamo.send(
    new import_client_dynamodb.GetItemCommand({
      TableName: CAMPAIGNS_TABLE,
      Key: { campaignId: { S: campaignId } }
    })
  );
  return res.Item ? (0, import_util_dynamodb.unmarshall)(res.Item) : null;
}
async function getUserRoutingProfile(userId) {
  try {
    const res = await connect.send(
      new import_client_connect.DescribeUserCommand({
        InstanceId: INSTANCE_ID,
        UserId: userId
      })
    );
    return res.User?.RoutingProfileId || null;
  } catch (err) {
    console.warn("DescribeUser failed for", userId, err);
    return null;
  }
}
async function routingProfileHasQueue(routingProfileId, queueId) {
  try {
    let nextToken;
    do {
      const res = await connect.send(
        new import_client_connect.ListRoutingProfileQueuesCommand({
          InstanceId: INSTANCE_ID,
          RoutingProfileId: routingProfileId,
          NextToken: nextToken,
          MaxResults: 100
        })
      );
      if ((res.RoutingProfileQueueConfigSummaryList || []).some(
        (q) => q.QueueId === queueId
      )) {
        return true;
      }
      nextToken = res.NextToken;
    } while (nextToken);
    return false;
  } catch (err) {
    console.warn("ListRoutingProfileQueues failed:", err);
    return false;
  }
}
async function otherAssignmentsUseSamePair(routingProfileId, queueId, excludeCampaignId, excludeUserId) {
  let lastKey;
  for (let i = 0; i < 10; i++) {
    const res = await dynamo.send(
      new import_client_dynamodb.ScanCommand({
        TableName: AGENTS_TABLE,
        FilterExpression: "routingProfileId = :rp AND queueId = :q AND NOT (campaignId = :cid AND userId = :uid)",
        ExpressionAttributeValues: {
          ":rp": { S: routingProfileId },
          ":q": { S: queueId },
          ":cid": { S: excludeCampaignId },
          ":uid": { S: excludeUserId }
        },
        ExclusiveStartKey: lastKey
      })
    );
    if ((res.Count || 0) > 0) return true;
    lastKey = res.LastEvaluatedKey;
    if (!lastKey) break;
  }
  return false;
}
async function associateQueueToRoutingProfile(routingProfileId, queueId, priority, delay) {
  await connect.send(
    new import_client_connect.AssociateRoutingProfileQueuesCommand({
      InstanceId: INSTANCE_ID,
      RoutingProfileId: routingProfileId,
      QueueConfigs: [
        {
          QueueReference: { QueueId: queueId, Channel: "VOICE" },
          Priority: priority,
          Delay: delay
        }
      ]
    })
  );
}
async function disassociateQueueFromRoutingProfile(routingProfileId, queueId) {
  await connect.send(
    new import_client_connect.DisassociateRoutingProfileQueuesCommand({
      InstanceId: INSTANCE_ID,
      RoutingProfileId: routingProfileId,
      QueueReferences: [{ QueueId: queueId, Channel: "VOICE" }]
    })
  );
}
var handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { campaignId } = body;
    const add = body.add || [];
    const remove = body.remove || [];
    const priority = body.priority ?? 5;
    const delay = body.delay ?? 0;
    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" })
      };
    }
    const campaign = await getCampaign(campaignId);
    if (!campaign) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" })
      };
    }
    const queueId = campaign.campaignQueueId;
    if (!queueId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Campaign has no campaignQueueId set. Edit the campaign first to choose a queue."
        })
      };
    }
    const results = {
      added: [],
      removed: [],
      errors: [],
      queueId
    };
    for (const userId of add) {
      try {
        const existing = await dynamo.send(
          new import_client_dynamodb.GetItemCommand({
            TableName: AGENTS_TABLE,
            Key: {
              campaignId: { S: campaignId },
              userId: { S: userId }
            }
          })
        );
        if (existing.Item) {
          results.added.push(userId);
          continue;
        }
        const routingProfileId = await getUserRoutingProfile(userId);
        if (!routingProfileId) {
          results.errors.push(`${userId}: no routing profile found`);
          continue;
        }
        const hasQueue = await routingProfileHasQueue(
          routingProfileId,
          queueId
        );
        let addedQueueToRoutingProfile = false;
        if (!hasQueue) {
          await associateQueueToRoutingProfile(
            routingProfileId,
            queueId,
            priority,
            delay
          );
          addedQueueToRoutingProfile = true;
        }
        await dynamo.send(
          new import_client_dynamodb.PutItemCommand({
            TableName: AGENTS_TABLE,
            Item: {
              campaignId: { S: campaignId },
              userId: { S: userId },
              routingProfileId: { S: routingProfileId },
              queueId: { S: queueId },
              addedQueueToRoutingProfile: {
                BOOL: addedQueueToRoutingProfile
              },
              priority: { N: String(priority) },
              delay: { N: String(delay) },
              addedAt: { S: (/* @__PURE__ */ new Date()).toISOString() },
              addedBy: { S: body.actor || "system" }
            }
          })
        );
        results.added.push(userId);
      } catch (err) {
        results.errors.push(
          `add ${userId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    for (const userId of remove) {
      try {
        const existing = await dynamo.send(
          new import_client_dynamodb.GetItemCommand({
            TableName: AGENTS_TABLE,
            Key: {
              campaignId: { S: campaignId },
              userId: { S: userId }
            }
          })
        );
        if (!existing.Item) {
          results.removed.push(userId);
          continue;
        }
        const row = (0, import_util_dynamodb.unmarshall)(existing.Item);
        const routingProfileId = row.routingProfileId;
        const rowQueueId = row.queueId;
        const wasAdded = Boolean(row.addedQueueToRoutingProfile);
        await dynamo.send(
          new import_client_dynamodb.DeleteItemCommand({
            TableName: AGENTS_TABLE,
            Key: {
              campaignId: { S: campaignId },
              userId: { S: userId }
            }
          })
        );
        if (wasAdded) {
          const stillNeeded = await otherAssignmentsUseSamePair(
            routingProfileId,
            rowQueueId,
            campaignId,
            userId
          );
          if (!stillNeeded) {
            try {
              await disassociateQueueFromRoutingProfile(
                routingProfileId,
                rowQueueId
              );
            } catch (err) {
              console.warn("disassociate failed:", err);
            }
          }
        }
        results.removed.push(userId);
      } catch (err) {
        results.errors.push(
          `remove ${userId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(results)
    };
  } catch (err) {
    console.error("assign-campaign-agents error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to assign agents",
        message: err instanceof Error ? err.message : String(err)
      })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
