import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  UpdateItemCommand,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ConnectCampaignsV2Client,
  StartCampaignCommand,
  PauseCampaignCommand,
  ResumeCampaignCommand,
  StopCampaignCommand,
  PutOutboundRequestBatchCommand,
} from "@aws-sdk/client-connectcampaignsv2";
import { randomUUID } from "node:crypto";

const dynamo = new DynamoDBClient({});
const campaignsV2 = new ConnectCampaignsV2Client({ maxAttempts: 2 });
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CONTACTS_TABLE =
  process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";

const ALLOWED_ACTIONS = new Set(["start", "pause", "resume", "cancel"]);

interface ContactRow {
  campaignId: string;
  rowId: string;
  phone: string;
  customerName: string;
  customAttributes: string; // JSON string
  status: string;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function queryPendingContacts(campaignId: string): Promise<ContactRow[]> {
  const items: ContactRow[] = [];
  let lastKey: Record<string, unknown> | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: CONTACTS_TABLE,
        IndexName: "campaignId-status-index",
        KeyConditionExpression: "campaignId = :cid AND #st = :s",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":cid": { S: campaignId },
          ":s": { S: "pending" },
        },
        ExclusiveStartKey: lastKey as never,
      })
    );
    for (const it of res.Items || []) items.push(unmarshall(it) as ContactRow);
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    if (!lastKey) break;
  }
  return items;
}

