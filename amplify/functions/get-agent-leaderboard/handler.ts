import type { Handler } from "aws-lambda";
import { ConnectClient, DescribeUserCommand } from "@aws-sdk/client-connect";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { resolveConnect } from "../_shared/tenantConnect";

// BYO Connect + Data Plane (#43+#46): module-active.
const legacyConnect = new ConnectClient({ maxAttempts: 1 });
let connect: ConnectClient = legacyConnect;
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "connectview-contacts";
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
let instanceId = INSTANCE_ID;

// Cache userId → username keyeada por instanceId.
const userCache = new Map<string, string>();

async function resolveUsername(userId: string): Promise<string> {
  if (!userId) return "";
  const k = `${instanceId}:${userId}`;
  if (userCache.has(k)) return userCache.get(k)!;
  // If it's already a human-readable username (not a UUID), keep it.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
  if (!isUuid) {
    userCache.set(k, userId);
    return userId;
  }
  try {
    const res = await connect.send(
      new DescribeUserCommand({ InstanceId: instanceId, UserId: userId }),
    );
    const username = res.User?.Username || userId;
    userCache.set(k, username);
    return username;
  } catch {
    userCache.set(k, userId);
    return userId;
  }
}

interface ContactRow {
  contactId: string;
  agentUsername: string;
  initiationTimestamp: string;
  duration?: number;
  sentiment?: string;
  sentimentPositive?: number;
  sentimentNegative?: number;
}

interface AgentScore {
  agentId: string;
  username: string;
  contactCount: number;
  totalDurationSec: number;
  positiveSegments: number;
  negativeSegments: number;
}

async function scanContactsWindow(startIso: string): Promise<ContactRow[]> {
  const rows: ContactRow[] = [];
  let lastKey: Record<string, unknown> | undefined;
  // BUG-audit P2: paginar completo (antes truncaba a 10 páginas). El
  // FilterExpression filtra DESPUÉS de leer ≤1MB por página, así que "10 páginas
  // ≈ 1000 filas" era falso: con el filtro podía cortar agentes del leaderboard.
  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "initiationTimestamp >= :start AND attribute_exists(agentUsername)",
        ExpressionAttributeValues: {
          ":start": { S: startIso },
        },
        ExclusiveStartKey: lastKey as never,
      }),
    );
    for (const it of result.Items || []) {
      rows.push(unmarshall(it) as ContactRow);
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return rows;
}

function aggregate(rows: ContactRow[]): Map<string, AgentScore> {
  const map = new Map<string, AgentScore>();
  for (const r of rows) {
    const agentId = r.agentUsername;
    if (!agentId) continue;
    let bucket = map.get(agentId);
    if (!bucket) {
      bucket = {
        agentId,
        username: agentId,
        contactCount: 0,
        totalDurationSec: 0,
        positiveSegments: 0,
        negativeSegments: 0,
      };
      map.set(agentId, bucket);
    }
    bucket.contactCount++;
    bucket.totalDurationSec += Number(r.duration || 0);
    bucket.positiveSegments += Number(r.sentimentPositive || 0);
    bucket.negativeSegments += Number(r.sentimentNegative || 0);
  }
  return map;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    // BYO Connect + Data Plane: setea connect/instanceId/dynamo.
    {
      const r = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID);
      connect = r.client;
      instanceId = r.instanceId;
      dynamo = r.dynamo || legacyDynamo;
    }
    const params = event.queryStringParameters || {};
    const rangeDays = parseInt(params.days || "7");
    const limit = parseInt(params.limit || "10");

    const now = Date.now();
    const currentWindowStart = new Date(now - rangeDays * 86400 * 1000);
    const previousWindowStart = new Date(now - rangeDays * 2 * 86400 * 1000);

    // Scan current window
    const currentRows = await scanContactsWindow(currentWindowStart.toISOString());

    // Scan previous window for delta (exclude current window)
    const previousAllRows = await scanContactsWindow(previousWindowStart.toISOString());
    const previousRows = previousAllRows.filter(
      (r) => new Date(r.initiationTimestamp) < currentWindowStart,
    );

    const currentAgg = aggregate(currentRows);
    const previousAgg = aggregate(previousRows);

    // Resolve usernames in parallel
    await Promise.all(
      [...currentAgg.values()].map(async (a) => {
        a.username = await resolveUsername(a.agentId);
      }),
    );

    // Build leaderboard sorted by contactCount desc
    const leaderboard = [...currentAgg.values()]
      .sort((a, b) => b.contactCount - a.contactCount)
      .slice(0, limit)
      .map((a, idx) => {
        const prev = previousAgg.get(a.agentId);
        const prevScore = prev?.contactCount || 0;
        const changePct =
          prevScore > 0
            ? Math.round(((a.contactCount - prevScore) / prevScore) * 100)
            : a.contactCount > 0
              ? 100
              : 0;
        const sentimentTotal = a.positiveSegments + a.negativeSegments;
        const sentimentScore =
          sentimentTotal > 0 ? Math.round((a.positiveSegments / sentimentTotal) * 100) : null;
        return {
          rank: idx + 1,
          agentId: a.agentId,
          username: a.username,
          contactCount: a.contactCount,
          totalMinutes: Math.round(a.totalDurationSec / 60),
          sentimentScore,
          changePct,
        };
      });

    // Badge counts (real ones, from the aggregate)
    const badges = {
      onFire: leaderboard.filter((a) => a.contactCount >= 10).length,
      topCsat: leaderboard.filter((a) => a.sentimentScore !== null && a.sentimentScore >= 70)
        .length,
      risingStar: leaderboard.filter((a) => a.changePct >= 20).length,
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rangeDays,
        totalAgents: currentAgg.size,
        totalContacts: currentRows.length,
        leaderboard,
        badges,
      }),
    };
  } catch (err) {
    console.error("leaderboard error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to compute leaderboard",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
