import type { Handler } from "aws-lambda";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { resolveDynamo } from "../_shared/tenantConnect";

/**
 * get-hsm-report — the HSM (WhatsApp template) Outbound report (roadmap #6),
 * Chattigo's most-detailed report. Aggregates connectview-hsm-sends by
 * template: sent / delivered / read / failed / expired / pending, plus
 * response & conversion when available. delivered/read/failed are filled by
 * the status events (roadmap #14); until then they read 0 and only "sent"
 * is populated, which is already a useful volume-by-template report.
 */
// BYO Data Plane (#46): tenant primero, fallback Vox pooled.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const HSM_TABLE = process.env.HSM_SENDS_TABLE || "connectview-hsm-sends";

const CORS = { "Content-Type": "application/json" };

interface Row {
  templateName?: string;
  status?: string;
  sentAt?: string;
  language?: string;
}

const STATUSES = ["sent", "delivered", "read", "failed", "expired", "pending"] as const;

 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    // BYO Data Plane (#46): tenant primero, fallback Vox.
    ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));
    // Scan the whole table (send volumes are modest; paginate if it grows).
    const rows: Row[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await dynamo.send(
        new ScanCommand({
          TableName: HSM_TABLE,
          ExclusiveStartKey: lastKey as never,
        })
      );
      for (const it of res.Items || []) rows.push(unmarshall(it) as Row);
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    const byTemplate = new Map<
      string,
      { template: string; lastSentAt: string } & Record<string, number>
    >();
    const totals: Record<string, number> = Object.fromEntries(
      STATUSES.map((s) => [s, 0])
    );
    totals.total = 0;

    for (const r of rows) {
      const tpl = r.templateName || "(sin nombre)";
      if (!byTemplate.has(tpl)) {
        const seed: Record<string, number> = Object.fromEntries(
          STATUSES.map((s) => [s, 0])
        );
        byTemplate.set(tpl, { template: tpl, lastSentAt: "", ...seed });
      }
      const agg = byTemplate.get(tpl)!;
      // Every row counts as a send; its current status bumps that bucket too.
      const st = (r.status || "sent").toLowerCase();
      if (STATUSES.includes(st as never)) {
        agg[st] = (agg[st] || 0) + 1;
        totals[st] = (totals[st] || 0) + 1;
      }
      totals.total += 1;
      if (r.sentAt && r.sentAt > (agg.lastSentAt || "")) agg.lastSentAt = r.sentAt;
    }

    const templates = [...byTemplate.values()].sort(
      (a, b) => (b.sent || 0) - (a.sent || 0)
    );

    // Embudo: "leído" implica "entregado" (delivered ⊇ read, como Chattigo). Los
    // buckets guardan el ÚLTIMO estado (mutuamente excluyentes), así que el
    // "entregado del embudo" = delivered + read. readRate = leídos / entregados.
    const deliveredFunnel = (totals.delivered || 0) + (totals.read || 0);
    const readRate =
      deliveredFunnel > 0 ? Math.round((totals.read / deliveredFunnel) * 100) : 0;
    const failRate =
      totals.total > 0 ? Math.round((totals.failed / totals.total) * 100) : 0;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        totals,
        templates,
        rates: { readRate, failRate },
        generatedAt: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error("get-hsm-report error", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: "report failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
