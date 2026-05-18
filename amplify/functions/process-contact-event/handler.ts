import type { EventBridgeHandler } from "aws-lambda";
import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  ConnectClient,
  DescribeUserCommand,
} from "@aws-sdk/client-connect";

const dynamo = new DynamoDBClient({});
const lambda = new LambdaClient({});
const connect = new ConnectClient({ maxAttempts: 1 });
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "";
const ENRICH_FUNCTION_NAME = process.env.ENRICH_FUNCTION_NAME || "";
const CAMPAIGNS_TABLE =
  process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CAMPAIGN_CONTACTS_TABLE =
  process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

// Username cache (Lambda warm container scope). Maps user UUID → username.
// DescribeUser is cheap but we still cache to avoid calling it for every
// CONNECTED_TO_AGENT event when the same agent takes back-to-back calls.
const usernameCache = new Map<string, string>();

async function resolveUsername(userId: string): Promise<string> {
  if (!userId) return "";
  const cached = usernameCache.get(userId);
  if (cached) return cached;
  if (!CONNECT_INSTANCE_ID) return userId;
  try {
    const res = await connect.send(
      new DescribeUserCommand({
        InstanceId: CONNECT_INSTANCE_ID,
        UserId: userId,
      })
    );
    const username = res.User?.Username || userId;
    usernameCache.set(userId, username);
    return username;
  } catch (err) {
    console.warn("DescribeUser failed for", userId, err);
    return userId;
  }
}

interface ConnectContactEvent {
  detail: {
    contactId: string;
    channel: string;
    instanceArn: string;
    initiationMethod: string;
    eventType: string;
    agentInfo?: {
      agentArn: string;
    };
    queueInfo?: {
      queueArn: string;
    };
    initiationTimestamp?: string;
    disconnectTimestamp?: string;
    disconnectReason?: string;
  };
}

// Find the campaign-contact row linked to this Connect contactId, if any.
async function findCampaignContact(contactId: string): Promise<
  | {
      campaignId: string;
      rowId: string;
      attempts: number;
      status: string;
      connectedAt?: string;
    }
  | null
> {
  try {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: CAMPAIGN_CONTACTS_TABLE,
        IndexName: "connectContactId-index",
        KeyConditionExpression: "connectContactId = :cid",
        ExpressionAttributeValues: { ":cid": { S: contactId } },
        Limit: 1,
      })
    );
    const first = res.Items?.[0];
    if (!first) return null;
    const row = unmarshall(first);
    return {
      campaignId: row.campaignId as string,
      rowId: row.rowId as string,
      attempts: Number(row.attempts || 0),
      status: row.status as string,
      connectedAt: row.connectedAt as string | undefined,
    };
  } catch (err) {
    console.warn("findCampaignContact failed:", err);
    return null;
  }
}

// Classify the disconnect into our campaign contact status.
// `callDurationSec` is the gap between agent connection and disconnect.
// If the agent connected but the customer hung up within a few seconds
// (voicemail, rejection, no answer), we classify as no_answer even though
// technically the agent "got" the contact.
function classifyDisconnect(
  reason: string | undefined,
  previousStatus: string,
  callDurationSec: number | null
): "done" | "no_answer" | "failed" {
  const r = (reason || "").toUpperCase();

  // Explicit no-answer reasons — always no_answer.
  if (
    r === "CUSTOMER_MISSED_CALL" ||
    r === "TELECOM_PROBLEM" ||
    r === "CALL_ABANDONED" ||
    r.includes("MISSED") ||
    r.includes("ABANDONED") ||
    r.includes("OUTBOUND_RING_TIME_EXCEEDED")
  ) {
    return "no_answer";
  }

  // Connected-to-agent, but very short call: likely voicemail or customer rejected.
  if (
    previousStatus === "connected" &&
    callDurationSec !== null &&
    callDurationSec < 10
  ) {
    return "no_answer";
  }

  if (previousStatus === "connected") return "done";

  // At this point: the agent never actually picked up.
  // For campaigns, that's almost always "customer didn't answer" regardless of
  // the specific reason (CUSTOMER_DISCONNECT, AGENT_DISCONNECT, UNKNOWN, etc).
  // Only explicit errors caught earlier in the dial path should mark "failed".
  return "no_answer";
}

