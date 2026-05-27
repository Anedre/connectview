import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ConnectCampaignsV2Client,
  PutOutboundRequestBatchCommand,
} from "@aws-sdk/client-connectcampaignsv2";
import { randomUUID } from "node:crypto";

const dynamo = new DynamoDBClient({});
const campaignsV2 = new ConnectCampaignsV2Client({ maxAttempts: 2 });
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CONTACTS_TABLE =
  process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";

type Action = "add" | "delete" | "update" | "manual-call" | "manual-skip";

interface AddPayload {
  action: "add";
  campaignId: string;
  contacts: Array<{
    phone: string;
    customerName?: string;
    attributes?: Record<string, string>;
  }>;
}

interface DeletePayload {
  action: "delete";
  campaignId: string;
  rowIds: string[];
}

interface UpdatePayload {
  action: "update";
  campaignId: string;
  rowId: string;
  phone?: string;
  customerName?: string;
  attributes?: Record<string, string>;
}

/** Manual / preview-dial actions issued by the agent's desktop. */
interface ManualCallPayload {
  action: "manual-call";
  campaignId: string;
  rowId: string;
  userId: string;
}

interface ManualSkipPayload {
  action: "manual-skip";
  campaignId: string;
  rowId: string;
  userId: string;
  /** Optional reason — recorded for analytics. */
  reason?: string;
}

type Payload =
  | AddPayload
  | DeletePayload
  | UpdatePayload
  | ManualCallPayload
  | ManualSkipPayload;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const STATUS_TO_COUNTER: Record<string, string> = {
  pending: "pendingCount",
  dialing: "dialingCount",
  connected: "connectedCount",
  done: "doneCount",
  no_answer: "noAnswerCount",
  failed: "failedCount",
  skipped: "skippedCount",
};

async function bumpCampaignCounters(
  campaignId: string,
  deltas: Record<string, number>
): Promise<void> {
  const adds: string[] = [];
  const vals: Record<string, { N: string }> = {};
  let i = 0;
  for (const [key, delta] of Object.entries(deltas)) {
    if (delta === 0) continue;
    const placeholder = `:v${i++}`;
    adds.push(`${key} ${placeholder}`);
    vals[placeholder] = { N: String(delta) };
  }
  if (adds.length === 0) return;
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
        UpdateExpression: "ADD " + adds.join(", "),
        ExpressionAttributeValues: vals,
      })
    );
  } catch (err) {
    console.warn("counter update failed:", err);
  }
}

