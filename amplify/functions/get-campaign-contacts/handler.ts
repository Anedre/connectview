import type { Handler } from "aws-lambda";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const dynamo = new DynamoDBClient({});
const CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    const params = event.queryStringParameters || {};
    const campaignId = params.campaignId;
    const statusFilter = params.status; // optional
    const limit = parseInt(params.limit || "100");

    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" }),
      };
    }

    let items: Record<string, unknown>[] = [];

    if (statusFilter) {
      const r = await dynamo.send(
        new QueryCommand({
          TableName: CONTACTS_TABLE,
          IndexName: "campaignId-status-index",
          KeyConditionExpression: "campaignId = :cid AND #st = :s",
          ExpressionAttributeNames: { "#st": "status" },
          ExpressionAttributeValues: {
            ":cid": { S: campaignId },
            ":s": { S: statusFilter },
          },
          Limit: limit,
        })
      );
      items = (r.Items || []).map((it) => unmarshall(it));
    } else {
      const r = await dynamo.send(
        new QueryCommand({
          TableName: CONTACTS_TABLE,
          KeyConditionExpression: "campaignId = :cid",
          ExpressionAttributeValues: { ":cid": { S: campaignId } },
          Limit: limit,
        })
      );
      items = (r.Items || []).map((it) => unmarshall(it));
    }

    // Parse customAttributes JSON back to object for convenience
    for (const it of items) {
      if (typeof it.customAttributes === "string") {
        try {
          it.customAttributes = JSON.parse(it.customAttributes);
        } catch {
          it.customAttributes = {};
        }
      }
    }

    // Sort by attempts desc then lastAttemptAt desc (most active first)
    items.sort((a, b) => {
      const ta = new Date((a.lastAttemptAt as string) || 0).getTime();
      const tb = new Date((b.lastAttemptAt as string) || 0).getTime();
      return tb - ta;
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts: items, count: items.length }),
    };
  } catch (err) {
    console.error("get-campaign-contacts error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get campaign contacts",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