// Push pending contacts into the AWS Outbound Campaigns service.
// Returns the count of rows enqueued. Service takes over dialing with AMD/pacing.
async function pushContactsToAws(
  awsCampaignId: string,
  contacts: ContactRow[]
): Promise<number> {
  if (contacts.length === 0) return 0;
  let queued = 0;
  // Max 25 per PutOutboundRequestBatch (AWS limit)
  for (const batch of chunk(contacts, 25)) {
    try {
      await campaignsV2.send(
        new PutOutboundRequestBatchCommand({
          id: awsCampaignId,
          outboundRequests: batch.map((c) => {
            // Parse custom attributes so we can pass them as contact attributes
            let attrs: Record<string, string> = {};
            try {
              attrs = JSON.parse(c.customAttributes || "{}");
            } catch {
              /* ignore */
            }
            return {
              clientToken: `${c.rowId}-${Date.now()}`.slice(0, 500),
              // AWS Campaigns v2 enforces max 15 minutes for expirationTime.
              // Use 10 minutes to leave a safety margin.
              expirationTime: new Date(
                Date.now() + 10 * 60 * 1000
              ),
              channelSubtypeParameters: {
                telephony: {
                  destinationPhoneNumber: c.phone,
                  // Pass our internal rowId + name so the flow can surface them.
                  // AWS requires keys be alphanumeric, dash, or underscore only.
                  attributes: {
                    campaignRowId: c.rowId,
                    customerName: c.customerName || "",
                    ...Object.fromEntries(
                      Object.entries(attrs)
                        .slice(0, 25)
                        .map(([k, v]) => [
                          k.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 127),
                          String(v).slice(0, 256),
                        ])
                        .filter(([k]) => k.length > 0)
                    ),
                  },
                },
              },
            };
          }),
        })
      );
      // Mark as "queued" (status=dialing) — the service will dial them soon
      for (const c of batch) {
        await dynamo
          .send(
            new UpdateItemCommand({
              TableName: CONTACTS_TABLE,
              Key: {
                campaignId: { S: c.campaignId },
                rowId: { S: c.rowId },
              },
              UpdateExpression:
                "SET #st = :dialing, lastAttemptAt = :now, attempts = if_not_exists(attempts, :zero) + :one",
              ExpressionAttributeNames: { "#st": "status" },
              ExpressionAttributeValues: {
                ":dialing": { S: "dialing" },
                ":now": { S: new Date().toISOString() },
                ":zero": { N: "0" },
                ":one": { N: "1" },
              },
            })
          )
          .catch((err) => {
            console.warn("markDialing failed for", c.rowId, err);
          });
        queued++;
      }
    } catch (err) {
      console.error("PutOutboundRequestBatch failed:", err);
    }
  }
  return queued;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { campaignId, action } = body;

    if (!campaignId || !action) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId and action required" }),
      };
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `action must be one of: ${[...ALLOWED_ACTIONS].join(", ")}`,
        }),
      };
    }

    const now = new Date().toISOString();

    const current = await dynamo.send(
      new GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
      })
    );
    if (!current.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" }),
      };
    }
    const campaign = unmarshall(current.Item);
    const currentStatus = campaign.status as string;
    const awsCampaignId = campaign.awsCampaignId as string | undefined;
    const useNative = !!awsCampaignId;

    let newStatus: string;
    const extraSets: Record<string, { S?: string; NULL?: boolean }> = {};

    switch (action) {
      case "start":
        if (currentStatus !== "DRAFT" && currentStatus !== "PAUSED") {
          return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: `Cannot start from status ${currentStatus}`,
            }),
          };
        }
        newStatus = "RUNNING";
        if (currentStatus === "DRAFT") extraSets.startedAt = { S: now };
        break;
      case "pause":
        if (currentStatus !== "RUNNING") {
          return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: `Cannot pause from status ${currentStatus}`,
            }),
          };
        }
        newStatus = "PAUSED";
        break;
      case "resume":
        if (currentStatus !== "PAUSED") {
          return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: `Cannot resume from status ${currentStatus}`,
            }),
          };
        }
        newStatus = "RUNNING";
        break;
      case "cancel":
        if (
          currentStatus === "COMPLETED" ||
          currentStatus === "CANCELLED"
        ) {
          return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: `Cannot cancel from status ${currentStatus}`,
            }),
          };
        }
        newStatus = "CANCELLED";
        extraSets.completedAt = { S: now };
        break;
      default:
        throw new Error("unreachable");
    }

    // ── 1. Mirror the state change to AWS Outbound Campaigns v2 ──────────
    let queuedCount = 0;
    if (useNative && awsCampaignId) {
      try {
        if (action === "start" || action === "resume") {
          // Make sure the campaign is Running in AWS
          await campaignsV2
            .send(new StartCampaignCommand({ id: awsCampaignId }))
            .catch(async (err) => {
              // If already running, ResumeCampaign is the right call
              const msg = err instanceof Error ? err.message : String(err);
              if (/already|invalid state/i.test(msg)) {
                await campaignsV2
                  .send(new ResumeCampaignCommand({ id: awsCampaignId }))
                  .catch(() => {
                    /* ignore */
                  });
              } else {
                throw err;
              }
            });
          // Push all pending contacts to AWS — service will dial with AMD/pacing
          const pending = await queryPendingContacts(campaignId);
          queuedCount = await pushContactsToAws(awsCampaignId, pending);
        } else if (action === "pause") {
          await campaignsV2.send(
            new PauseCampaignCommand({ id: awsCampaignId })
          );
        } else if (action === "cancel") {
          await campaignsV2.send(
            new StopCampaignCommand({ id: awsCampaignId })
          );
        }
      } catch (err) {
        console.error(
          "AWS campaigns v2 action failed (continuing with DynamoDB update):",
          err
        );
        // Don't fail the whole operation — the user can retry
      }
    }

    // ── 2. Update the meta in DynamoDB ───────────────────────────────────
    const setExpressions = ["#st = :new"];
    const exprVals: Record<string, { S: string }> = { ":new": { S: newStatus } };
    const exprNames: Record<string, string> = { "#st": "status" };

    for (const [key, val] of Object.entries(extraSets)) {
      setExpressions.push(`${key} = :${key}`);
      if (val.S) exprVals[`:${key}`] = { S: val.S };
    }

    await dynamo.send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
        UpdateExpression: "SET " + setExpressions.join(", "),
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprVals,
      })
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        status: newStatus,
        previousStatus: currentStatus,
        useNative,
        awsCampaignId: awsCampaignId || null,
        contactsQueued: queuedCount,
      }),
    };
  } catch (err) {
    console.error("control-campaign error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to control campaign",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};

// Silence unused import warning
void randomUUID;
