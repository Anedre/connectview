import type { Handler } from "aws-lambda";
import { ConnectClient, StopContactCommand } from "@aws-sdk/client-connect";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { resolveConnect } from "../_shared/tenantConnect";
import { getIdentity, type VoxIdentity } from "../_shared/cognitoAuth";

// SEC-C6: colgar un contacto en vivo SOLO para Supervisores/Admins. Function URL
// auth=NONE → la identidad se valida acá con el JWT.
const PRIVILEGED_GROUPS = ["Admins", "Supervisors"];

const legacyConnect = new ConnectClient({ maxAttempts: 1 });
// BYO Data Plane (#46): module-active; el helper audit lee este `dynamo`.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const INSTANCE_ARN =
  process.env.CONNECT_INSTANCE_ARN ||
  `arn:aws:connect:us-east-1:731736972577:instance/${INSTANCE_ID}`;
const AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";

async function audit(
  actor: string,
  contactId: string,
  result: "success" | "error",
  errorMsg?: string,
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
      }),
    );
  } catch (err) {
    console.warn("audit write failed:", err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: "" };
  }

  // AUTH (SEC-C6): identidad del JWT, nunca del body. 401 sin token; 403 sin rol.
  let identity: VoxIdentity | null;
  try {
    identity = await getIdentity(event?.headers);
  } catch {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Token inválido" }),
    };
  }
  if (!identity) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "No autorizado" }),
    };
  }
  if (!identity.groups.some((g) => PRIVILEGED_GROUPS.includes(g))) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Solo supervisores o administradores pueden colgar contactos",
      }),
    };
  }

  const body = JSON.parse(event.body || "{}");
  const { contactId } = body;
  // Actor del audit-trail = token verificado (el body es forjable).
  const actor = identity.username || identity.sub;

  if (!contactId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "contactId required" }),
    };
  }

  try {
    const {
      client: connect,
      instanceId,
      dynamo: tenantDynamo,
    } = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID, INSTANCE_ARN);
    dynamo = tenantDynamo || legacyDynamo;
    await connect.send(
      new StopContactCommand({
        InstanceId: instanceId,
        ContactId: contactId,
      }),
    );
    await audit(actor, contactId, "success");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, stopped: true }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await audit(actor, contactId, "error", msg);
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
