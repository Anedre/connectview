import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "node:crypto";

const dynamo = new DynamoDBClient({});
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CONTACTS_TABLE =
  process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";

interface CloneBody {
  campaignId: string;
  name?: string; // override clone name (defaults to "<original> (copy)")
  includeContacts?: boolean; // default true — copy the contacts too
  resetAttempts?: boolean; // default true — contacts start fresh as pending
  createdBy?: string;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function listContacts(
  campaignId: string
): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let lastKey: Record<string, unknown> | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: CONTACTS_TABLE,
        KeyConditionExpression: "campaignId = :cid",
        ExpressionAttributeValues: { ":cid": { S: campaignId } },
        ExclusiveStartKey: lastKey as never,
      })
    );
    for (const it of res.Items || []) items.push(unmarshall(it));
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    if (!lastKey) break;
  }
  return items;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    const body: CloneBody = JSON.parse(event.body || "{}");
    const { campaignId } = body;
    const includeContacts = body.includeContacts !== false;
    const resetAttempts = body.resetAttempts !== false;

    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" }),
      };
    }

    // Load source
    const src = await dynamo.send(
      new GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
      })
    );
    if (!src.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Source campaign not found" }),
      };
    }
    const source = unmarshall(src.Item);

    const newCampaignId = randomUUID();
    const now = new Date().toISOString();
    const cloneName =
      body.name?.trim() ||
      `${source.name || "Campaign"} (copy)`.slice(0, 200);

    // Copy contacts first so we know the true totalContacts
    let contacts: Array<Record<string, unknown>> = [];
    if (includeContacts) {
      contacts = await listContacts(campaignId);
    }

    // Insert new campaign meta (always DRAFT — admin reviews and starts it)
    await dynamo.send(
      new PutItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Item: {
          campaignId: { S: newCampaignId },
          name: { S: cloneName },
          description: {
            S: (source.description as string) || "",
          },
          sourcePhoneNumber: { S: (source.sourcePhoneNumber as string) || "" },
          contactFlowId: { S: (source.contactFlowId as string) || "" },
          contactFlowName: { S: (source.contactFlowName as string) || "" },
          dialMode: { S: (source.dialMode as string) || "progressive" },
          concurrency: { N: String(source.concurrency || 1) },
          timezone: { S: (source.timezone as string) || "America/Lima" },
          windowStartHour: { N: String(source.windowStartHour ?? 9) },
          windowEndHour: { N: String(source.windowEndHour ?? 18) },
          windowDaysOfWeek: {
            S:
              typeof source.windowDaysOfWeek === "string"
                ? (source.windowDaysOfWeek as string)
                : JSON.stringify(source.windowDaysOfWeek || [1, 2, 3, 4, 5]),
          },
          retryNoAnswerMinutes: {
            N: String(source.retryNoAnswerMinutes ?? 30),
          },
          retryMaxAttempts: { N: String(source.retryMaxAttempts ?? 3) },
          status: { S: "DRAFT" },
          createdAt: { S: now },
          createdBy: { S: body.createdBy || "system" },
          startedAt: { NULL: true },
          completedAt: { NULL: true },
          totalContacts: { N: String(contacts.length) },
          pendingCount: { N: String(contacts.length) },
          dialingCount: { N: "0" },
          connectedCount: { N: "0" },
          doneCount: { N: "0" },
          failedCount: { N: "0" },
          noAnswerCount: { N: "0" },
          skippedCount: { N: "0" },
          clonedFrom: { S: campaignId },
        },
      })
    );

    // Copy contacts in batches (25 per BatchWrite)
    let contactsCopied = 0;
    if (contacts.length > 0) {
      for (const batch of chunk(contacts, 25)) {
        await dynamo.send(
          new BatchWriteItemCommand({
            RequestItems: {
              [CONTACTS_TABLE]: batch.map((c) => {
                const newRowId = randomUUID();
                return {
                  PutRequest: {
                    Item: {
                      campaignId: { S: newCampaignId },
                      rowId: { S: newRowId },
                      phone: { S: (c.phone as string) || "" },
                      customerName: {
                        S: (c.customerName as string) || "",
                      },
                      customAttributes: {
                        S:
                          typeof c.customAttributes === "string"
                            ? (c.customAttributes as string)
                            : JSON.stringify(c.customAttributes || {}),
                      },
                      status: { S: "pending" },
                      attempts: {
                        N: resetAttempts ? "0" : String(c.attempts || 0),
                      },
                      createdAt: { S: now },
                      nextRetryAt: { S: now },
                    },
                  },
                };
              }),
            },
          })
        );
        contactsCopied += batch.length;
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId: newCampaignId,
        status: "DRAFT",
        name: cloneName,
        clonedFrom: campaignId,
        contactsCopied,
      }),
    };
  } catch (err) {
    console.error("clone-campaign error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to clone campaign",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
