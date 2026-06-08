import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  GetCurrentMetricDataCommand,
  GetCurrentUserDataCommand,
  GetMetricDataV2Command,
  ListQueuesCommand,
  ListUsersCommand,
  type CurrentMetric,
} from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";

const legacyConnect = new ConnectClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
/** SLA threshold (seconds) for SERVICE_LEVEL — matches the frontend WAIT_SLA_SECONDS. */
const SLA_THRESHOLD_SECONDS = Number(process.env.SLA_THRESHOLD_SECONDS ?? "30");
/** Operation timezone offset vs UTC, in hours. Peru/America-Lima is UTC-5
 *  year-round (no DST), so "today" starts at 05:00 UTC. */
const TZ_OFFSET_HOURS = Number(process.env.METRICS_TZ_OFFSET_HOURS ?? "5");

// Module-active: el handler las setea al inicio de cada invocación a partir
// de resolveConnect (Lambda procesa un evento a la vez por contenedor → seguro).
// Los helpers de abajo (refreshUserNameCache/getQueueIds/getTodayQueueMetrics)
// leen estas en vez de las hardcodeadas → cada tenant pega a SU Connect.
let activeConnect = legacyConnect;
let activeInstanceId = INSTANCE_ID;
let activeInstanceArn = "";

// userId → human-readable username, refreshed on warm-start every ~5min.
// Building this once per Lambda init makes the per-request agent name
// resolution effectively free (no extra API hop).
// Keyeado por `${instanceId}:${userId}` para no mezclar tenants.
const userNameCache = new Map<string, string>();
// Expiry por instancia (no global), por la misma razón.
const userCacheExpiryByInstance = new Map<string, number>();

async function refreshUserNameCache(): Promise<void> {
  const exp = userCacheExpiryByInstance.get(activeInstanceId) || 0;
  if (Date.now() < exp) return;
  // Limpiar sólo las entradas de ESTA instancia (no las de otros tenants).
  const prefix = `${activeInstanceId}:`;
  for (const k of userNameCache.keys()) {
    if (k.startsWith(prefix)) userNameCache.delete(k);
  }
  let nextToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await activeConnect.send(
      new ListUsersCommand({
        InstanceId: activeInstanceId,
        MaxResults: 100,
        NextToken: nextToken,
      })
    );
    for (const u of res.UserSummaryList ?? []) {
      if (u.Id && u.Username) userNameCache.set(`${activeInstanceId}:${u.Id}`, u.Username);
    }
    if (!res.NextToken) break;
    nextToken = res.NextToken;
  }
  userCacheExpiryByInstance.set(activeInstanceId, Date.now() + 5 * 60 * 1000);
}

const QUEUE_METRICS: CurrentMetric[] = [
  { Name: "CONTACTS_IN_QUEUE", Unit: "COUNT" },
  { Name: "OLDEST_CONTACT_AGE", Unit: "SECONDS" },
  { Name: "AGENTS_AVAILABLE", Unit: "COUNT" },
  { Name: "AGENTS_ONLINE", Unit: "COUNT" },
  { Name: "AGENTS_ON_CALL", Unit: "COUNT" },
  { Name: "AGENTS_AFTER_CONTACT_WORK", Unit: "COUNT" },
];

// Cache queue IDs for 5 minutes to avoid listing queues on every poll.
// Per-instance: cada tenant tiene su propia lista de colas.
const cachedQueueIdsByInstance = new Map<string, { ids: string[]; exp: number }>();

async function getQueueIds(): Promise<string[]> {
  const hit = cachedQueueIdsByInstance.get(activeInstanceId);
  if (hit && hit.ids.length > 0 && Date.now() < hit.exp) {
    return hit.ids;
  }

  const response = await activeConnect.send(
    new ListQueuesCommand({
      InstanceId: activeInstanceId,
      QueueTypes: ["STANDARD"],
    })
  );

  const ids =
    response.QueueSummaryList?.map((q) => q.Id!).filter(Boolean) || [];
  cachedQueueIdsByInstance.set(activeInstanceId, {
    ids,
    exp: Date.now() + 5 * 60 * 1000,
  });
  return ids;
}

