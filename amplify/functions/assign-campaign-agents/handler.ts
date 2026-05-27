import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  DescribeUserCommand,
  DescribeRoutingProfileCommand,
  AssociateRoutingProfileQueuesCommand,
  DisassociateRoutingProfileQueuesCommand,
  ListRoutingProfileQueuesCommand,
} from "@aws-sdk/client-connect";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const connect = new ConnectClient({ maxAttempts: 1 });
const dynamo = new DynamoDBClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const AGENTS_TABLE =
  process.env.CAMPAIGN_AGENTS_TABLE || "connectview-campaign-agents";

interface AssignBody {
  campaignId: string;
  add?: string[]; // userIds to add
  remove?: string[]; // userIds to remove
  /** Per-agent queue assignment. When the campaign's flow routes to
   *  multiple queues (e.g. UDEP-Outbound-Smart branches on udep_nivel),
   *  the UI lets the admin pick a specific queue for each agent. When
   *  absent for a given userId, falls back to campaign.campaignQueueId.
   *  Keys are userIds, values are queueIds. */
  queueByUserId?: Record<string, string>;
  priority?: number; // queue priority (default 5)
  delay?: number; // queue delay (default 0)
  actor?: string;
}

interface CampaignRow {
  campaignId: string;
  campaignQueueId?: string;
}

async function getCampaign(campaignId: string): Promise<CampaignRow | null> {
  const res = await dynamo.send(
    new GetItemCommand({
      TableName: CAMPAIGNS_TABLE,
      Key: { campaignId: { S: campaignId } },
    })
  );
  return res.Item ? (unmarshall(res.Item) as CampaignRow) : null;
}

async function getUserRoutingProfile(userId: string): Promise<string | null> {
  try {
    const res = await connect.send(
      new DescribeUserCommand({
        InstanceId: INSTANCE_ID,
        UserId: userId,
      })
    );
    return res.User?.RoutingProfileId || null;
  } catch (err) {
    console.warn("DescribeUser failed for", userId, err);
    return null;
  }
}

