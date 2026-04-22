import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  PutItemCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";

const dynamo = new DynamoDBClient({});
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";

interface Contact {
  phone: string; // E.164
  customerName?: string;
  attributes?: Record<string, string>;
}

interface CreateCampaignBody {
  name: string;
  description?: string;
  sourcePhoneNumber: string;
  contactFlowId: string;
  contactFlowName?: string;
  dialMode?: "progressive" | "power" | "agentless";
  concurrency?: number;
  timezone?: string;
  windowStartHour?: number;
  windowEndHour?: number;
  windowDaysOfWeek?: number[]; // 0=Sun..6=Sat
  retryNoAnswerMinutes?: number;
  retryMaxAttempts?: number;
  contacts: Contact[];
  createdBy?: string;
  startNow?: boolean;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    const body: CreateCampaignBody = JSON.parse(event.body || "{}");

    // Basic validation
    const errors: string[] = [];
    if (!body.name?.trim()) errors.push("name is required");
    if (!body.sourcePhoneNumber?.trim()) errors.push("sourcePhoneNumber is required");
    if (!body.contactFlowId?.trim()) errors.push("contactFlowId is required");
    if (!Array.isArray(body.contacts) || body.contacts.length === 0)
      errors.push("contacts must be a non-empty array");
    if (body.contacts && body.contacts.length > 10000)
      errors.push("contacts limited to 10000 per campaign");

    if (errors.length) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Validation failed", details: errors }),
      };
    }

    // E.164 sanity check: phone must start with + and have 8-15 digits
    const validContacts = body.contacts.filter((c) =>
      /^\+\d{8,15}$/.test((c.phone || "").trim())
    );
    const skippedCount = body.contacts.length - validContacts.length;

    if (validContacts.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "No valid phone numbers",
          skipped: skippedCount,
        }),
      };
    }

    const campaignId = randomUUID();
    const now = new Date().toISOString();
    const startNow = body.startNow !== false;
    const status = startNow ? "RUNNING" : "DRAFT";

    // 1. Insert campaign meta
    await dynamo.send(
      new PutItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Item: {
          campaignId: { S: campaignId },
          name: { S: body.name.trim() },
          description: { S: body.description || "" },
          sourcePhoneNumber: { S: body.sourcePhoneNumber },
          contactFlowId: { S: body.contactFlowId },
          contactFlowName: { S: body.contactFlowName || "" },
          dialMode: { S: body.dialMode || "progressive" },
          concurrency: { N: String(body.concurrency || 1) },
          timezone: { S: body.timezone || "America/Lima" },
          windowStartHour: { N: String(body.windowStartHour ?? 9) },
          windowEndHour: { N: String(body.windowEndHour ?? 18) },
          windowDaysOfWeek: {
            S: JSON.stringify(body.windowDaysOfWeek ?? [1, 2, 3, 4, 5]),
          },
          retryNoAnswerMinutes: { N: String(body.retryNoAnswerMinutes ?? 30) },
          retryMaxAttempts: { N: String(body.retryMaxAttempts ?? 3) },
          status: { S: status },
          createdAt: { S: now },
          createdBy: { S: body.createdBy || "system" },
          startedAt: startNow ? { S: now } : { NULL: true },
          completedAt: { NULL: true },
          totalContacts: { N: String(validContacts.length) },
          pendingCount: { N: String(validContacts.length) },
          dialingCount: { N: "0" },
          connectedCount: { N: "0" },
          doneCount: { N: "0" },
          failedCount: { N: "0" },
          noAnswerCount: { N: "0" },
          skippedCount: { N: String(skippedCount) },
        },
      })
    );

    // 2. Batch insert contacts (25 per BatchWriteItem)
    for (const batch of chunk(validContacts, 25)) {
      await dynamo.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [CONTACTS_TABLE]: batch.map((c) => {
              const rowId = randomUUID();
              // customAttributes as JSON string (DynamoDB map type is cumbersome for arbitrary attrs)
              const attrs = JSON.stringify(c.attributes || {});
              return {
                PutRequest: {
                  Item: {
                    campaignId: { S: campaignId },
                    rowId: { S: rowId },
                    phone: { S: c.phone },
                    customerName: { S: c.customerName || "" },
                    customAttributes: { S: attrs },
                    status: { S: "pending" },
                    attempts: { N: "0" },
                    createdAt: { S: now },
                    nextRetryAt: { S: now }, // eligible immediately
                  },
                },
              };
            }),
          },
        })
      );
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        status,
        totalContacts: validContacts.length,
        skipped: skippedCount,
      }),
    };
  } catch (err) {
    console.error("create-campaign error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to create campaign",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
