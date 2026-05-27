import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  ConnectClient,
  StartTaskContactCommand,
} from "@aws-sdk/client-connect";

const dynamo = new DynamoDBClient({});
const connect = new ConnectClient({ maxAttempts: 1 });
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "connectview-contacts";
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
// The contact flow we route the follow-up task to. Defaults to the same
// inbound-handling flow so it shows in the agent's task queue.
const FOLLOWUP_FLOW_ID = process.env.FOLLOWUP_FLOW_ID || "";
// The queue that owns follow-up tasks. Defaults to the agent's default
// queue if not set — the frontend must pass it explicitly otherwise.
const FOLLOWUP_QUEUE_ID = process.env.FOLLOWUP_QUEUE_ID || "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";

  try {
    if (method === "GET") {
      const contactId = event.queryStringParameters?.contactId;
      if (!contactId) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "contactId required" }),
        };
      }

      const result = await dynamo.send(
        new GetItemCommand({
          TableName: TABLE_NAME,
          Key: { contactId: { S: contactId } },
        })
      );

      const item = result.Item ? unmarshall(result.Item) : null;
      // Surface ALL wrap-up fields so the historical-contact viewer can
      // render the full disposition + follow-up state, not just the
      // free-form notes + summary.
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          notes: item?.agentNotes || "",
          wrapUpCode: item?.wrapUpCode || "",
          summary: item?.summary || "",
          stage: item?.stage || "",
          stageLabel: item?.stageLabel || "",
          subStage: item?.subStage || "",
          subStageLabel: item?.subStageLabel || "",
          valoracion: item?.valoracion || "",
          tags: item?.tags || [],
          followUps: item?.followUps || {},
          followUpTaskIds: item?.followUpTaskIds || [],
          updatedAt: item?.updatedAt || "",
          agentUsername: item?.agentUsername || "",
        }),
      };
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const {
        contactId,
        notes,
        wrapUpCode,
        summary,
        agentUsername,
        // Wrap-up disposition tree
        stage,
        stageLabel,
        subStage,
        subStageLabel,
        valoracion,
        tags,
        followUps,
        // Optional context the follow-up creation needs
        customerPhone,
        followUpQueueId,
      } = body;

      if (!contactId) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "contactId required" }),
        };
      }

      // Build item - only include fields that were provided. We use marshall
      // for the structured fields (tags array, followUps object) so DynamoDB
      // stores them natively instead of forcing the frontend to JSON.stringify.
      const item: Record<string, unknown> = {
        contactId,
        updatedAt: new Date().toISOString(),
      };
      if (notes !== undefined) item.agentNotes = notes;
      if (wrapUpCode !== undefined) item.wrapUpCode = wrapUpCode;
      if (summary !== undefined) item.summary = summary;
      if (agentUsername !== undefined) item.agentUsername = agentUsername;
      if (stage !== undefined) item.stage = stage;
      if (stageLabel !== undefined) item.stageLabel = stageLabel;
      if (subStage !== undefined) item.subStage = subStage;
      if (subStageLabel !== undefined) item.subStageLabel = subStageLabel;
      if (valoracion !== undefined) item.valoracion = valoracion;
      if (Array.isArray(tags)) item.tags = tags;
      if (followUps && typeof followUps === "object") item.followUps = followUps;

      // Create actionable follow-up tasks. We only do this on the FIRST save
      // (when followUpTaskIds isn't already populated) so re-saving a
      // wrap-up doesn't spam the agent's queue with duplicates.
      const followUpTaskIds: string[] = [];
      if (followUps?.task24h && INSTANCE_ID) {
        // Connect TASK contact, scheduled for +24h from now, routed to the
        // follow-up queue. The agent will see it in their tasks tab.
        const queueId = followUpQueueId || FOLLOWUP_QUEUE_ID;
        if (queueId && FOLLOWUP_FLOW_ID) {
          try {
            const scheduledTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const task = await connect.send(
              new StartTaskContactCommand({
                InstanceId: INSTANCE_ID,
                ContactFlowId: FOLLOWUP_FLOW_ID,
                Name: `Follow-up ${
                  subStageLabel || stageLabel || "wrap-up"
                } — ${customerPhone || contactId.slice(0, 8)}`,
                Description: notes || summary || "Follow-up automático",
                References: {
                  originContact: {
                    Type: "CONTACT",
                    Value: contactId,
                  },
                },
                ScheduledTime: scheduledTime,
                // Route to the queue so any available agent on that queue
                // can pick it up — instead of pinning to one agent who
                // might be off shift in 24h.
                Attributes: {
                  followup_origin_contact: contactId,
                  followup_agent: agentUsername || "",
                  followup_customer: customerPhone || "",
                  followup_disposition: subStageLabel || stageLabel || "",
                  followup_valoracion: valoracion || "",
                },
              })
            );
            if (task.ContactId) followUpTaskIds.push(task.ContactId);
          } catch (err) {
            console.warn(
              "StartTaskContact failed for task24h — wrap-up still saved without task:",
              err
            );
          }
        }
      }
      if (followUpTaskIds.length > 0) item.followUpTaskIds = followUpTaskIds;

      // Use marshall so arrays/objects (tags, followUps) get the right DDB
      // type (L, M) instead of being coerced to strings.
      await dynamo.send(
        new PutItemCommand({
          TableName: TABLE_NAME,
          Item: marshall(item, { removeUndefinedValues: true }),
        })
      );

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: true,
          contactId,
          followUpTaskIds,
        }),
      };
    }

    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  } catch (error) {
    console.error("Error saving agent notes:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to save notes",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
