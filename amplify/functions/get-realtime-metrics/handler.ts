import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  ConnectClient,
  GetCurrentMetricDataCommand,
  GetCurrentUserDataCommand,
  ListQueuesCommand,
  type CurrentMetric,
} from "@aws-sdk/client-connect";

const client = new ConnectClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

const QUEUE_METRICS: CurrentMetric[] = [
  { Name: "CONTACTS_IN_QUEUE", Unit: "COUNT" },
  { Name: "OLDEST_CONTACT_AGE", Unit: "SECONDS" },
  { Name: "AGENTS_AVAILABLE", Unit: "COUNT" },
  { Name: "AGENTS_ONLINE", Unit: "COUNT" },
  { Name: "AGENTS_ON_CALL", Unit: "COUNT" },
  { Name: "AGENTS_AFTER_CONTACT_WORK", Unit: "COUNT" },
];

// Cache queue IDs for 5 minutes to avoid listing queues on every poll
let cachedQueueIds: string[] = [];
let cacheExpiry = 0;

async function getQueueIds(): Promise<string[]> {
  if (cachedQueueIds.length > 0 && Date.now() < cacheExpiry) {
    return cachedQueueIds;
  }

  const response = await client.send(
    new ListQueuesCommand({
      InstanceId: INSTANCE_ID,
      QueueTypes: ["STANDARD"],
    })
  );

  cachedQueueIds =
    response.QueueSummaryList?.map((q) => q.Id!).filter(Boolean) || [];
  cacheExpiry = Date.now() + 5 * 60 * 1000;
  return cachedQueueIds;
}

// Cache queue name mapping
const queueNameCache = new Map<string, string>();

export const handler: APIGatewayProxyHandler = async () => {
  try {
    const queueIds = await getQueueIds();

    const [metricsResponse, usersResponse] = await Promise.all([
      client.send(
        new GetCurrentMetricDataCommand({
          InstanceId: INSTANCE_ID,
          CurrentMetrics: QUEUE_METRICS,
          Filters: {
            Channels: ["VOICE", "CHAT"],
            Queues: queueIds,
          },
          Groupings: ["QUEUE"],
        })
      ),
      client.send(
        new GetCurrentUserDataCommand({
          InstanceId: INSTANCE_ID,
          Filters: {
            Queues: queueIds,
          },
        })
      ),
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
        let queueName = queueNameCache.get(queueId) || "";
        if (!queueName && queueArn) {
          // ARN format: arn:aws:connect:region:account:instance/id/queue/id
          // The name is not in the ARN, so we'll use the queue ID as fallback
          queueName = queueId;
        }

        return {
          queueId,
          queueName,
          contactsInQueue: metrics["CONTACTS_IN_QUEUE"] || 0,
          oldestContactAge: Math.round(metrics["OLDEST_CONTACT_AGE"] || 0),
          agentsAvailable: metrics["AGENTS_AVAILABLE"] || 0,
          agentsOnline: metrics["AGENTS_ONLINE"] || 0,
          agentsOnCall: metrics["AGENTS_ON_CALL"] || 0,
          agentsACW: metrics["AGENTS_AFTER_CONTACT_WORK"] || 0,
        };
      }) || [];

    // Enrich queue names from the ListQueues cache
    if (queueMetrics.some((q) => q.queueName === q.queueId)) {
      const queuesResponse = await client.send(
        new ListQueuesCommand({
          InstanceId: INSTANCE_ID,
          QueueTypes: ["STANDARD"],
        })
      );
      queuesResponse.QueueSummaryList?.forEach((q) => {
        if (q.Id && q.Name) {
          queueNameCache.set(q.Id, q.Name);
        }
      });
      queueMetrics.forEach((q) => {
        q.queueName = queueNameCache.get(q.queueId) || q.queueId;
      });
    }

    const agents =
      usersResponse.UserDataList?.map((userData) => ({
        agentId: userData.User?.Id || "",
        username: userData.User?.Arn?.split("/").pop() || "",
        status: userData.Status?.StatusName || "Unknown",
        statusStartTimestamp:
          userData.Status?.StatusStartTimestamp?.toISOString() || "",
        activeContacts: userData.ActiveSlotsByChannel || {},
        availableSlots: userData.AvailableSlotsByChannel || {},
      })) || [];

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

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        summary: {
          totalContactsInQueue,
          totalAgentsAvailable: uniqueAvailable.size || queueMetrics.reduce((s, q) => s + q.agentsAvailable, 0),
          totalAgentsOnline: uniqueOnline.size || queueMetrics.reduce((s, q) => s + q.agentsOnline, 0),
          longestWaitSeconds: longestWait,
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
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Failed to fetch realtime metrics",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
