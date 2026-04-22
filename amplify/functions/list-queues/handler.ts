import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  ListQueuesCommand,
} from "@aws-sdk/client-connect";

const connect = new ConnectClient({ maxAttempts: 1 });
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async () => {
  try {
    const queues: Array<{ id: string; name: string; type: string; arn: string }> =
      [];
    let nextToken: string | undefined;
    do {
      const res = await connect.send(
        new ListQueuesCommand({
          InstanceId: INSTANCE_ID,
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
