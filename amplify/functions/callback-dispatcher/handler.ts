import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ConnectClient,
  StartOutboundVoiceContactCommand,
} from "@aws-sdk/client-connect";

/**
 * callback-dispatcher — runs every 1 minute via EventBridge.
 *
 * Scans the callbacks table (GSI status-scheduledAt) for rows where
 *   status = "SCHEDULED" AND scheduledAt <= now
 *
 * For each due callback:
 *   1. Mark RINGING (optimistic concurrency — skip if already grabbed
 *      by a parallel dispatcher invocation).
 *   2. Place an outbound voice call:
 *        - DestinationPhoneNumber: callback.phone
 *        - SourcePhoneNumber: callback.sourcePhoneNumber OR default
 *        - ContactFlowId: callback.contactFlowId OR UDEP-Outbound-Smart
 *        - Attributes include the assignedAgentUserId — the contact
 *          flow's TransferContactToQueue / agent routing can read this
 *          and route to the specific agent who promised the callback.
 *   3. Mark COMPLETED if the call started, RETRY / FAILED otherwise.
 *
 * Concurrency safety: ConditionExpression ensures only one dispatcher
 * grabs each row.
 */
const dynamo = new DynamoDBClient({});
const connect = new ConnectClient({ maxAttempts: 2 });
const TABLE = process.env.CALLBACKS_TABLE || "connectview-callbacks";
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const DEFAULT_FLOW_ID =
  process.env.DEFAULT_CALLBACK_FLOW_ID ||
  "dfda0ca9-a9fe-4758-a602-b860353382cd"; // UDEP-Outbound-Smart
const DEFAULT_SOURCE_PHONE =
  process.env.DEFAULT_SOURCE_PHONE || "+5116433467";

interface CallbackRow {
  callbackId: string;
  phone: string;
  customerName?: string;
  scheduledAt: string;
  status: string;
  assignedAgentUserId?: string;
  notes?: string;
  campaignId?: string;
  contactFlowId?: string;
  sourcePhoneNumber?: string;
  customAttributes?: string;
  attempts?: number;
}

async function claim(row: CallbackRow): Promise<boolean> {
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { callbackId: { S: row.callbackId } },
        UpdateExpression:
          "SET #s = :ringing, updatedAt = :now, dispatchAt = :now, attempts = if_not_exists(attempts, :zero) + :one",
        ConditionExpression: "#s = :scheduled",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":ringing": { S: "RINGING" },
          ":scheduled": { S: "SCHEDULED" },
          ":now": { S: new Date().toISOString() },
          ":zero": { N: "0" },
          ":one": { N: "1" },
        },
      })
    );
    return true;
  } catch (err) {
    // ConditionalCheckFailed → row already grabbed or cancelled
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("ConditionalCheckFailed")) {
      console.warn("claim error:", err);
    }
    return false;
  }
}

async function markCompleted(callbackId: string, connectContactId: string) {
  await dynamo.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { callbackId: { S: callbackId } },
      UpdateExpression:
        "SET #s = :done, updatedAt = :now, connectContactId = :cid",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":done": { S: "COMPLETED" },
        ":now": { S: new Date().toISOString() },
        ":cid": { S: connectContactId },
      },
    })
  );
}

async function markFailed(callbackId: string, error: string) {
  await dynamo.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { callbackId: { S: callbackId } },
      UpdateExpression:
        "SET #s = :fail, updatedAt = :now, lastError = :err",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":fail": { S: "FAILED" },
        ":now": { S: new Date().toISOString() },
        ":err": { S: error.slice(0, 500) },
      },
    })
  );
}

async function dispatchOne(row: CallbackRow): Promise<void> {
  // Pass the callback metadata as Connect contact attributes so the
  // flow's "Set contact attributes" / queue routing can react to it
  // (e.g. route to the specific agent who promised the callback).
  let customAttrs: Record<string, string> = {};
  try {
    customAttrs = JSON.parse(row.customAttributes || "{}");
  } catch {
    /* noop */
  }
  const attributes: Record<string, string> = {
    callback: "true",
    callbackId: row.callbackId,
    callbackPromisedBy: row.assignedAgentUserId || "",
    customerName: (row.customerName || "").slice(0, 200),
    udep_callback_notes: (row.notes || "").slice(0, 256),
    ...Object.fromEntries(
      Object.entries(customAttrs)
        .slice(0, 25)
        .map(([k, v]) => [k.slice(0, 127), String(v).slice(0, 256)])
    ),
  };

  try {
    const res = await connect.send(
      new StartOutboundVoiceContactCommand({
        InstanceId: INSTANCE_ID,
        ContactFlowId: row.contactFlowId || DEFAULT_FLOW_ID,
        DestinationPhoneNumber: row.phone,
        SourcePhoneNumber: row.sourcePhoneNumber || DEFAULT_SOURCE_PHONE,
        Attributes: attributes,
        ClientToken: `cb-${row.callbackId}-${(row.attempts || 0) + 1}`.slice(0, 500),
      })
    );
    if (res.ContactId) {
      await markCompleted(row.callbackId, res.ContactId);
      console.log(
        `[ok] callback ${row.callbackId.slice(0, 8)} fired → contact ${res.ContactId}`
      );
    } else {
      await markFailed(row.callbackId, "StartOutboundVoiceContact returned no contactId");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[err] callback ${row.callbackId.slice(0, 8)} dispatch:`, msg);
    await markFailed(row.callbackId, msg);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (_event: any) => {
  const now = new Date().toISOString();
  console.log(`[dispatcher] tick at ${now}`);

  // Fetch up to 25 due rows per tick. EventBridge fires every minute,
  // so we drain the queue across ~25 ticks even for big bursts.
  const res = await dynamo.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "status-scheduledAt-index",
      KeyConditionExpression: "#s = :sched AND scheduledAt <= :now",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":sched": { S: "SCHEDULED" },
        ":now": { S: now },
      },
      ScanIndexForward: true,
      Limit: 25,
    })
  );

  const rows = (res.Items || []).map((it) => unmarshall(it) as CallbackRow);
  console.log(`[dispatcher] ${rows.length} due callback(s)`);

  for (const row of rows) {
    const claimed = await claim(row);
    if (!claimed) continue;
    await dispatchOne(row);
  }

  return { dispatched: rows.length };
};