async function updateCampaignContactStatus(
  link: { campaignId: string; rowId: string; attempts: number; status: string },
  newStatus: string,
  extra: Record<string, string | number> = {}
): Promise<void> {
  const setParts: string[] = ["#st = :new"];
  const exprVals: Record<string, { S?: string; N?: string }> = {
    ":new": { S: newStatus },
  };
  const exprNames: Record<string, string> = { "#st": "status" };

  for (const [k, v] of Object.entries(extra)) {
    setParts.push(`${k} = :${k}`);
    if (typeof v === "number") exprVals[`:${k}`] = { N: String(v) };
    else exprVals[`:${k}`] = { S: v };
  }

  await dynamo.send(
    new UpdateItemCommand({
      TableName: CAMPAIGN_CONTACTS_TABLE,
      Key: {
        campaignId: { S: link.campaignId },
        rowId: { S: link.rowId },
      },
      UpdateExpression: "SET " + setParts.join(", "),
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprVals,
    })
  );
}

// Bump the aggregate counters on the campaign row. Best-effort; authoritative counts
// come from Query on the contacts GSI.
async function updateCampaignCounters(
  campaignId: string,
  newStatus: string,
  previousStatus: string
): Promise<void> {
  const counterInc: Record<string, number> = {};
  const counterDec: Record<string, number> = {};

  const statusToCounter: Record<string, string> = {
    pending: "pendingCount",
    dialing: "dialingCount",
    connected: "connectedCount",
    done: "doneCount",
    no_answer: "noAnswerCount",
    failed: "failedCount",
  };
  const incKey = statusToCounter[newStatus];
  const decKey = statusToCounter[previousStatus];
  if (incKey) counterInc[incKey] = 1;
  if (decKey && decKey !== incKey) counterDec[decKey] = 1;

  const allOps = { ...counterInc };
  for (const k of Object.keys(counterDec)) allOps[k] = -1;

  if (Object.keys(allOps).length === 0) return;

  const addParts = Object.entries(allOps).map(
    ([key, val], i) => `${key} :v${i}`
  );
  const exprVals: Record<string, { N: string }> = {};
  Object.entries(allOps).forEach(([, val], i) => {
    exprVals[`:v${i}`] = { N: String(val) };
  });

  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
        UpdateExpression: "ADD " + addParts.join(", "),
        ExpressionAttributeValues: exprVals,
      })
    );
  } catch (err) {
    console.warn("updateCampaignCounters failed:", err);
  }
}

export const handler: EventBridgeHandler<
  "Amazon Connect Contact Event",
  ConnectContactEvent["detail"],
  void