async function routingProfileHasQueue(
  routingProfileId: string,
  queueId: string
): Promise<boolean> {
  try {
    let nextToken: string | undefined;
    do {
      const res = await connect.send(
        new ListRoutingProfileQueuesCommand({
          InstanceId: INSTANCE_ID,
          RoutingProfileId: routingProfileId,
          NextToken: nextToken,
          MaxResults: 100,
        })
      );
      if (
        (res.RoutingProfileQueueConfigSummaryList || []).some(
          (q) => q.QueueId === queueId
        )
      ) {
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

async function otherAssignmentsUseSamePair(
  routingProfileId: string,
  queueId: string,
  excludeCampaignId: string,
  excludeUserId: string
): Promise<boolean> {
  // Scan the agents table for any other (routingProfileId, queueId) pair still in use.
  // For small scale (< 10000 assignments) this is fine; for huge scale add a GSI.
  let lastKey: Record<string, unknown> | undefined;
  for (let i = 0; i < 10; i++) {
    const res = await dynamo.send(
      new ScanCommand({
        TableName: AGENTS_TABLE,
        FilterExpression:
          "routingProfileId = :rp AND queueId = :q AND NOT (campaignId = :cid AND userId = :uid)",
        ExpressionAttributeValues: {
          ":rp": { S: routingProfileId },
          ":q": { S: queueId },
          ":cid": { S: excludeCampaignId },
          ":uid": { S: excludeUserId },
        },
        ExclusiveStartKey: lastKey as never,
      })
    );
    if ((res.Count || 0) > 0) return true;
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    if (!lastKey) break;
  }
  return false;
}

async function associateQueueToRoutingProfile(
  routingProfileId: string,
  queueId: string,
  priority: number,
  delay: number
): Promise<void> {
  await connect.send(
    new AssociateRoutingProfileQueuesCommand({
      InstanceId: INSTANCE_ID,
      RoutingProfileId: routingProfileId,
      QueueConfigs: [
        {
          QueueReference: { QueueId: queueId, Channel: "VOICE" },
          Priority: priority,
          Delay: delay,
        },
      ],
    })
  );
}

async function disassociateQueueFromRoutingProfile(
  routingProfileId: string,
  queueId: string
): Promise<void> {
  await connect.send(
    new DisassociateRoutingProfileQueuesCommand({
      InstanceId: INSTANCE_ID,
      RoutingProfileId: routingProfileId,
      QueueReferences: [{ QueueId: queueId, Channel: "VOICE" }],
    })
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    const body: AssignBody = JSON.parse(event.body || "{}");
    const { campaignId } = body;
    const add = body.add || [];
    const remove = body.remove || [];
    const queueByUserId = body.queueByUserId || {};
    const priority = body.priority ?? 5;
    const delay = body.delay ?? 0;

    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" }),
      };
    }

    const campaign = await getCampaign(campaignId);
    if (!campaign) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" }),
      };
    }

    // The campaign-level queue is now a FALLBACK; per-agent queue comes
    // from queueByUserId. If neither is set for an agent, we reject the
    // add for that agent with a clear error.
    const fallbackQueueId = campaign.campaignQueueId;

    const results = {
      added: [] as string[],
      removed: [] as string[],
      errors: [] as string[],
      /** Map of userId -> queueId actually used (for the UI to confirm). */
      assignedQueueByUserId: {} as Record<string, string>,
    };

    // ----- ADD -----
    for (const userId of add) {
      try {
        // Per-agent queue resolution: explicit > campaign fallback > error.
        const queueId = queueByUserId[userId] || fallbackQueueId;
        if (!queueId) {
          results.errors.push(
            `${userId}: no queue specified and campaign has no fallback queue`
          );
          continue;
        }

        // Check if already assigned (idempotent)
        const existing = await dynamo.send(
          new GetItemCommand({
            TableName: AGENTS_TABLE,
            Key: {
              campaignId: { S: campaignId },
              userId: { S: userId },
            },
          })
        );
        if (existing.Item) {
          // Already assigned — keep it a no-op, not an error.
          results.added.push(userId);
          results.assignedQueueByUserId[userId] =
            (unmarshall(existing.Item).queueId as string) || queueId;
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
          new PutItemCommand({
            TableName: AGENTS_TABLE,
            Item: {
              campaignId: { S: campaignId },
              userId: { S: userId },
              routingProfileId: { S: routingProfileId },
              queueId: { S: queueId },
              addedQueueToRoutingProfile: {
                BOOL: addedQueueToRoutingProfile,
              },
              priority: { N: String(priority) },
              delay: { N: String(delay) },
              addedAt: { S: new Date().toISOString() },
              addedBy: { S: body.actor || "system" },
            },
          })
        );
        results.added.push(userId);
        results.assignedQueueByUserId[userId] = queueId;
      } catch (err) {
        results.errors.push(
          `add ${userId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // ----- REMOVE -----
    for (const userId of remove) {
      try {
        const existing = await dynamo.send(
          new GetItemCommand({
            TableName: AGENTS_TABLE,
            Key: {
              campaignId: { S: campaignId },
              userId: { S: userId },
            },
          })
        );
        if (!existing.Item) {
          // Nothing to remove — idempotent
          results.removed.push(userId);
          continue;
        }
        const row = unmarshall(existing.Item);
        const routingProfileId = row.routingProfileId as string;
        const rowQueueId = row.queueId as string;
        const wasAdded = Boolean(row.addedQueueToRoutingProfile);

        await dynamo.send(
          new DeleteItemCommand({
            TableName: AGENTS_TABLE,
            Key: {
              campaignId: { S: campaignId },
              userId: { S: userId },
            },
          })
        );

        // Only remove the queue from the routing profile if:
        //  1. WE added it originally (not a pre-existing queue)
        //  2. NO other active assignment still needs it
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
              // Don't fail the whole request if cleanup fails
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
      body: JSON.stringify(results),
    };
  } catch (err) {
    console.error("assign-campaign-agents error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to assign agents",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};

// Suppress unused imports warning for helpers used only through DescribeRoutingProfileCommand references
void DescribeRoutingProfileCommand;
void QueryCommand;
