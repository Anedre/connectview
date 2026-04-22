import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const dynamo = new DynamoDBClient({});
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    const campaignId = event.queryStringParameters?.campaignId;
    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" }),
      };
    }

    // Campaign meta + aggregate counters
    const metaRes = await dynamo.send(
      new GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
      })
    );
    if (!metaRes.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" }),
      };
    }
    const campaign = unmarshall(metaRes.Item);

    // Fresh counts from contacts table by status (authoritative, in case counters drift)
    const statuses = [
      "pending",
      "dialing",
      "connected",
      "done",
      "no_answer",
      "failed",
    ];
    const freshCounts: Record<string, number> = {};
    const dialingContacts: Array<{
      rowId: string;
      phone: string;
      customerName: string;
      agentUsername?: string;
      connectContactId?: string;
      status: string;
    }> = [];

    for (const st of statuses) {
      let count = 0;
      let lastKey: Record<string, unknown> | undefined;
      for (let i = 0; i < 5; i++) {
        const r = await dynamo.send(
          new QueryCommand({
            TableName: CONTACTS_TABLE,
            IndexName: "campaignId-status-index",
            KeyConditionExpression: "campaignId = :cid AND #st = :s",
            ExpressionAttributeNames: { "#st": "status" },
            ExpressionAttributeValues: {
              ":cid": { S: campaignId },
              ":s": { S: st },
            },
            Select: st === "dialing" || st === "connected" ? "ALL_PROJECTED_ATTRIBUTES" : "COUNT",
            ExclusiveStartKey: lastKey as never,
          })
        );
        count += r.Count || 0;
        if (st === "dialing" || st === "connected") {
          for (const it of r.Items || []) {
            const row = unmarshall(it);
            dialingContacts.push({
              rowId: row.rowId as string,
              phone: row.phone as string,
              customerName: (row.customerName as string) || "",
              agentUsername: row.agentUsername as string | undefined,
              connectContactId: row.connectContactId as string | undefined,
              status: row.status as string,
            });
          }
        }
        lastKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
        if (!lastKey) break;
      }
      freshCounts[st] = count;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign,
        counts: freshCounts,
        liveContacts: dialingContacts,
      }),
    };
  } catch (err) {
    console.error("get-campaign-stats error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get campaign stats",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
