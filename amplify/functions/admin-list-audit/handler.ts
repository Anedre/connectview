import type { Handler } from "aws-lambda";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { resolveDynamo } from "../_shared/tenantConnect";

// BYO Data Plane (#46): tenant primero, fallback Vox pooled.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    // BYO Data Plane (#46): tenant primero, fallback Vox.
    ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));
    const params = event.queryStringParameters || {};
    const limit = parseInt(params.limit || "100");

    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    // BUG-audit P2: paginar completo (antes truncaba a 5 páginas y, peor,
    // ordenaba DESPUÉS de cortar → devolvía un subconjunto por orden de hash, no
    // los más recientes). Acumulamos TODO y recién entonces ordenamos por ts desc
    // y recortamos a `limit`.
    // NOTA: con mucho volumen lo ideal sería un GSI por timestamp (el Scan
    // completo se encarece); hoy admin-audit es de bajo volumen.
    do {
      const res = await dynamo.send(
        new ScanCommand({
          TableName: AUDIT_TABLE,
          ExclusiveStartKey: lastKey as never,
        }),
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
    } while (lastKey);

    items.sort(
      (a, b) =>
        new Date((b.timestamp as string) || 0).getTime() -
        new Date((a.timestamp as string) || 0).getTime(),
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
