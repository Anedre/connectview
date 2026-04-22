import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  PutUserStatusCommand,
} from "@aws-sdk/client-connect";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";

const connect = new ConnectClient({ maxAttempts: 1 });
const dynamo = new DynamoDBClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";

async function audit(
  actor: string,
  target: Record<string, string>,
  result: "success" | "error",
  errorMsg?: string
): Promise<void> {
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: AUDIT_TABLE,
        Item: {
          auditId: { S: randomUUID() },
          timestamp: { S: new Date().toISOString() },
          action: { S: "change-agent-status" },
          actor: { S: actor },
          target: { S: JSON.stringify(target) },
          result: { S: result },
          errorMsg: { S: errorMsg || "" },
        },
      })
    );
  } catch (err) {
    console.warn("audit write failed:", err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const body = JSON.parse(event.body || "{}");
  const { userId, agentStatusId, actor } = body;

  if (!userId || !agentStatusId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "userId and agentStatusId required" }),
    };
  }

  try {
    await connect.send(
      new PutUserStatusCommand({
        InstanceId: INSTANCE_ID,
        UserId: userId,
        AgentStatusId: agentStatusId,
      })
    );
    await audit(actor || "unknown", { userId, agentStatusId }, "success");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, agentStatusId, updated: true }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await audit(
      actor || "unknown",
      { userId, agentStatusId },
      "error",
      msg
    );
    console.error("change-agent-status error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to change agent status",
        message: msg,
      }),
    };
  }
};
