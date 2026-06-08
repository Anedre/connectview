import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  ListQueuesCommand,
} from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";

const legacyConnect = new ConnectClient({ maxAttempts: 1 });
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

export const handler: Handler = async (event) => {
  try {
    // Connect del tenant (o legacy de Vox si no está configurado / sin token).
    const { client: connect, instanceId } = await resolveConnect(
      (event as { headers?: Record<string, string | undefined> })?.headers,
      legacyConnect,
      INSTANCE_ID
    );
    const queues: Array<{ id: string; name: string; type: string; arn: string }> =
      [];
    let nextToken: string | undefined;
    do {
      const res = await connect.send(
        new ListQueuesCommand({
          InstanceId: instanceId,
          QueueTypes: ["STANDARD"],
          NextToken: nextToken,
          MaxResults: 100,
        })
      );
      for (const q of res.QueueSummaryList || []) {
        queues.push({
          id: q.Id || "",
          name: q.Name || "",
          type: q.QueueType || "STANDARD",
          arn: q.Arn || "",
        });
      }
      nextToken = res.NextToken;
    } while (nextToken);

    queues.sort((a, b) => a.name.localeCompare(b.name));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queues, total: queues.length }),
    };
  } catch (err) {
    console.error("list-queues error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to list queues",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
