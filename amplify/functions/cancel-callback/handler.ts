import type { Handler } from "aws-lambda";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { resolveDynamo } from "../_shared/tenantConnect";

/**
 * cancel-callback — soft-cancels or completes a follow-up.
 *
 * Body:
 *   { callbackId, actor?, action?: "cancel" | "complete" }
 *
 *   - action="cancel"    (default): SCHEDULED → CANCELLED
 *                                   DUE → CANCELLED
 *   - action="complete": DUE → COMPLETED (agent attended the
 *                       email/whatsapp follow-up manually).
 *
 * The row is kept for audit/history.
 */
// BYO Data Plane (#46): tenant primero (su tabla en su cuenta), fallback Vox.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const TABLE = process.env.CALLBACKS_TABLE || "connectview-callbacks";
const CORS: Record<string, string> = { "Content-Type": "application/json" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  // BYO Data Plane (#46): tenant primero, fallback Vox.
  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));
  let body: {
    callbackId?: string;
    actor?: string;
    action?: "cancel" | "complete";
  };
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }
  if (!body?.callbackId) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "callbackId required" }),
    };
  }

  const action = body.action || "cancel";

  // SCHEDULED can be cancelled.
  // DUE can be cancelled OR completed (agent attended manually).
  // Anything else (RINGING / COMPLETED / FAILED / CANCELLED) is terminal.
  const targetStatus =
    action === "complete" ? "COMPLETED" : "CANCELLED";
  const allowedFromStatuses =
    action === "complete" ? ["DUE"] : ["SCHEDULED", "DUE"];

  // Build a ConditionExpression that allows any of the source statuses.
  const condValues: Record<string, { S: string }> = {};
  const condParts = allowedFromStatuses.map((s, i) => {
    condValues[`:from${i}`] = { S: s };
    return `:from${i}`;
  });

  try {
    const updateAttrs: Record<string, { S: string }> = {
      ":target": { S: targetStatus },
      ":now": { S: new Date().toISOString() },
      ":actor": { S: body.actor || "unknown" },
    };
    Object.assign(updateAttrs, condValues);

    // We use different attribute names depending on the action so the
    // audit trail is readable (cancelledAt vs completedAt).
    const stampField = action === "complete" ? "completedAt" : "cancelledAt";
    const actorField = action === "complete" ? "completedBy" : "cancelledBy";

    await dynamo.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { callbackId: { S: body.callbackId } },
        UpdateExpression: `SET #s = :target, ${stampField} = :now, updatedAt = :now, ${actorField} = :actor`,
        ConditionExpression: `attribute_exists(callbackId) AND #s IN (${condParts.join(", ")})`,
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: updateAttrs,
      })
    );
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        callbackId: body.callbackId,
        status: targetStatus,
      }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // ConditionalCheckFailedException → callback doesn't exist, or its
    // status doesn't allow this transition.
    if (msg.includes("ConditionalCheckFailed")) {
      return {
        statusCode: 409,
        headers: CORS,
        body: JSON.stringify({
          error:
            action === "complete"
              ? "El follow-up no está pendiente de acción manual"
              : "Callback no se puede cancelar (ya está en curso o terminado)",
        }),
      };
    }
    console.error("cancel-callback error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: msg }),
    };
  }
};
