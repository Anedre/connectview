import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { ConnectClient, ListUsersCommand } from "@aws-sdk/client-connect";

const dynamo = new DynamoDBClient({});
const connect = new ConnectClient({ maxAttempts: 2 });
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

// userId → username cache. Refreshed at most every 5min per Lambda warm
// instance. Even if a campaign-contact row stored a UUID (legacy or
// before process-contact-event had perms), we resolve it on the fly so
// the UI never shows raw IDs.
const usernameCache = new Map<string, string>();
let userCacheExpiry = 0;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function refreshUserCache(): Promise<void> {
  if (Date.now() < userCacheExpiry && usernameCache.size > 0) return;
  if (!CONNECT_INSTANCE_ID) return;
  usernameCache.clear();
  let nextToken: string | undefined;
  for (let i = 0; i < 10; i++) {
    try {
      const res = await connect.send(
        new ListUsersCommand({
          InstanceId: CONNECT_INSTANCE_ID,
          MaxResults: 100,
          NextToken: nextToken,
        })
      );
      for (const u of res.UserSummaryList ?? []) {
        if (u.Id && u.Username) usernameCache.set(u.Id, u.Username);
      }
      if (!res.NextToken) break;
      nextToken = res.NextToken;
    } catch {
      break;
    }
  }
  userCacheExpiry = Date.now() + 5 * 60 * 1000;
}

function resolveAgent(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!UUID_RE.test(raw)) return raw; // already a username
  return usernameCache.get(raw) || raw;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    const campaignId = event.queryStringParameters?.campaignId;
    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" }),
      };
    }

    // Campaign meta + aggregate counters
    const metaRes = await dynamo.send(
      new GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
      })
    );
    if (!metaRes.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" }),
      };
    }
    const campaign = unmarshall(metaRes.Item);

    // Warm the username cache in parallel with the queries below — by
    // the time we project dialingContacts the map is ready.
    const cacheWarm = refreshUserCache();

    // Fresh counts from contacts table by status (authoritative, in case counters drift)
    const statuses = [
      "pending",
      "dialing",
      "connected",
      "done",
      "no_answer",
      "failed",
    ];
    const freshCounts: Record<string, number> = {};
    const dialingContacts: Array<{
      rowId: string;
      phone: string;
      customerName: string;
      agentUsername?: string;
      connectContactId?: string;
      status: string;
    }> = [];

    for (const st of statuses) {
      let count = 0;
      let lastKey: Record<string, unknown> | undefined;
      for (let i = 0; i < 5; i++) {
        const r = await dynamo.send(
          new QueryCommand({
            TableName: CONTACTS_TABLE,
            IndexName: "campaignId-status-index",
            KeyConditionExpression: "campaignId = :cid AND #st = :s",
            ExpressionAttributeNames: { "#st": "status" },
            ExpressionAttributeValues: {
              ":cid": { S: campaignId },
              ":s": { S: st },
            },
            Select: st === "dialing" || st === "connected" ? "ALL_PROJECTED_ATTRIBUTES" : "COUNT",
            ExclusiveStartKey: lastKey as never,
          })
        );
        count += r.Count || 0;
        if (st === "dialing" || st === "connected") {
          for (const it of r.Items || []) {
            const row = unmarshall(it);
            dialingContacts.push({
              rowId: row.rowId as string,
              phone: row.phone as string,
              customerName: (row.customerName as string) || "",
              // Resolve UUID → username before responding; the cache is
              // populated by the parallel ListUsers call we kicked off
              // above.
              agentUsername: resolveAgent(row.agentUsername as string | undefined),
              connectContactId: row.connectContactId as string | undefined,
              status: row.status as string,
            });
          }
        }
        lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
        if (!lastKey) break;
      }
      freshCounts[st] = count;
    }

    // Wait for the username cache (if it's still loading) and re-map
    // any UUID-shaped agentUsername values that snuck through above.
    await cacheWarm;
    for (const lc of dialingContacts) {
      lc.agentUsername = resolveAgent(lc.agentUsername);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign,
        counts: freshCounts,
        liveContacts: dialingContacts,
      }),
    };
  } catch (err) {
    console.error("get-campaign-stats error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get campaign stats",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