> = async (event) => {
  const detail = event.detail;
  const contactId = detail.contactId;
  const eventType = detail.eventType;

  try {
    // ── 1. Main contacts table (analytics) ─────────────────────────────
    // Skip the Put entirely if we don't have an agent yet — the GSI
    // (agentUsername-initiationTimestamp) rejects empty-string keys, and an
    // analytics row without an agent isn't useful. We'll get a CONNECTED_TO_AGENT
    // event later when the agent picks up, at which point we insert the row.
    if (eventType === "INITIATED" || eventType === "CONNECTED_TO_AGENT") {
      const agentId = detail.agentInfo?.agentArn?.split("/").pop() || "";
      // Same resolve as the campaign-contact write below — keeps both
      // analytics and campaign tables consistent in their username field.
      const agentName = agentId ? await resolveUsername(agentId) : "";
      const queueName = detail.queueInfo?.queueArn?.split("/").pop() || "";
      if (agentName) {
        try {
          await dynamo.send(
            new PutItemCommand({
              TableName: TABLE_NAME,
              Item: {
                contactId: { S: contactId },
                initiationTimestamp: {
                  S: detail.initiationTimestamp || new Date().toISOString(),
                },
                channel: { S: detail.channel || "VOICE" },
                agentUsername: { S: agentName },
                queueName: { S: queueName || "unknown" },
                initiationMethod: { S: detail.initiationMethod || "" },
                status: { S: "ACTIVE" },
              },
              ConditionExpression: "attribute_not_exists(contactId)",
            })
          );
        } catch (err) {
          if (
            !(err instanceof Error) ||
            err.name !== "ConditionalCheckFailedException"
          ) {
            // Don't rethrow — failing analytics shouldn't block campaign updates (step 2)
            console.warn("analytics table Put failed, continuing:", err);
          }
        }
      }
    } else if (eventType === "DISCONNECTED" || eventType === "CONTACT_END") {
      // Only update analytics row if it exists — avoids failures for contacts
      // we never inserted (e.g. outbound before CONNECTED_TO_AGENT).
      try {
        await dynamo.send(
          new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: { contactId: { S: contactId } },
            UpdateExpression:
              "SET #status = :status, disconnectTimestamp = :dt, disconnectReason = :dr",
            ConditionExpression: "attribute_exists(contactId)",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":status": { S: "COMPLETED" },
              ":dt": {
                S: detail.disconnectTimestamp || new Date().toISOString(),
              },
              ":dr": { S: detail.disconnectReason || "UNKNOWN" },
            },
          })
        );
        if (ENRICH_FUNCTION_NAME) {
          await lambda.send(
            new InvokeCommand({
              FunctionName: ENRICH_FUNCTION_NAME,
              InvocationType: "Event",
              Payload: Buffer.from(
                JSON.stringify({
                  contactId,
                  instanceId: detail.instanceArn?.split("/").pop() || "",
                })
              ),
            })
          );
        }
      } catch (err) {
        if (
          !(err instanceof Error) ||
          err.name !== "ConditionalCheckFailedException"
        ) {
          console.warn("analytics table Update failed, continuing:", err);
        }
      }
    }

    // ── 2. Campaign-contact link (if this contact belongs to a campaign) ─
    const link = await findCampaignContact(contactId);
    if (!link) return;

    if (eventType === "CONNECTED_TO_AGENT") {
      const agentId = detail.agentInfo?.agentArn?.split("/").pop() || "";
      // Resolve the UUID to the actual username so the campaign detail
      // table doesn't show raw IDs to the admin. Falls back to the UUID
      // if DescribeUser fails (cached after first call per warm Lambda).
      const username = await resolveUsername(agentId);
      await updateCampaignContactStatus(link, "connected", {
        agentUsername: username,
        connectedAt: new Date().toISOString(),
      });
      await updateCampaignCounters(link.campaignId, "connected", link.status);
    } else if (
      eventType === "DISCONNECTED" ||
      eventType === "CONTACT_END"
    ) {
      // Compute call duration (seconds between agent-connected and now) so we
      // can distinguish a real conversation from a quick voicemail / rejection.
      let callDurationSec: number | null = null;
      if (link.connectedAt) {
        const disc = detail.disconnectTimestamp
          ? Date.parse(detail.disconnectTimestamp)
          : Date.now();
        const conn = Date.parse(link.connectedAt);
        if (!isNaN(conn) && !isNaN(disc)) {
          callDurationSec = Math.max(0, Math.round((disc - conn) / 1000));
        }
      }

      const newStatus = classifyDisconnect(
        detail.disconnectReason,
        link.status,
        callDurationSec
      );
      await updateCampaignContactStatus(link, newStatus, {
        disconnectReason: detail.disconnectReason || "UNKNOWN",
        disconnectedAt: new Date().toISOString(),
        callDurationSec: callDurationSec ?? 0,
      });
      await updateCampaignCounters(link.campaignId, newStatus, link.status);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "ConditionalCheckFailedException"
    ) {
      return;
    }
    console.error("Error processing contact event:", error);
    throw error;
  }
};
