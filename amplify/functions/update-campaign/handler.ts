import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { resolveDynamo } from "../_shared/tenantConnect";

// BYO Data Plane (#46): tenant primero, fallback Vox pooled.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";

// Fields the admin can edit. Everything is optional — partial PATCH semantics.
interface UpdateBody {
  campaignId: string;
  name?: string;
  description?: string;
  sourcePhoneNumber?: string;
  contactFlowId?: string;
  contactFlowName?: string;
  campaignQueueId?: string;
  campaignQueueName?: string;
  dialMode?: "progressive" | "power" | "agentless";
  concurrency?: number;
  timezone?: string;
  windowStartHour?: number;
  windowEndHour?: number;
  windowDaysOfWeek?: number[];
  retryNoAnswerMinutes?: number;
  retryMaxAttempts?: number;
  maxContactsPerAgent?: number;
}

// Each editable field → a builder that knows its DynamoDB value type.
// We systematically alias EVERY attribute name with a `#` placeholder so we
// never collide with DynamoDB reserved keywords (timezone, name, status, etc.).
const FIELD_MAP: Record<
  string,
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toAttrValue: (v: any) => { S?: string; N?: string };
  }
> = {
  name: { toAttrValue: (v: string) => ({ S: v }) },
  description: { toAttrValue: (v: string) => ({ S: v }) },
  sourcePhoneNumber: { toAttrValue: (v: string) => ({ S: v }) },
  contactFlowId: { toAttrValue: (v: string) => ({ S: v }) },
  contactFlowName: { toAttrValue: (v: string) => ({ S: v }) },
  campaignQueueId: { toAttrValue: (v: string) => ({ S: v }) },
  campaignQueueName: { toAttrValue: (v: string) => ({ S: v }) },
  dialMode: { toAttrValue: (v: string) => ({ S: v }) },
  concurrency: { toAttrValue: (v: number) => ({ N: String(v) }) },
  timezone: { toAttrValue: (v: string) => ({ S: v }) },
  windowStartHour: { toAttrValue: (v: number) => ({ N: String(v) }) },
  windowEndHour: { toAttrValue: (v: number) => ({ N: String(v) }) },
  windowDaysOfWeek: {
    toAttrValue: (v: number[]) => ({ S: JSON.stringify(v) }),
  },
  retryNoAnswerMinutes: { toAttrValue: (v: number) => ({ N: String(v) }) },
  retryMaxAttempts: { toAttrValue: (v: number) => ({ N: String(v) }) },
  maxContactsPerAgent: { toAttrValue: (v: number) => ({ N: String(v) }) },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    // BYO Data Plane (#46): tenant primero, fallback Vox.
    ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));
    const body: UpdateBody = JSON.parse(event.body || "{}");
    if (!body.campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" }),
      };
    }

    // Load current state to validate what's editable
    const current = await dynamo.send(
      new GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: body.campaignId } },
      })
    );
    if (!current.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" }),
      };
    }
    const currentStatus = current.Item.status?.S || "";

    // Terminal states can't be edited — offer Clone as an alternative on the client.
    if (currentStatus === "COMPLETED" || currentStatus === "CANCELLED") {
      return {
        statusCode: 409,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `Campaign in ${currentStatus} state cannot be edited. Clone it instead.`,
        }),
      };
    }

    const setExpressions: string[] = [];
    const exprVals: Record<string, { S?: string; N?: string }> = {};
    const exprNames: Record<string, string> = {};

    for (const [field, val] of Object.entries(body)) {
      if (field === "campaignId") continue;
      if (val === undefined || val === null) continue;
      const mapping = FIELD_MAP[field];
      if (!mapping) continue; // ignore unknown fields
      // Always alias with #field so we dodge every DynamoDB reserved keyword
      // without having to maintain a list (timezone, name, status, type, ...).
      const nameAlias = `#${field}`;
      const valueAlias = `:${field}`;
      setExpressions.push(`${nameAlias} = ${valueAlias}`);
      exprNames[nameAlias] = field;
      exprVals[valueAlias] = mapping.toAttrValue(val);
    }

    if (setExpressions.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "No editable fields provided" }),
      };
    }

    // Always bump updatedAt
    setExpressions.push("#updatedAt = :updatedAt");
    exprNames["#updatedAt"] = "updatedAt";
    exprVals[":updatedAt"] = { S: new Date().toISOString() };

    await dynamo.send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: body.campaignId } },
        UpdateExpression: "SET " + setExpressions.join(", "),
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprVals,
      })
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId: body.campaignId,
        updated: true,
        fieldsChanged: setExpressions.length - 1, // minus updatedAt
      }),
    };
  } catch (err) {
    console.error("update-campaign error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to update campaign",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
