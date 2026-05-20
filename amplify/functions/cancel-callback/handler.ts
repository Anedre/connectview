import type { Handler } from "aws-lambda";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

/**
 * cancel-callback — soft-cancels a scheduled callback (sets status to
 * CANCELLED so it doesn't dispatch). Keeps the row for audit/history.
 *
 * Body: { callbackId, actor? }
 */
const dynamo = new DynamoDBClient({});
const TABLE = process.env.CALLBACKS_TABLE || "connectview-callbacks";
const CORS: Record<string, string> = { "Content-Type": "application/json" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  let body: { callbackId?: string; actor?: string };
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) };
  }
  if (!body?.callbackId) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "callbackId required" }) };
  }
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { callbackId: { S: body.callbackId } },
        UpdateExpression:
          "SET #s = :cancelled, cancelledAt = :now, updatedAt = :now, cancelledBy = :actor",
        ConditionExpression: "attribute_exists(callbackId) AND #s = :scheduled",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":cancelled": { S: "CANCELLED" },
          ":scheduled": { S: "SCHEDULED" },
          ":now": { S: new Date().toISOString() },
          ":actor": { S: body.actor || "unknown" },
        },
      })
    );
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ cancelled: true }) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // ConditionalCheckFailedException → either callback doesn't exist or
    // it's already past SCHEDULED (RINGING / COMPLETED). Tell the user.
    if (msg.includes("ConditionalCheckFailed")) {
      return {
        statusCode: 409,
        headers: CORS,
        body: JSON.stringify({
          error: "Callback no se puede cancelar (ya está en curso o terminado)",
        }),
      };
    }
    console.error("cancel-callback error:", err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) };
  }
};
