import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  DescribeUserCommand,
} from "@aws-sdk/client-connect";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { resolveConnect } from "../_shared/tenantConnect";

// BYO Connect + Data Plane (#43+#46): module-active. El helper resolveUsername
// lee `connect`/`instanceId`, el handler lee `dynamo`. Tres se setean del
// mismo round-trip a resolveConnect.
const legacyConnect = new ConnectClient({ maxAttempts: 1 });
let connect: ConnectClient = legacyConnect;
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
let instanceId = INSTANCE_ID;
const AGENTS_TABLE =
  process.env.CAMPAIGN_AGENTS_TABLE || "connectview-campaign-agents";

// Cache usernames per-instance (clave incluye instanceId para no mezclar tenants).
const userCache = new Map<string, string>();

async function resolveUsername(userId: string): Promise<string> {
  const k = `${instanceId}:${userId}`;
  if (userCache.has(k)) return userCache.get(k)!;
  try {
    const res = await connect.send(
      new DescribeUserCommand({ InstanceId: instanceId, UserId: userId })
    );
    const name = res.User?.Username || userId;
    userCache.set(k, name);
    return name;
  } catch {
    userCache.set(k, userId);
    return userId;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    // BYO Connect + Data Plane: setea las 3 vars module-active.
    {
      const r = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID);
      connect = r.client;
      instanceId = r.instanceId;
      dynamo = r.dynamo || legacyDynamo;
    }
    const campaignId = event.queryStringParameters?.campaignId;
    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" }),
      };
    }

    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    for (let i = 0; i < 5; i++) {
      const res = await dynamo.send(
        new QueryCommand({
          TableName: AGENTS_TABLE,
          KeyConditionExpression: "campaignId = :cid",
          ExpressionAttributeValues: { ":cid": { S: campaignId } },
          ExclusiveStartKey: lastKey as never,
        })
      );
      for (const it of res.Items || []) items.push(unmarshall(it));
      lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      if (!lastKey) break;
    }

    // Enrich with real usernames (in parallel)
    const enriched = await Promise.all(
      items.map(async (it) => ({
        userId: it.userId as string,
        username: await resolveUsername(it.userId as string),
        routingProfileId: it.routingProfileId as string,
        queueId: it.queueId as string,
        addedQueueToRoutingProfile: Boolean(it.addedQueueToRoutingProfile),
        priority: Number(it.priority || 5),
        delay: Number(it.delay || 0),
        addedAt: it.addedAt as string,
        addedBy: it.addedBy as string,
      }))
    );

    enriched.sort((a, b) => a.username.localeCompare(b.username));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        agents: enriched,
        total: enriched.length,
      }),
    };
  } catch (err) {
    console.error("get-campaign-agents error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get campaign agents",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
