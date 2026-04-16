import type { EventBridgeHandler } from "aws-lambda";
import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

const dynamo = new DynamoDBClient({});
const lambda = new LambdaClient({});
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "";
const ENRICH_FUNCTION_NAME = process.env.ENRICH_FUNCTION_NAME || "";

interface ConnectContactEvent {
  detail: {
    contactId: string;
    channel: string;
    instanceArn: string;
    initiationMethod: string;
    eventType: string;
    agentInfo?: {
      agentArn: string;
    };
    queueInfo?: {
      queueArn: string;
    };
    initiationTimestamp?: string;
    disconnectTimestamp?: string;
    disconnectReason?: string;
  };
}

export const handler: EventBridgeHandler<
  "Amazon Connect Contact Event",
  ConnectContactEvent["detail"],
  void
> = async (event) => {
  const detail = event.detail;
  const contactId = detail.contactId;
  const eventType = detail.eventType;

  try {
    if (eventType === "INITIATED" || eventType === "CONNECTED_TO_AGENT") {
      const agentName = detail.agentInfo?.agentArn?.split("/").pop() || "";
      const queueName = detail.queueInfo?.queueArn?.split("/").pop() || "";

      await dynamo.send(
        new PutItemCommand({
          TableName: TABLE_NAME,
          Item: {
            contactId: { S: contactId },
            initiationTimestamp: {
              S: detail.initiationTimestamp || new Date().toISOString(),
            },
            channel: { S: detail.channel || "VOICE" },
            agentUsername: { S: agentName },
            queueName: { S: queueName },
            initiationMethod: { S: detail.initiationMethod || "" },
            status: { S: "ACTIVE" },
          },
          ConditionExpression: "attribute_not_exists(contactId)",
        })
      );
    } else if (eventType === "DISCONNECTED" || eventType === "CONTACT_END") {
      // Update the contact with disconnect info
      await dynamo.send(
        new UpdateItemCommand({
          TableName: TABLE_NAME,
          Key: {
            contactId: { S: contactId },
          },
          UpdateExpression:
            "SET #status = :status, disconnectTimestamp = :dt, disconnectReason = :dr",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":status": { S: "COMPLETED" },
            ":dt": {
              S: detail.disconnectTimestamp || new Date().toISOString(),
            },
            ":dr": { S: detail.disconnectReason || "UNKNOWN" },
          },
        })
      );

      // Trigger Contact Lens enrichment asynchronously
      if (ENRICH_FUNCTION_NAME) {
        await lambda.send(
          new InvokeCommand({
            FunctionName: ENRICH_FUNCTION_NAME,
            InvocationType: "Event", // async
            Payload: Buffer.from(
              JSON.stringify({
                contactId,
                instanceId: detail.instanceArn?.split("/").pop() || "",
              })
            ),
          })
        );
      }
    }
  } catch (error) {
    // Ignore ConditionalCheckFailedException (duplicate events)
    if (
      error instanceof Error &&
      error.name === "ConditionalCheckFailedException"
    ) {
      return;
    }
    console.error("Error processing contact event:", error);
    throw error;
  }
};