// Cache queue name mapping (keyed by `${instanceId}:${queueId}` para no mezclar tenants).
const queueNameCache = new Map<string, string>();

/** Build the Connect instance ARN from the Lambda's own ARN (for the account)
 *  + region + the configured instance id — usado SÓLO en el path legacy
 *  (cuando el tenant no tiene Connect configurado, caemos a la instancia de Vox). */
function buildLegacyInstanceArn(invokedFunctionArn: string): string {
  const region = process.env.AWS_REGION || "us-east-1";
  const account = invokedFunctionArn.split(":")[4] || "";
  return `arn:aws:connect:${region}:${account}:instance/${INSTANCE_ID}`;
}

interface QueueDayMetrics {
  handled: number;
  abandoned: number;
  queued: number;
  serviceLevel: number; // %
  avgHandleTime: number; // seconds
  avgAcw: number; // seconds (after-contact work)
}

/** Start of "today" in the operation timezone (UTC-5 default), as a UTC Date. */
function startOfTodayUtc(): Date {
  const offsetMs = TZ_OFFSET_HOURS * 60 * 60 * 1000;
  const local = new Date(Date.now() - offsetMs);
  const localMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    0, 0, 0, 0
  );
  return new Date(localMidnight + offsetMs);
}

/**
 * Today's aggregated per-queue metrics via GetMetricDataV2 (handled, abandoned,
 * queued, service level @30s, AHT). Best-effort: any failure (e.g. missing
 * permission, throttling) returns an empty map so the realtime snapshot still
 * succeeds. Queues with no activity today are simply absent from the result.
 */
