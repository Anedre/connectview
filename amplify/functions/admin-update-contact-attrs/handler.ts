import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  UpdateContactAttributesCommand,
} from "@aws-sdk/client-connect";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { resolveConnect } from "../_shared/tenantConnect";

const legacyConnect = new ConnectClient({ maxAttempts: 1 });
// BYO Data Plane (#46): module-active; el helper audit lee este `dynamo`.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";

async function audit(
  actor: string,
  target: Record<string, unknown>,
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
          action: { S: "update-contact-attributes" },
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
  const { contactId, initialContactId, attributes, actor } = body as {
    contactId: string;
    initialContactId?: string;
    attributes: Record<string, string>;
    actor?: string;
  };

  if (!contactId || !attributes || typeof attributes !== "object") {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "contactId and attributes (object) required",
      }),
    };
  }

  // Connect requires we pass the InitialContactId (the original contact of the chain).
  const targetContactId = initialContactId || contactId;

  try {
    const { client: connect, instanceId, dynamo: tenantDynamo } = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID);
    dynamo = tenantDynamo || legacyDynamo;
    await connect.send(
      new UpdateContactAttributesCommand({
        InstanceId: instanceId,
        InitialContactId: targetContactId,
        Attributes: attributes,
      })
    );
    await audit(
      actor || "unknown",
      { contactId, initialContactId: targetContactId, attributeCount: Object.keys(attributes).length },
      "success"
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, updated: true }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await audit(
      actor || "unknown",
      { contactId, initialContactId: targetContactId },
      "error",
      msg
    );
    console.error("update-attrs error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to update attributes",
        message: msg,
      }),
    };
  }
};
