import type { Handler } from "aws-lambda";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { ConnectClient, ListUsersCommand } from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";

// BYO Connect + Data Plane (#43+#46): module-active.
const legacyConnect = new ConnectClient({ maxAttempts: 2 });
let connect: ConnectClient = legacyConnect;
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
let activeInstanceId = CONNECT_INSTANCE_ID;

// userId → username cache, keyeada por instanceId.
const usernameCache = new Map<string, string>();
const userCacheExpiryByInstance = new Map<string, number>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function refreshUserCache(): Promise<void> {
  const exp = userCacheExpiryByInstance.get(activeInstanceId) || 0;
  if (Date.now() < exp) return;
  if (!activeInstanceId) return;
  const prefix = `${activeInstanceId}:`;
  for (const k of usernameCache.keys()) {
    if (k.startsWith(prefix)) usernameCache.delete(k);
  }
  let nextToken: string | undefined;
  for (let i = 0; i < 10; i++) {
    try {
      const res = await connect.send(
        new ListUsersCommand({
          InstanceId: activeInstanceId,
          MaxResults: 100,
          NextToken: nextToken,
        }),
      );
      for (const u of res.UserSummaryList ?? []) {
        if (u.Id && u.Username) usernameCache.set(`${activeInstanceId}:${u.Id}`, u.Username);
      }
      if (!res.NextToken) break;
      nextToken = res.NextToken;
    } catch {
      break;
    }
  }
  userCacheExpiryByInstance.set(activeInstanceId, Date.now() + 5 * 60 * 1000);
}

function resolveAgent(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  if (!UUID_RE.test(raw)) return raw;
  return usernameCache.get(`${activeInstanceId}:${raw}`) || raw;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    // BYO Connect + Data Plane: setea las 3 vars en un único trip.
    {
      const r = await resolveConnect(event?.headers, legacyConnect, CONNECT_INSTANCE_ID);
      connect = r.client;
      activeInstanceId = r.instanceId;
      dynamo = r.dynamo || legacyDynamo;
    }
    const params = event.queryStringParameters || {};
    const campaignId = params.campaignId;
    const statusFilter = params.status; // optional
    const limit = parseInt(params.limit || "100");
    // BUG-audit P2: paginar completo — aceptamos un cursor opcional (base64 del
    // ExclusiveStartKey) y devolvemos lastKey en la respuesta, así el caller
    // pide la siguiente página en vez de perder silenciosamente lo que pasa del
    // Limit. Cursor inválido → arrancamos desde el inicio.
    let startKey: Record<string, unknown> | undefined;
    if (params.cursor) {
      try {
        startKey = JSON.parse(Buffer.from(String(params.cursor), "base64").toString("utf8"));
      } catch {
        /* cursor inválido → desde el inicio */
      }
    }

    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" }),
      };
    }

    // Warm the username cache in parallel with the DynamoDB query.
    const cacheWarm = refreshUserCache();

    let items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    if (statusFilter) {
      const r = await dynamo.send(
        new QueryCommand({
          TableName: CONTACTS_TABLE,
          IndexName: "campaignId-status-index",
          KeyConditionExpression: "campaignId = :cid AND #st = :s",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: {
            ":cid": { S: campaignId },
            ":s": { S: statusFilter },
          },
          Limit: limit,
          ExclusiveStartKey: startKey as never,
        }),
      );
      items = (r.Items || []).map((it) => unmarshall(it));
      lastEvaluatedKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } else {
      const r = await dynamo.send(
        new QueryCommand({
          TableName: CONTACTS_TABLE,
          KeyConditionExpression: "campaignId = :cid",
          ExpressionAttributeValues: { ":cid": { S: campaignId } },
          Limit: limit,
          ExclusiveStartKey: startKey as never,
        }),
      );
      items = (r.Items || []).map((it) => unmarshall(it));
      lastEvaluatedKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    }

    // Parse customAttributes JSON back to object for convenience
    for (const it of items) {
      if (typeof it.customAttributes === "string") {
        try {
          it.customAttributes = JSON.parse(it.customAttributes);
        } catch {
          it.customAttributes = {};
        }
      }
    }

    // Resolve agent UUIDs → usernames before responding.
    await cacheWarm;
    for (const it of items) {
      const resolved = resolveAgent(it.agentUsername);
      if (resolved !== undefined) it.agentUsername = resolved;
    }

    // Sort by attempts desc then lastAttemptAt desc (most active first)
    items.sort((a, b) => {
      const ta = new Date((a.lastAttemptAt as string) || 0).getTime();
      const tb = new Date((b.lastAttemptAt as string) || 0).getTime();
      return tb - ta;
    });

    // lastKey = cursor base64 para la siguiente página (null = no hay más).
    const lastKey = lastEvaluatedKey
      ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString("base64")
      : null;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts: items, count: items.length, lastKey }),
    };
  } catch (err) {
    console.error("get-campaign-contacts error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get campaign contacts",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
