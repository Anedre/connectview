import type { Handler } from "aws-lambda";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { resolveDynamo } from "../_shared/tenantConnect";

// BYO Data Plane (#46): tenant primero, fallback Vox pooled.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    // BYO Data Plane (#46): tenant primero, fallback Vox.
    ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    // BUG-audit P2: paginar completo (antes truncaba a 10 páginas)
    do {
      const res = await dynamo.send(
        new ScanCommand({
          TableName: CAMPAIGNS_TABLE,
          ExclusiveStartKey: lastKey as never,
        }),
      );
      for (const it of res.Items || []) items.push(unmarshall(it));
      lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    items.sort(
      (a, b) =>
        new Date((b.createdAt as string) || 0).getTime() -
        new Date((a.createdAt as string) || 0).getTime(),
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaigns: items, total: items.length }),
    };
  } catch (err) {
    console.error("list-campaigns error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to list campaigns",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
