import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ConnectCampaignsV2Client,
  StartCampaignCommand,
  ResumeCampaignCommand,
  PutOutboundRequestBatchCommand,
} from "@aws-sdk/client-connectcampaignsv2";
import { resolveDynamo } from "../_shared/tenantConnect";
import { kickDialer } from "../_shared/invokeDialer";

// BYO Data Plane (#46): DDB del tenant (su tabla en su cuenta) primero;
// fallback a Vox pooled. ConnectCampaignsV2 queda con cred legacy (AWS service
// que opera a nivel instancia Connect, no se migra aquí).
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const campaignsV2 = new ConnectCampaignsV2Client({ maxAttempts: 2 });
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";
const CONTACTS_TABLE = process.env.CAMPAIGN_CONTACTS_TABLE || "connectview-campaign-contacts";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function pushResetsToAws(
  awsCampaignId: string,
  rows: Array<Record<string, unknown>>,
): Promise<number> {
  let queued = 0;
  const toPush = rows.filter((r) => r.rowId && r.phone);
  for (const batch of chunk(toPush, 25)) {
    try {
      await campaignsV2.send(
        new PutOutboundRequestBatchCommand({
          id: awsCampaignId,
          outboundRequests: batch.map((r) => {
            let attrs: Record<string, string> = {};
            const raw = r.customAttributes;
            if (typeof raw === "string") {
              try {
                attrs = JSON.parse(raw);
              } catch {
                /* ignore */
              }
            }
            return {
              clientToken: `${r.rowId}-relaunch-${Date.now()}`.slice(0, 500),
              // AWS Campaigns v2 enforces max 15 minutes. Use 10 min with a safety margin.
              expirationTime: new Date(Date.now() + 10 * 60 * 1000),
              channelSubtypeParameters: {
                telephony: {
                  destinationPhoneNumber: r.phone as string,
                  // AWS requires keys be alphanumeric, dash, or underscore only.
                  attributes: {
                    campaignRowId: r.rowId as string,
                    customerName: (r.customerName as string) || "",
                    ...Object.fromEntries(
                      Object.entries(attrs)
                        .slice(0, 25)
                        .map(([k, v]) => [
                          k.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 127),
                          String(v).slice(0, 256),
                        ])
                        .filter(([k]) => k.length > 0),
                    ),
                  },
                },
              },
            };
          }),
        }),
      );
      // Mark each as dialing
      for (const r of batch) {
        await dynamo
          .send(
            new UpdateItemCommand({
              TableName: CONTACTS_TABLE,
              Key: {
                campaignId: { S: r.campaignId as string },
                rowId: { S: r.rowId as string },
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
            }),
          )
          .catch(() => {
            /* best effort */
          });
        queued++;
      }
    } catch (err) {
      console.warn("pushResetsToAws batch failed:", err);
    }
  }
  return queued;
}

interface RelaunchBody {
  campaignId: string;
  // "all" → reset every row; "failed" → only reset failed+no_answer; "specific" → a given list
  scope?: "all" | "failed" | "specific";
  specificRowIds?: string[];
  resetAttempts?: boolean; // default true — reset the attempts counter
}

