import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  UpdateItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";

const dynamo = new DynamoDBClient({});
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";

const ALLOWED_ACTIONS = new Set(["start", "pause", "resume", "cancel"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { campaignId, action } = body;

    if (!campaignId || !action) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId and action required" }),
      };
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `action must be one of: ${[...ALLOWED_ACTIONS].join(", ")}`,
        }),
      };
    }

    const now = new Date().toISOString();

    // Fetch current campaign to validate state transition
    const current = await dynamo.send(
      new GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
      })
    );
    if (!current.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" }),
      };
    }
    const currentStatus = current.Item.status?.S;

    let newStatus: string;
    const extraSets: Record<string, { S?: string; NULL?: boolean }> = {};

    switch (action) {
      case "start":
        if (currentStatus !== "DRAFT" && currentStatus !== "PAUSED") {
          return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: `Cannot start from status ${currentStatus}`,
            }),
          };
        }
        newStatus = "RUNNING";
        if (currentStatus === "DRAFT") extraSets.startedAt = { S: now };
        break;
      case "pause":
        if (currentStatus !== "RUNNING") {
          return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: `Cannot pause from status ${currentStatus}`,
            }),
          };
        }
        newStatus = "PAUSED";
        break;
      case "resume":
        if (currentStatus !== "PAUSED") {
          return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: `Cannot resume from status ${currentStatus}`,
            }),
          };
        }
        newStatus = "RUNNING";
        break;
      case "cancel":
        if (currentStatus === "COMPLETED" || currentStatus === "CANCELLED") {
          return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              error: `Cannot cancel from status ${currentStatus}`,
            }),
          };
        }
        newStatus = "CANCELLED";
        extraSets.completedAt = { S: now };
        break;
      default:
        throw new Error("unreachable");
    }

    const setExpressions = ["#st = :new"];
    const exprVals: Record<string, { S: string }> = {
      ":new": { S: newStatus },
    };
    const exprNames: Record<string, string> = { "#st": "status" };

    for (const [key, val] of Object.entries(extraSets)) {
      setExpressions.push(`${key} = :${key}`);
      if (val.S) exprVals[`:${key}`] = { S: val.S };
    }

    await dynamo.send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: campaignId } },
        UpdateExpression: "SET " + setExpressions.join(", "),
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprVals,
      })
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        status: newStatus,
        previousStatus: currentStatus,
      }),
    };
  } catch (err) {
    console.error("control-campaign error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to control campaign",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
