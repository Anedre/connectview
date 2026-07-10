import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  TransferContactCommand,
  DescribeContactCommand,
} from "@aws-sdk/client-connect";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { resolveConnect } from "../_shared/tenantConnect";
import { getIdentity, type VoxIdentity } from "../_shared/cognitoAuth";

// SEC-C6: transferir un contacto en vivo SOLO para Supervisores/Admins. Function
// URL auth=NONE → la identidad se valida aquí con el JWT.
const PRIVILEGED_GROUPS = ["Admins", "Supervisors"];

const legacyConnect = new ConnectClient({ maxAttempts: 1 });
// BYO Data Plane (#46): module-active; el helper audit lee este `dynamo`.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";

async function audit(
  action: string,
  actor: string,
  target: Record<string, string | number | undefined>,
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
          action: { S: action },
          actor: { S: actor },
          target: { S: JSON.stringify(target) },
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
        error: "Solo supervisores o administradores pueden transferir contactos",
      }),
    };
  }

  const body = JSON.parse(event.body || "{}");
  const { contactId, targetUserId, targetQueueId, targetContactFlowId } = body;
  // Actor del audit-trail = token verificado (el body es forjable).
  const actor = identity.username || identity.sub;

  if (!contactId || (!targetUserId && !targetQueueId)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "contactId + (targetUserId or targetQueueId) required",
      }),
    };
  }

  try {
    const {
      client: connect,
      instanceId,
      dynamo: tenantDynamo,
    } = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID);
    dynamo = tenantDynamo || legacyDynamo;
    // TransferContact requires a ContactFlowId; if not supplied, use the default outbound flow
    // of the instance by describing the contact and reusing its current flow.
    let flowId = targetContactFlowId;
    if (!flowId) {
      try {
        const desc = await connect.send(
          new DescribeContactCommand({
            InstanceId: instanceId,
            ContactId: contactId,
          }),
        );
        // InitialContactId flow id isn't exposed; fall back to instance env default
        flowId = desc.Contact?.Arn ? process.env.DEFAULT_TRANSFER_FLOW_ID : undefined;
      } catch {
        /* ignore */
      }
    }
    if (!flowId) {
      flowId = process.env.DEFAULT_TRANSFER_FLOW_ID;
    }
    if (!flowId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "targetContactFlowId missing and no DEFAULT_TRANSFER_FLOW_ID env var set",
        }),
      };
    }

    const res = await connect.send(
      new TransferContactCommand({
        InstanceId: instanceId,
        ContactId: contactId,
        UserId: targetUserId,
        QueueId: targetQueueId,
        ContactFlowId: flowId,
        ClientToken: `transfer-${contactId}-${Date.now()}`,
      }),
    );

    await audit(
      "transfer-contact",
      actor,
      { contactId, targetUserId, targetQueueId, flowId },
      "success",
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId,
        transferredContactId: res.ContactId,
        transferArn: res.ContactArn,
      }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await audit(
      "transfer-contact",
      actor,
      { contactId, targetUserId, targetQueueId },
      "error",
      msg,
    );
    console.error("transfer error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to transfer", message: msg }),
    };
  }
};
