import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  DescribeContactCommand,
} from "@aws-sdk/client-connect";
import {
  DynamoDBClient,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

const connect = new ConnectClient({});
const dynamo = new DynamoDBClient({});
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "";

interface EnrichEvent {
  contactId: string;
  instanceId: string;
}

export const handler: Handler<EnrichEvent> = async (event) => {
  const { contactId, instanceId } = event;

  try {
    // Wait for Contact Lens analysis to be available
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Get contact description for duration
    const contactDesc = await connect.send(
      new DescribeContactCommand({
        InstanceId: instanceId,
        ContactId: contactId,
      })
    );

    const contact = contactDesc.Contact;
    const duration =
      contact?.DisconnectTimestamp && contact?.InitiationTimestamp
        ? Math.round(
            (contact.DisconnectTimestamp.getTime() -
              contact.InitiationTimestamp.getTime()) /
              1000
          )
        : 0;

    // Contact Lens sentiment is available via DescribeContact when enabled
    // For detailed analytics, the data is written to S3 by Contact Lens automatically
    const sentiment = "UNKNOWN";

    // Update DynamoDB with enriched data
    await dynamo.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: {
          contactId: { S: contactId },
        },
        UpdateExpression:
          "SET #dur = :dur, sentiment = :sent",
        ExpressionAttributeNames: {
          "#dur": "duration",
        },
        ExpressionAttributeValues: {
          ":dur": { N: String(duration) },
          ":sent": { S: sentiment },
        },
      })
    );
  } catch (error) {
    console.error("Error enriching contact:", error);
    throw error;
  }
};
