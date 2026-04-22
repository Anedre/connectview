import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  MonitorContactCommand,
} from "@aws-sdk/client-connect";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";

const connect = new ConnectClient({ maxAttempts: 1 });
const dynamo = new DynamoDBClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";

type MonitorMode = "SILENT_MONITOR" | "BARGE" | "WHISPER";

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
          action: { S: `monitor-${target.mode}` },
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
  const {
    contactId,
    supervisorUserId,
    mode = "SILENT_MONITOR",
    actor,
  } = body as {
    contactId: string;
    supervisorUserId: string;
    mode?: MonitorMode;
    actor?: string;
  };

  if (!contactId || !supervisorUserId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "contactId and supervisorUserId required",
      }),
    };
  }

  // Map friendly mode names to Connect's AllowedMonitorCapabilities
  const capabilities: string[] =
    mode === "BARGE"
      ? ["SILENT_MONITOR", "BARGE"]
      : mode === "WHISPER"
      ? ["SILENT_MONITOR"]
      : ["SILENT_MONITOR"];

  try {
    const res = await connect.send(
      new MonitorContactCommand({
        InstanceId: INSTANCE_ID,
        ContactId: contactId,
        UserId: supervisorUserId,
        AllowedMonitorCapabilities: capabilities as never,
      })
    );
    await audit(
      actor || supervisorUserId,
      { contactId, supervisorUserId, mode },
      "success"
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId,
        monitorContactId: res.ContactId,
        monitorArn: res.ContactArn,
        mode,
      }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await audit(
      actor || supervisorUserId,
      { contactId, supervisorUserId, mode },
      "error",
      msg
    );
    console.error("monitor-contact error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to start monitoring",
        message: msg,
      }),
    };
  }
};
