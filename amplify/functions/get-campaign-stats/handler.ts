import type { Handler } from "aws-lambda";
import { DynamoDBClient, GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { ConnectClient, ListUsersCommand, DescribeQueueCommand } from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";

// BYO Connect + Data Plane (#43+#46): module-active. resolveConnect del
// handler entry setea las 3 vars en un único round-trip a STS.
const legacyConnect = new ConnectClient({ maxAttempts: 2 });
let connect: ConnectClient = legacyConnect;
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
const AGENTS_TABLE = process.env.CAMPAIGN_AGENTS_TABLE || "connectview-campaign-agents";
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
let activeInstanceId = CONNECT_INSTANCE_ID;

// userId → username cache, keyeada por instanceId para no mezclar tenants.
const usernameCache = new Map<string, string>();
const userCacheExpiryByInstance = new Map<string, number>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function refreshUserCache(): Promise<void> {
  const exp = userCacheExpiryByInstance.get(activeInstanceId) || 0;
  if (Date.now() < exp) return;
  if (!activeInstanceId) return;
  // Limpiar SOLO la sub-cache de esta instancia (keys con prefijo `${instanceId}:`).
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

function resolveAgent(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!UUID_RE.test(raw)) return raw; // already a username
  return usernameCache.get(`${activeInstanceId}:${raw}`) || raw;
}

// queueId → nombre, cacheado por instancia (para el monitoreo por cola).
const queueNameCache = new Map<string, string>();
async function resolveQueueName(queueId: string): Promise<string> {
  if (!queueId) return "";
  const key = `${activeInstanceId}:${queueId}`;
  if (queueNameCache.has(key)) return queueNameCache.get(key)!;
  try {
    const r = await connect.send(
      new DescribeQueueCommand({ InstanceId: activeInstanceId, QueueId: queueId }),
    );
    const name = r.Queue?.Name || queueId;
    queueNameCache.set(key, name);
    return name;
  } catch {
    queueNameCache.set(key, queueId);
    return queueId;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    // BYO Connect + Data Plane: setea connect/instanceId/dynamo en un único trip.
    {
      const r = await resolveConnect(event?.headers, legacyConnect, CONNECT_INSTANCE_ID);
      connect = r.client;
      activeInstanceId = r.instanceId;
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

    // Campaign meta + aggregate counters
    const metaRes = await dynamo.send(
      new GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
      }),
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
    // Incluye suppressed/skipped/cancelled: antes NO se contaban → esos contactos
    // "desaparecían" del total del detalle (el desglose no cuadraba con totalContacts).
    const statuses = [
      "pending",
      "dialing",
      "connected",
      "done",
      "no_answer",
      "failed",
      "suppressed",
      "skipped",
      "cancelled",
    ];
    const freshCounts: Record<string, number> = {};
    const dialingContacts: Array<{
      rowId: string;
      phone: string;
      customerName: string;
      agentUsername?: string;
      assignedAgentUserId?: string;
      connectContactId?: string;
      status: string;
    }> = [];

    for (const st of statuses) {
      let count = 0;
      let lastKey: Record<string, unknown> | undefined;
      // BUG-audit P2: paginar completo (antes truncaba a 5 páginas)
      do {
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
          }),
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
              assignedAgentUserId: row.assignedAgentUserId as string | undefined,
              connectContactId: row.connectContactId as string | undefined,
              status: row.status as string,
            });
          }
        }
        lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);
      freshCounts[st] = count;
    }

    // Wait for the username cache (if it's still loading) and re-map
    // any UUID-shaped agentUsername values that snuck through above.
    await cacheWarm;
    for (const lc of dialingContacts) {
      lc.agentUsername = resolveAgent(lc.agentUsername);
    }

    // ── Monitoreo por AGENTE + por COLA ──────────────────────────────────
    // Roster: agentes asignados a la campaña + su cola (connectview-campaign-agents).
    const roster: { userId: string; queueId: string }[] = [];
    try {
      const rr = await dynamo.send(
        new QueryCommand({
          TableName: AGENTS_TABLE,
          KeyConditionExpression: "campaignId = :cid",
          ExpressionAttributeValues: { ":cid": { S: campaignId } },
        }),
      );
      for (const it of rr.Items || []) {
        const r = unmarshall(it);
        if (r.userId)
          roster.push({ userId: r.userId as string, queueId: (r.queueId as string) || "" });
      }
    } catch (e) {
      console.warn("roster query failed:", e);
    }
    const queueIds = [...new Set(roster.map((r) => r.queueId).filter(Boolean))];
    const queueNames = new Map<string, string>();
    await Promise.all(
      queueIds.map(async (qid) => queueNames.set(qid, await resolveQueueName(qid))),
    );
    // Contactos en vivo (dialing/connected) agrupados por el agente dueño del bucket.
    const liveByAgent = new Map<string, { dialing: number; connected: number; names: string[] }>();
    for (const lc of dialingContacts) {
      const uid = lc.assignedAgentUserId || "";
      if (!uid) continue;
      const e = liveByAgent.get(uid) || { dialing: 0, connected: 0, names: [] };
      if (lc.status === "dialing") e.dialing++;
      if (lc.status === "connected") e.connected++;
      if (lc.customerName) e.names.push(lc.customerName);
      liveByAgent.set(uid, e);
    }
    const rosterQueueByAgent = new Map(roster.map((r) => [r.userId, r.queueId]));
    const agentIds = new Set<string>([...roster.map((r) => r.userId), ...liveByAgent.keys()]);
    const byAgent = [...agentIds]
      .map((uid) => {
        const qid = rosterQueueByAgent.get(uid) || "";
        const live = liveByAgent.get(uid) || { dialing: 0, connected: 0, names: [] };
        return {
          userId: uid,
          username: resolveAgent(uid) || uid,
          queueId: qid,
          queueName: queueNames.get(qid) || qid || "—",
          dialing: live.dialing,
          connected: live.connected,
          liveNames: live.names.slice(0, 6),
        };
      })
      .sort(
        (a, b) =>
          b.connected + b.dialing - (a.connected + a.dialing) ||
          a.username.localeCompare(b.username),
      );
    const queueAgg = new Map<
      string,
      { queueName: string; agents: number; dialing: number; connected: number }
    >();
    for (const a of byAgent) {
      const e = queueAgg.get(a.queueId) || {
        queueName: a.queueName,
        agents: 0,
        dialing: 0,
        connected: 0,
      };
      e.agents++;
      e.dialing += a.dialing;
      e.connected += a.connected;
      queueAgg.set(a.queueId, e);
    }
    const byQueue = [...queueAgg.entries()].map(([queueId, e]) => ({ queueId, ...e }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign,
        counts: freshCounts,
        liveContacts: dialingContacts,
        byAgent,
        byQueue,
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
