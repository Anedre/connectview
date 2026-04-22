import type { EventBridgeHandler } from "aws-lambda";
import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

const dynamo = new DynamoDBClient({});
const lambda = new LambdaClient({});
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "";
const ENRICH_FUNCTION_NAME = process.env.ENRICH_FUNCTION_NAME || "";
const CAMPAIGNS_TABLE =
  process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CAMPAIGN_CONTACTS_TABLE =
  process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";

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
    };
  } catch (err) {
    console.warn("findCampaignContact failed:", err);
    return null;
  }
}

// Classify the disconnect into our campaign contact status.
function classifyDisconnect(
  reason: string | undefined,
  previousStatus: string
): "done" | "no_answer" | "failed" {
  // Keep terminal-success if we got here after CONNECTED_TO_AGENT
  if (previousStatus === "connected") return "done";
  const r = (reason || "").toUpperCase();
  if (
    r === "CUSTOMER_MISSED_CALL" ||
    r === "TELECOM_PROBLEM" ||
    r === "CALL_ABANDONED" ||
    r.includes("MISSED")
  ) {
    return "no_answer";
  }
  if (r === "CUSTOMER_DISCONNECT" || r === "AGENT_DISCONNECT") {
    // If we disconnected before CONNECTED_TO_AGENT, count as no_answer
    return previousStatus === "connected" ? "done" : "no_answer";
  }
  return "failed";
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
    if (eventType === "INITIATED" || eventType === "CONNECTED_TO_AGENT") {
      const agentName = detail.agentInfo?.agentArn?.split("/").pop() || "";
      const queueName = detail.queueInfo?.queueArn?.split("/").pop() || "";
      await dynamo
        .send(
          new PutItemCommand({
            TableName: TABLE_NAME,
            Item: {
              contactId: { S: contactId },
              initiationTimestamp: {
                S: detail.initiationTimestamp || new Date().toISOString(),
              },
              channel: { S: detail.channel || "VOICE" },
              agentUsername: { S: agentName },
              queueName: { S: queueName },
              initiationMethod: { S: detail.initiationMethod || "" },
              status: { S: "ACTIVE" },
            },
            ConditionExpression: "attribute_not_exists(contactId)",
          })
        )
        .catch((err) => {
          if (
            err instanceof Error &&
            err.name === "ConditionalCheckFailedException"
          ) {
            return;
          }
          throw err;
        });
    } else if (eventType === "DISCONNECTED" || eventType === "CONTACT_END") {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: TABLE_NAME,
          Key: { contactId: { S: contactId } },
          UpdateExpression:
            "SET #status = :status, disconnectTimestamp = :dt, disconnectReason = :dr",
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
    }

    // ── 2. Campaign-contact link (if this contact belongs to a campaign) ─
    const link = await findCampaignContact(contactId);
    if (!link) return;

    if (eventType === "CONNECTED_TO_AGENT") {
      const agentId = detail.agentInfo?.agentArn?.split("/").pop() || "";
      await updateCampaignContactStatus(link, "connected", {
        agentUsername: agentId,
        connectedAt: new Date().toISOString(),
      });
      await updateCampaignCounters(link.campaignId, "connected", link.status);
    } else if (
      eventType === "DISCONNECTED" ||
      eventType === "CONTACT_END"
    ) {
      const newStatus = classifyDisconnect(detail.disconnectReason, link.status);
      await updateCampaignContactStatus(link, newStatus, {
        disconnectReason: detail.disconnectReason || "UNKNOWN",
        disconnectedAt: new Date().toISOString(),
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