// Push contacts to AWS Outbound Campaigns so the service dials them with AMD.
// Also flips the DynamoDB row status from pending → dialing.
async function pushToAws(
  awsCampaignId: string,
  rows: Array<{
    campaignId: string;
    rowId: string;
    phone: string;
    customerName: string;
    attributes: Record<string, string>;
  }>
): Promise<number> {
  let queued = 0;
  for (const batch of chunk(rows, 25)) {
    try {
      await campaignsV2.send(
        new PutOutboundRequestBatchCommand({
          id: awsCampaignId,
          outboundRequests: batch.map((c) => ({
            clientToken: `${c.rowId}-${Date.now()}`.slice(0, 500),
            // AWS Campaigns v2 enforces max 15 minutes. Use 10 min with a safety margin.
            expirationTime: new Date(Date.now() + 10 * 60 * 1000),
            channelSubtypeParameters: {
              telephony: {
                destinationPhoneNumber: c.phone,
                // AWS requires keys be alphanumeric, dash, or underscore only.
                attributes: {
                  campaignRowId: c.rowId,
                  customerName: c.customerName || "",
                  ...Object.fromEntries(
                    Object.entries(c.attributes)
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
          })),
        })
      );
      // Flip status to dialing for each
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
          .catch(() => {
            /* best effort */
          });
        queued++;
      }
    } catch (err) {
      console.warn("pushToAws batch failed:", err);
    }
  }
  return queued;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleAdd(body: AddPayload): Promise<any> {
  if (!Array.isArray(body.contacts) || body.contacts.length === 0) {
    return { statusCode: 400, body: { error: "contacts must be non-empty" } };
  }

  const validContacts = body.contacts.filter((c) =>
    /^\+\d{8,15}$/.test((c.phone || "").trim())
  );
  const skipped = body.contacts.length - validContacts.length;

  if (validContacts.length === 0) {
    return {
      statusCode: 400,
      body: { error: "No valid phone numbers", skipped },
    };
  }

  // Fetch campaign meta so we know if v2 is linked and if it's running
  const campRes = await dynamo.send(
    new GetItemCommand({
      TableName: CAMPAIGNS_TABLE,
      Key: { campaignId: { S: body.campaignId } },
    })
  );
  const campaign = campRes.Item ? unmarshall(campRes.Item) : null;
  const awsCampaignId = campaign?.awsCampaignId as string | undefined;
  const isRunning = campaign?.status === "RUNNING";

  const now = new Date().toISOString();
  let inserted = 0;
  const insertedRows: Array<{
    campaignId: string;
    rowId: string;
    phone: string;
    customerName: string;
    attributes: Record<string, string>;
  }> = [];

  for (const batch of chunk(validContacts, 25)) {
    await dynamo.send(
      new BatchWriteItemCommand({
        RequestItems: {
          [CONTACTS_TABLE]: batch.map((c) => {
            const rowId = randomUUID();
            insertedRows.push({
              campaignId: body.campaignId,
              rowId,
              phone: c.phone,
              customerName: c.customerName || "",
              attributes: c.attributes || {},
            });
            return {
              PutRequest: {
                Item: {
                  campaignId: { S: body.campaignId },
                  rowId: { S: rowId },
                  phone: { S: c.phone },
                  customerName: { S: c.customerName || "" },
                  customAttributes: {
                    S: JSON.stringify(c.attributes || {}),
                  },
                  status: { S: "pending" },
                  attempts: { N: "0" },
                  createdAt: { S: now },
                  nextRetryAt: { S: now },
                },
              },
            };
          }),
        },
      })
    );
    inserted += batch.length;
  }

  await bumpCampaignCounters(body.campaignId, {
    totalContacts: inserted,
    pendingCount: inserted,
  });

  // If the campaign is running AND linked to a v2 resource, push them now
  let pushed = 0;
  if (isRunning && awsCampaignId) {
    pushed = await pushToAws(awsCampaignId, insertedRows);
  }

  return {
    statusCode: 200,
    body: {
      action: "add",
      inserted,
      skipped,
      pushedToAws: pushed,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleDelete(body: DeletePayload): Promise<any> {
  if (!Array.isArray(body.rowIds) || body.rowIds.length === 0) {
    return { statusCode: 400, body: { error: "rowIds must be non-empty" } };
  }

  // Look up each row's status first so we can update counters correctly,
  // then delete.
  const statusDeltas: Record<string, number> = {
    totalContacts: 0,
    pendingCount: 0,
    dialingCount: 0,
    connectedCount: 0,
    doneCount: 0,
    noAnswerCount: 0,
    failedCount: 0,
  };
  let removed = 0;
  const errors: string[] = [];

  for (const rowId of body.rowIds) {
    try {
      const res = await dynamo.send(
        new GetItemCommand({
          TableName: CONTACTS_TABLE,
          Key: {
            campaignId: { S: body.campaignId },
            rowId: { S: rowId },
          },
        })
      );
      if (!res.Item) {
        errors.push(`row ${rowId} not found`);
        continue;
      }
      // Protect: don't allow deleting rows that are currently dialing/connected
      const status = res.Item.status?.S || "";
      if (status === "dialing" || status === "connected") {
        errors.push(`row ${rowId} is ${status} — cannot delete mid-call`);
        continue;
      }

      await dynamo.send(
        new DeleteItemCommand({
          TableName: CONTACTS_TABLE,
          Key: {
            campaignId: { S: body.campaignId },
            rowId: { S: rowId },
          },
        })
      );
      removed++;
      statusDeltas.totalContacts -= 1;
      const counter = STATUS_TO_COUNTER[status];
      if (counter) statusDeltas[counter] -= 1;
    } catch (err) {
      errors.push(
        `row ${rowId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  await bumpCampaignCounters(body.campaignId, statusDeltas);

  return {
    statusCode: 200,
    body: { action: "delete", removed, errors },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleUpdate(body: UpdatePayload): Promise<any> {
  const { campaignId, rowId } = body;
  if (!rowId) {
    return { statusCode: 400, body: { error: "rowId required" } };
  }

  const current = await dynamo.send(
    new GetItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: campaignId },
        rowId: { S: rowId },
      },
    })
  );
  if (!current.Item) {
    return { statusCode: 404, body: { error: "Contact row not found" } };
  }
  const currentStatus = current.Item.status?.S || "";
  if (currentStatus === "dialing" || currentStatus === "connected") {
    return {
      statusCode: 409,
      body: {
        error: `Row is ${currentStatus} — cannot edit while the call is live.`,
      },
    };
  }

  const sets: string[] = [];
  const vals: Record<string, { S: string }> = {};

  if (body.phone !== undefined) {
    if (!/^\+\d{8,15}$/.test(body.phone.trim())) {
      return {
        statusCode: 400,
        body: { error: "phone must be E.164 (+<digits>, 8-15 digits)" },
      };
    }
    sets.push("phone = :phone");
    vals[":phone"] = { S: body.phone.trim() };
  }
  if (body.customerName !== undefined) {
    sets.push("customerName = :name");
    vals[":name"] = { S: body.customerName };
  }
  if (body.attributes !== undefined) {
    sets.push("customAttributes = :attrs");
    vals[":attrs"] = { S: JSON.stringify(body.attributes || {}) };
  }

  if (sets.length === 0) {
    return { statusCode: 400, body: { error: "No editable fields provided" } };
  }

  sets.push("updatedAt = :updatedAt");
  vals[":updatedAt"] = { S: new Date().toISOString() };

  await dynamo.send(
    new UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: campaignId },
        rowId: { S: rowId },
      },
      UpdateExpression: "SET " + sets.join(", "),
      ExpressionAttributeValues: vals,
    })
  );

  return { statusCode: 200, body: { action: "update", rowId, updated: true } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * Manual-mode dial action — the agent's UI calls this when they click
 * "Llamar" on a preview lead. We:
 *   1. Verify the row exists, is pending, and is assigned to this user
 *      (guard against agents calling each other's leads)
 *   2. Mark it as `dialing` with attempts++
 *   3. Return the phone number for the frontend to feed into placeCall()
 * Idempotent: if the row is already dialing/connected for the same user,
 * just returns the phone again (no-op).
 */
async function handleManualCall(body: ManualCallPayload) {
  if (!body.rowId || !body.userId) {
    return { statusCode: 400, body: { error: "rowId and userId required" } };
  }
  const cur = await dynamo.send(
    new GetItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: body.campaignId },
        rowId: { S: body.rowId },
      },
    })
  );
  if (!cur.Item) {
    return { statusCode: 404, body: { error: "Contact not found" } };
  }
  const row = unmarshall(cur.Item);
  const assigned = (row.assignedAgentUserId as string) || "";
  if (assigned && assigned !== body.userId) {
    return {
      statusCode: 403,
      body: { error: "Contact assigned to a different agent" },
    };
  }
  const phone = (row.phone as string) || "";
  if (!phone) {
    return { statusCode: 400, body: { error: "Contact has no phone" } };
  }
  const currentStatus = (row.status as string) || "pending";
  if (
    currentStatus !== "pending" &&
    currentStatus !== "dialing" &&
    currentStatus !== "connected"
  ) {
    return {
      statusCode: 409,
      body: { error: `Contact is in terminal state: ${currentStatus}` },
    };
  }
  await dynamo.send(
    new UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: body.campaignId },
        rowId: { S: body.rowId },
      },
      UpdateExpression:
        "SET #st = :d, lastAttemptAt = :now, attempts = if_not_exists(attempts, :z) + :one, assignedAgentUserId = :uid",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":d": { S: "dialing" },
        ":now": { S: new Date().toISOString() },
        ":z": { N: "0" },
        ":one": { N: "1" },
        ":uid": { S: body.userId },
      },
    })
  );
  if (currentStatus === "pending") {
    await bumpCampaignCounters(body.campaignId, {
      pendingCount: -1,
      dialingCount: 1,
    });
  }
  return {
    statusCode: 200,
    body: {
      ok: true,
      phone,
      rowId: body.rowId,
      customerName: (row.customerName as string) || "",
      attributes: (row.attributes as Record<string, string>) || {},
    },
  };
}

/**
 * Manual-mode skip — agent decides not to call this lead now. We mark
 * the row as `skipped` (a new terminal status that doesn't retry).
 */
async function handleManualSkip(body: ManualSkipPayload) {
  if (!body.rowId || !body.userId) {
    return { statusCode: 400, body: { error: "rowId and userId required" } };
  }
  const cur = await dynamo.send(
    new GetItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: body.campaignId },
        rowId: { S: body.rowId },
      },
    })
  );
  if (!cur.Item) {
    return { statusCode: 404, body: { error: "Contact not found" } };
  }
  const row = unmarshall(cur.Item);
  const assigned = (row.assignedAgentUserId as string) || "";
  if (assigned && assigned !== body.userId) {
    return {
      statusCode: 403,
      body: { error: "Contact assigned to a different agent" },
    };
  }
  const currentStatus = (row.status as string) || "pending";
  if (currentStatus !== "pending") {
    return {
      statusCode: 409,
      body: { error: `Contact is not pending: ${currentStatus}` },
    };
  }
  await dynamo.send(
    new UpdateItemCommand({
      TableName: CONTACTS_TABLE,
      Key: {
        campaignId: { S: body.campaignId },
        rowId: { S: body.rowId },
      },
      UpdateExpression:
        "SET #st = :s, skippedAt = :now, skippedBy = :uid, skippedReason = :r",
      ExpressionAttributeNames: { "#st": "status" },
      ExpressionAttributeValues: {
        ":s": { S: "skipped" },
        ":now": { S: new Date().toISOString() },
        ":uid": { S: body.userId },
        ":r": { S: body.reason || "" },
      },
    })
  );
  await bumpCampaignCounters(body.campaignId, {
    pendingCount: -1,
    skippedCount: 1,
  });
  return { statusCode: 200, body: { ok: true, rowId: body.rowId } };
}

export const handler: Handler = async (event: any) => {
  try {
    const body = JSON.parse(event.body || "{}") as Payload;
    const { action, campaignId } = body;

    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" }),
      };
    }

    // Verify campaign exists + not in terminal state (except for safety checks per-row)
    const camp = await dynamo.send(
      new GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
      })
    );
    if (!camp.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" }),
      };
    }

    let result: { statusCode: number; body: unknown };
    if (action === "add") {
      result = await handleAdd(body as AddPayload);
    } else if (action === "delete") {
      result = await handleDelete(body as DeletePayload);
    } else if (action === "update") {
      result = await handleUpdate(body as UpdatePayload);
    } else if (action === "manual-call") {
      result = await handleManualCall(body as ManualCallPayload);
    } else if (action === "manual-skip") {
      result = await handleManualSkip(body as ManualSkipPayload);
    } else {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `Unknown action: ${action as Action}. Use add | delete | update | manual-call | manual-skip.`,
        }),
      };
    }

    return {
      statusCode: result.statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result.body),
    };
  } catch (err) {
    console.error("edit-campaign-contacts error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to edit campaign contacts",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
