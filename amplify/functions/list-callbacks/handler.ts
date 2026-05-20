import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

/**
 * list-callbacks — returns callbacks filtered by either:
 *   ?agentUserId=84fe...  → callbacks promised by this agent (GSI agent-scheduledAt)
 *   ?status=SCHEDULED      → callbacks in this state (GSI status-scheduledAt)
 *   (both)                 → AND
 *   (neither)              → recent across all (small scan)
 *
 * Always sorted oldest-scheduled-first.
 */
const dynamo = new DynamoDBClient({});
const TABLE = process.env.CALLBACKS_TABLE || "connectview-callbacks";
const CORS: Record<string, string> = { "Content-Type": "application/json" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  const p = event?.queryStringParameters || {};
  const agentUserId: string | undefined = p.agentUserId;
  const status: string | undefined = p.status;
  const limit = Math.min(parseInt(p.limit || "50", 10) || 50, 200);

  try {
    let items: Record<string, unknown>[] = [];
    if (agentUserId) {
      const res = await dynamo.send(
        new QueryCommand({
          TableName: TABLE,
          IndexName: "agent-scheduledAt-index",
          KeyConditionExpression: "assignedAgentUserId = :u",
          ExpressionAttributeValues: { ":u": { S: agentUserId } },
          ScanIndexForward: true,
          Limit: limit,
        })
      );
      items = (res.Items || []).map((it) => unmarshall(it));
      if (status) items = items.filter((it) => it.status === status);
    } else if (status) {
      const res = await dynamo.send(
        new QueryCommand({
          TableName: TABLE,
          IndexName: "status-scheduledAt-index",
          KeyConditionExpression: "#s = :s",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":s": { S: status } },
          ScanIndexForward: true,
          Limit: limit,
        })
      );
      items = (res.Items || []).map((it) => unmarshall(it));
    } else {
      const res = await dynamo.send(
        new ScanCommand({ TableName: TABLE, Limit: limit })
      );
      items = (res.Items || []).map((it) => unmarshall(it));
      // Sort by scheduledAt asc when scanning
      items.sort((a, b) =>
        String(a.scheduledAt || "").localeCompare(String(b.scheduledAt || ""))
      );
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ items, count: items.length }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("list-callbacks error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: msg }),
    };
  }
};
