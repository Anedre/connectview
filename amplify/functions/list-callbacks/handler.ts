import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

/**
 * list-callbacks — returns follow-ups (callbacks + email/whatsapp
 * pendings) filtered by either:
 *   ?agentUserId=84fe...  → follow-ups assigned to this agent (GSI agent-scheduledAt)
 *   ?status=SCHEDULED      → follow-ups in this state (GSI status-scheduledAt)
 *   ?status=PENDING        → meta-filter: SCHEDULED OR DUE (most useful for the drawer)
 *   ?channel=voice|email|whatsapp → optional channel filter
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
  const channel: string | undefined = p.channel;
  const limit = Math.min(parseInt(p.limit || "50", 10) || 50, 200);

  // "PENDING" is sugar for "SCHEDULED or DUE" — most agent UIs want this.
  const isPending = status === "PENDING";
  const statusList = isPending ? ["SCHEDULED", "DUE"] : status ? [status] : [];

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
      if (statusList.length > 0) {
        items = items.filter((it) =>
          statusList.includes(String(it.status))
        );
      }
    } else if (statusList.length === 1) {
      const res = await dynamo.send(
        new QueryCommand({
          TableName: TABLE,
          IndexName: "status-scheduledAt-index",
          KeyConditionExpression: "#s = :s",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":s": { S: statusList[0] } },
          ScanIndexForward: true,
          Limit: limit,
        })
      );
      items = (res.Items || []).map((it) => unmarshall(it));
    } else if (statusList.length > 1) {
      // Multi-status filter (e.g. PENDING = SCHEDULED+DUE) — fan out
      // across each status via the status-scheduledAt-index and merge.
      const fanned = await Promise.all(
        statusList.map((s) =>
          dynamo.send(
            new QueryCommand({
              TableName: TABLE,
              IndexName: "status-scheduledAt-index",
              KeyConditionExpression: "#s = :s",
              ExpressionAttributeNames: { "#s": "status" },
              ExpressionAttributeValues: { ":s": { S: s } },
              ScanIndexForward: true,
              Limit: limit,
            })
          )
        )
      );
      const seen = new Set<string>();
      for (const res of fanned) {
        for (const it of res.Items || []) {
          const row = unmarshall(it);
          const id = String(row.callbackId);
          if (seen.has(id)) continue;
          seen.add(id);
          items.push(row);
        }
      }
      // Sort merged result by scheduledAt asc (matches single-index path)
      items.sort((a, b) =>
        String(a.scheduledAt || "").localeCompare(String(b.scheduledAt || ""))
      );
      items = items.slice(0, limit);
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

    // Optional channel filter (applies regardless of which query path
    // we took). Default-treat missing channel as "voice" so legacy rows
    // continue to match when callers ask for ?channel=voice.
    if (channel) {
      items = items.filter((it) => {
        const c = (it.channel as string) || "voice";
        return c === channel;
      });
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