async function listContacts(
  campaignId: string,
  statusFilter?: string,
): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let lastKey: Record<string, unknown> | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await dynamo.send(
      statusFilter
        ? new QueryCommand({
            TableName: CONTACTS_TABLE,
            IndexName: "campaignId-status-index",
            KeyConditionExpression: "campaignId = :cid AND #st = :s",
            ExpressionAttributeNames: { "#st": "status" },
            ExpressionAttributeValues: {
              ":cid": { S: campaignId },
              ":s": { S: statusFilter },
            },
            ExclusiveStartKey: lastKey as never,
          })
        : new QueryCommand({
            TableName: CONTACTS_TABLE,
            KeyConditionExpression: "campaignId = :cid",
            ExpressionAttributeValues: { ":cid": { S: campaignId } },
            ExclusiveStartKey: lastKey as never,
          }),
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
    // BYO Data Plane (#46): tenant primero, fallback Vox.
    ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));
    const body: RelaunchBody = JSON.parse(event.body || "{}");
    const { campaignId } = body;
    const scope = body.scope || "all";
    const resetAttempts = body.resetAttempts !== false;

    if (!campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" }),
      };
    }

    const current = await dynamo.send(
      new GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
      }),
    );
    if (!current.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" }),
      };
    }

    // Gather rows to reset
    let rowsToReset: Array<Record<string, unknown>> = [];
    if (scope === "all") {
      rowsToReset = await listContacts(campaignId);
    } else if (scope === "failed") {
      const failed = await listContacts(campaignId, "failed");
      const noAnswer = await listContacts(campaignId, "no_answer");
      rowsToReset = [...failed, ...noAnswer];
    } else if (scope === "specific" && body.specificRowIds?.length) {
      const allRows = await listContacts(campaignId);
      const ids = new Set(body.specificRowIds);
      rowsToReset = allRows.filter((r) => ids.has(r.rowId as string));
    }

    // Reset each row to pending (in batches of 25 via UpdateItem since BatchWrite doesn't support Update)
    const now = new Date().toISOString();
    let resetCount = 0;
    for (const row of rowsToReset) {
      const rowId = row.rowId as string;
      if (!rowId) continue;
      // REMOVE assignedAgentUserId: al relanzar, el contacto vuelve al POOL común
      // y se reparte entre los agentes con hueco. Antes conservaba el bucket del
      // agente original → los relanzados se re-concentraban en el mismo agente.
      const updateExpr = resetAttempts
        ? "SET #st = :pending, nextRetryAt = :now, attempts = :zero REMOVE lastError, disconnectReason, connectContactId, agentUsername, assignedAgentUserId"
        : "SET #st = :pending, nextRetryAt = :now REMOVE lastError, disconnectReason, connectContactId, agentUsername, assignedAgentUserId";
      try {
        await dynamo.send(
          new UpdateItemCommand({
            TableName: CONTACTS_TABLE,
            Key: {
              campaignId: { S: campaignId },
              rowId: { S: rowId },
            },
            UpdateExpression: updateExpr,
            ExpressionAttributeNames: { "#st": "status" },
            ExpressionAttributeValues: {
              ":pending": { S: "pending" },
              ":now": { S: now },
              ...(resetAttempts ? { ":zero": { N: "0" } } : {}),
            },
          }),
        );
        resetCount++;
      } catch (err) {
        console.warn("reset row failed:", rowId, err);
      }
    }

    // Rebuild campaign counters from the authoritative rows
    const allRows = await listContacts(campaignId);
    const counts = {
      pending: 0,
      dialing: 0,
      connected: 0,
      done: 0,
      no_answer: 0,
      failed: 0,
    };
    for (const r of allRows) {
      const s = r.status as string;
      if (s in counts) counts[s as keyof typeof counts]++;
    }

    await dynamo.send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
        UpdateExpression:
          "SET #st = :running, pendingCount = :p, dialingCount = :d, connectedCount = :c, doneCount = :done, noAnswerCount = :na, failedCount = :f, startedAt = :now, completedAt = :null, relaunchedAt = :now",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":running": { S: "RUNNING" },
          ":p": { N: String(counts.pending) },
          ":d": { N: String(counts.dialing) },
          ":c": { N: String(counts.connected) },
          ":done": { N: String(counts.done) },
          ":na": { N: String(counts.no_answer) },
          ":f": { N: String(counts.failed) },
          ":now": { S: now },
          ":null": { NULL: true },
        },
      }),
    );

    // Avoid unused warning
    void BatchWriteItemCommand;

    // If the campaign is linked to AWS Outbound Campaigns v2, push the reset
    // rows so the service dials them (with AMD). Otherwise the custom dialer
    // Lambda would pick them up on its next tick — but we've disabled that.
    const campMeta = current.Item ? unmarshall(current.Item) : {};
    const awsCampaignId = campMeta.awsCampaignId as string | undefined;
    let pushed = 0;
    if (awsCampaignId) {
      try {
        // Ensure campaign is Running in AWS
        await campaignsV2
          .send(new StartCampaignCommand({ id: awsCampaignId }))
          .catch(async (err) => {
            const msg = err instanceof Error ? err.message : String(err);
            if (/already|invalid state/i.test(msg)) {
              await campaignsV2.send(new ResumeCampaignCommand({ id: awsCampaignId })).catch(() => {
                /* ignore */
              });
            }
          });
        pushed = await pushResetsToAws(awsCampaignId, rowsToReset);
      } catch (err) {
        console.warn("AWS v2 push after relaunch failed:", err);
      }
    }

    // Arranque rápido: sin esto, los contactos reencolados esperaban hasta el
    // próximo tick de EventBridge (≤60s). Con el kick, el reintento manual
    // ("Reintentar ahora" del detalle) marca en segundos. Best-effort.
    if (!awsCampaignId) await kickDialer();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        status: "RUNNING",
        rowsReset: resetCount,
        pushedToAws: pushed,
        awsCampaignId: awsCampaignId || null,
        counts,
      }),
    };
  } catch (err) {
    console.error("relaunch-campaign error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to relaunch campaign",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
