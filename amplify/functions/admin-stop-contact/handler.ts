import type { Handler } from "aws-lambda";
import { ConnectClient, StopContactCommand } from "@aws-sdk/client-connect";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";

const connect = new ConnectClient({ maxAttempts: 1 });
const dynamo = new DynamoDBClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const INSTANCE_ARN =
  process.env.CONNECT_INSTANCE_ARN ||
  `arn:aws:connect:us-east-1:731736972577:instance/${INSTANCE_ID}`;
const AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";

async function audit(
  actor: string,
  contactId: string,
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
          action: { S: "stop-contact" },
          actor: { S: actor },
          target: { S: JSON.stringify({ contactId }) },
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
  const { contactId, actor } = body;

  if (!contactId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "contactId required" }),
    };
  }

  try {
    await connect.send(
      new StopContactCommand({
        InstanceId: INSTANCE_ID,
        ContactId: contactId,
      })
    );
    await audit(actor || "unknown", contactId, "success");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, stopped: true }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await audit(actor || "unknown", contactId, "error", msg);
    console.error("stop-contact error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to stop contact", message: msg }),
    };
  }
};

// Silence unused warning
void INSTANCE_ARN;
