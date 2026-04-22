import type { Handler } from "aws-lambda";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const dynamo = new DynamoDBClient({});
const AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    const params = event.queryStringParameters || {};
    const limit = parseInt(params.limit || "100");

    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    for (let i = 0; i < 5; i++) {
      const res = await dynamo.send(
        new ScanCommand({
          TableName: AUDIT_TABLE,
          Limit: limit,
          ExclusiveStartKey: lastKey as never,
        })
      );
      for (const it of res.Items || []) {
        const row = unmarshall(it);
        // Parse target JSON for easier client consumption
        if (typeof row.target === "string") {
          try {
            row.target = JSON.parse(row.target);
          } catch {
            /* keep as string */
          }
        }
        items.push(row);
      }
      lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      if (!lastKey || items.length >= limit) break;
    }

    items.sort(
      (a, b) =>
        new Date((b.timestamp as string) || 0).getTime() -
        new Date((a.timestamp as string) || 0).getTime()
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: items.slice(0, limit),
        total: items.length,
      }),
    };
  } catch (err) {
    console.error("list-audit error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to list audit",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
