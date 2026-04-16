import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  ConnectClient,
  GetCurrentMetricDataCommand,
  GetCurrentUserDataCommand,
  type CurrentMetric,
  type Filters,
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
  { Name: "CONTACTS_SCHEDULED", Unit: "COUNT" },
];

export const handler: APIGatewayProxyHandler = async () => {
  try {
    const filters: Filters = {
      Channels: ["VOICE", "CHAT"],
      Queues: [], // empty = all queues
    };

    const [metricsResponse, usersResponse] = await Promise.all([
      client.send(
        new GetCurrentMetricDataCommand({
          InstanceId: INSTANCE_ID,
          CurrentMetrics: QUEUE_METRICS,
          Filters: filters,
          Groupings: ["QUEUE"],
        })
      ),
      client.send(
        new GetCurrentUserDataCommand({
          InstanceId: INSTANCE_ID,
          Filters: {
            Agents: [],
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
        return {
          queueId: result.Dimensions?.Queue?.Id || "",
          queueName: result.Dimensions?.Queue?.Arn?.split("/").pop() || "",
          contactsInQueue: metrics["CONTACTS_IN_QUEUE"] || 0,
          oldestContactAge: metrics["OLDEST_CONTACT_AGE"] || 0,
          agentsAvailable: metrics["AGENTS_AVAILABLE"] || 0,
          agentsOnline: metrics["AGENTS_ONLINE"] || 0,
          agentsOnCall: metrics["AGENTS_ON_CALL"] || 0,
          agentsACW: metrics["AGENTS_AFTER_CONTACT_WORK"] || 0,
        };
      }) || [];

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
    const totalAgentsAvailable = queueMetrics.reduce(
      (sum, q) => sum + q.agentsAvailable,
      0
    );
    const totalAgentsOnline = queueMetrics.reduce(
      (sum, q) => sum + q.agentsOnline,
      0
    );
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
          totalAgentsAvailable,
          totalAgentsOnline,
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