async function getTodayQueueMetrics(
  instanceArn: string,
  queueIds: string[]
): Promise<Map<string, QueueDayMetrics>> {
  const out = new Map<string, QueueDayMetrics>();
  if (!instanceArn || queueIds.length === 0) return out;
  try {
    const startTime = startOfTodayUtc();
    const endTime = new Date();
    let nextToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await activeConnect.send(
        new GetMetricDataV2Command({
          ResourceArn: instanceArn,
          StartTime: startTime,
          EndTime: endTime,
          Filters: [{ FilterKey: "QUEUE", FilterValues: queueIds }],
          Groupings: ["QUEUE"],
          Metrics: [
            { Name: "CONTACTS_HANDLED" },
            { Name: "CONTACTS_ABANDONED" },
            { Name: "CONTACTS_QUEUED" },
            {
              Name: "SERVICE_LEVEL",
              Threshold: [{ Comparison: "LT", ThresholdValue: SLA_THRESHOLD_SECONDS }],
            },
            { Name: "AVG_HANDLE_TIME" },
            { Name: "AVG_AFTER_CONTACT_WORK_TIME" },
          ],
          NextToken: nextToken,
        })
      );
      for (const r of res.MetricResults ?? []) {
        const qid = r.Dimensions?.QUEUE || "";
        if (!qid) continue;
        const m: Record<string, number> = {};
        for (const c of r.Collections ?? []) {
          if (c.Metric?.Name) m[c.Metric.Name] = c.Value ?? 0;
        }
        out.set(qid, {
          handled: Math.round(m["CONTACTS_HANDLED"] || 0),
          abandoned: Math.round(m["CONTACTS_ABANDONED"] || 0),
          queued: Math.round(m["CONTACTS_QUEUED"] || 0),
          serviceLevel: Math.round((m["SERVICE_LEVEL"] || 0) * 10) / 10,
          avgHandleTime: Math.round(m["AVG_HANDLE_TIME"] || 0),
          avgAcw: Math.round(m["AVG_AFTER_CONTACT_WORK_TIME"] || 0),
        });
      }
      if (!res.NextToken) break;
      nextToken = res.NextToken;
    }
  } catch (err) {
    console.error(
      "GetMetricDataV2 (today) failed — continuing without daily metrics:",
      err
    );
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any, context) => {
  try {
    // Connect del tenant (o legacy de Vox). Setea las vars module-active.
    const legacyArn = buildLegacyInstanceArn(context.invokedFunctionArn);
    {
      const r = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID, legacyArn);
      activeConnect = r.client;
      activeInstanceId = r.instanceId;
      activeInstanceArn = r.instanceArn || legacyArn;
    }

    const queueIds = await getQueueIds();
    // Kick off the username cache refresh in parallel with the other
    // queries. If it's already warm this resolves instantly.
    const userNamePromise = refreshUserNameCache();

    const [metricsResponse, usersResponse, todayByQueue] = await Promise.all([
      activeConnect.send(
        new GetCurrentMetricDataCommand({
          InstanceId: activeInstanceId,
          CurrentMetrics: QUEUE_METRICS,
          Filters: {
            Channels: ["VOICE", "CHAT"],
            Queues: queueIds,
          },
          Groupings: ["QUEUE"],
        })
      ),
      activeConnect.send(
        new GetCurrentUserDataCommand({
          InstanceId: activeInstanceId,
          Filters: {
            Queues: queueIds,
          },
        })
      ),
      getTodayQueueMetrics(activeInstanceArn, queueIds),
    ]);

    const queueMetrics =
      metricsResponse.MetricResults?.map((result) => {
        const metrics: Record<string, number> = {};
        result.Collections?.forEach((c) => {
          if (c.Metric?.Name) {
            metrics[c.Metric.Name] = c.Value ?? 0;
          }
        });

        const queueId = result.Dimensions?.Queue?.Id || "";
        const queueArn = result.Dimensions?.Queue?.Arn || "";

        // Extract queue name from ARN or use cached name
        let queueName = queueNameCache.get(`${activeInstanceId}:${queueId}`) || "";
        if (!queueName && queueArn) {
          // ARN format: arn:aws:connect:region:account:instance/id/queue/id
          // The name is not in the ARN, so we'll use the queue ID as fallback
          queueName = queueId;
        }

        const day = todayByQueue.get(queueId);
        return {
          queueId,
          queueName,
          contactsInQueue: metrics["CONTACTS_IN_QUEUE"] || 0,
          oldestContactAge: Math.round(metrics["OLDEST_CONTACT_AGE"] || 0),
          agentsAvailable: metrics["AGENTS_AVAILABLE"] || 0,
          agentsOnline: metrics["AGENTS_ONLINE"] || 0,
          agentsOnCall: metrics["AGENTS_ON_CALL"] || 0,
          agentsACW: metrics["AGENTS_AFTER_CONTACT_WORK"] || 0,
          // Today's aggregated figures (GetMetricDataV2). null SLA = no data yet.
          handledToday: day?.handled ?? 0,
          abandonedToday: day?.abandoned ?? 0,
          queuedToday: day?.queued ?? 0,
          serviceLevelToday: day ? day.serviceLevel : null,
          abandonRateToday:
            day && day.queued > 0
              ? Math.round((day.abandoned / day.queued) * 1000) / 10
              : 0,
          avgHandleTimeToday: day?.avgHandleTime ?? 0,
        };
      }) || [];

    // Enrich queue names from the ListQueues cache
    if (queueMetrics.some((q) => q.queueName === q.queueId)) {
      const queuesResponse = await activeConnect.send(
        new ListQueuesCommand({
          InstanceId: activeInstanceId,
          QueueTypes: ["STANDARD"],
        })
      );
      queuesResponse.QueueSummaryList?.forEach((q) => {
        if (q.Id && q.Name) {
          queueNameCache.set(`${activeInstanceId}:${q.Id}`, q.Name);
        }
      });
      queueMetrics.forEach((q) => {
        q.queueName = queueNameCache.get(`${activeInstanceId}:${q.queueId}`) || q.queueId;
      });
    }

    // Wait for the username cache before mapping agents.
    await userNamePromise;

    const agents =
      usersResponse.UserDataList?.map((userData) => {
        // Connect's User.Arn looks like
        //   arn:aws:connect:region:account:instance/INSTANCE/agent/USER_ID
        // The last segment is the USER_ID (a UUID) — NOT the username.
        // Resolve the real username via the cache we built from
        // ListUsers; fall back to the id if (somehow) missing.
        const agentId =
          userData.User?.Id || userData.User?.Arn?.split("/").pop() || "";
        const username = userNameCache.get(`${activeInstanceId}:${agentId}`) || agentId;
        return {
          agentId,
          username,
          status: userData.Status?.StatusName || "Unknown",
          statusStartTimestamp:
            userData.Status?.StatusStartTimestamp?.toISOString() || "",
          activeContacts: userData.ActiveSlotsByChannel || {},
          availableSlots: userData.AvailableSlotsByChannel || {},
        };
      }) || [];

    // Calculate summary KPIs
    const totalContactsInQueue = queueMetrics.reduce(
      (sum, q) => sum + q.contactsInQueue,
      0
    );
    // Deduplicate agent counts (same agent can appear in multiple queues)
    const uniqueAvailable = new Set<string>();
    const uniqueOnline = new Set<string>();
    agents.forEach((a) => {
      if (a.status === "Available") uniqueAvailable.add(a.agentId);
      if (a.status !== "Offline" && a.status !== "Unknown")
        uniqueOnline.add(a.agentId);
    });

    const longestWait = Math.max(
      ...queueMetrics.map((q) => q.oldestContactAge),
      0
    );

    // Today's aggregated KPIs (operation-day). Counts are exact sums; service
    // level is queued-weighted across queues. null when there's no data yet.
    const dayVals = [...todayByQueue.values()];
    const todayHandled = dayVals.reduce((s, d) => s + d.handled, 0);
    const todayAbandoned = dayVals.reduce((s, d) => s + d.abandoned, 0);
    const todayQueued = dayVals.reduce((s, d) => s + d.queued, 0);
    const todayAbandonRate =
      todayQueued > 0 ? Math.round((todayAbandoned / todayQueued) * 1000) / 10 : 0;
    const slWeight = dayVals.reduce(
      (s, d) => s + d.serviceLevel * Math.max(d.queued, 0),
      0
    );
    const todayServiceLevel =
      todayQueued > 0
        ? Math.round((slWeight / todayQueued) * 10) / 10
        : dayVals.length
          ? Math.round(
              (dayVals.reduce((s, d) => s + d.serviceLevel, 0) / dayVals.length) * 10
            ) / 10
          : null;
    const todayAht =
      todayHandled > 0
        ? Math.round(
            dayVals.reduce((s, d) => s + d.avgHandleTime * d.handled, 0) / todayHandled
          )
        : 0;
    const todayAcw =
      todayHandled > 0
        ? Math.round(
            dayVals.reduce((s, d) => s + d.avgAcw * d.handled, 0) / todayHandled
          )
        : 0;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
              },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        summary: {
          totalContactsInQueue,
          totalAgentsAvailable: uniqueAvailable.size || queueMetrics.reduce((s, q) => s + q.agentsAvailable, 0),
          totalAgentsOnline: uniqueOnline.size || queueMetrics.reduce((s, q) => s + q.agentsOnline, 0),
          longestWaitSeconds: longestWait,
          today: {
            handled: todayHandled,
            abandoned: todayAbandoned,
            queued: todayQueued,
            abandonRate: todayAbandonRate,
            serviceLevel: todayServiceLevel,
            avgHandleTime: todayAht,
            avgAcw: todayAcw,
          },
        },
        queues: queueMetrics,
        agents,
      }),
    };
  } catch (error) {
    console.error("Error fetching realtime metrics:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
              },
      body: JSON.stringify({
        error: "Failed to fetch realtime metrics",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
