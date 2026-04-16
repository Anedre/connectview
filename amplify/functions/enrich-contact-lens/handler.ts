import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  ListContactAnalyticsSummariesCommand,
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
    // Wait a bit for Contact Lens analysis to be available
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

    // Try to get Contact Lens analysis
    let sentiment = "UNKNOWN";
    let sentimentScore = {};
    let categories: string[] = [];

    try {
      const analysisResponse = await connect.send(
        new ListContactAnalyticsSummariesCommand({
          InstanceId: instanceId,
          Filters: {
            ContactIds: [contactId],
          },
        })
      );

      const analysis = analysisResponse.AnalyticsSummaries?.[0];
      if (analysis) {
        sentiment =
          analysis.OverallSentiment?.OverallSentiment || "UNKNOWN";
        sentimentScore = {
          overall:
            analysis.OverallSentiment?.OverallSentiment || "UNKNOWN",
        };
        categories =
          analysis.MatchedCategories?.map((c) => c.CategoryName || "") || [];
      }
    } catch {
      // Contact Lens may not be available for all contacts
      console.log(
        `Contact Lens analysis not available for contact ${contactId}`
      );
    }

    // Update DynamoDB with enriched data
    await dynamo.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: {
          contactId: { S: contactId },
        },
        UpdateExpression:
          "SET #dur = :dur, sentiment = :sent, sentimentScore = :score, categories = :cats",
        ExpressionAttributeNames: {
          "#dur": "duration",
        },
        ExpressionAttributeValues: {
          ":dur": { N: String(duration) },
          ":sent": { S: sentiment },
          ":score": { S: JSON.stringify(sentimentScore) },
          ":cats": { L: categories.map((c) => ({ S: c })) },
        },
      })
    );
  } catch (error) {
    console.error("Error enriching contact:", error);
    throw error;
  }
};
