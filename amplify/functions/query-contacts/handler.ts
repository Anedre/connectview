import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  DynamoDBClient,
  ScanCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const dynamo = new DynamoDBClient({});
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "";

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const {
      startDate,
      endDate,
      agentUsername,
      queueName,
      sentiment,
      limit = "50",
    } = params;

    let items;

    if (agentUsername) {
      // Query by agent using GSI
      const result = await dynamo.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: "agentUsername-initiationTimestamp-index",
          KeyConditionExpression:
            "agentUsername = :agent" +
            (startDate && endDate
              ? " AND initiationTimestamp BETWEEN :start AND :end"
              : ""),
          ExpressionAttributeValues: {
            ":agent": { S: agentUsername },
            ...(startDate && endDate
              ? {
                  ":start": { S: startDate },
                  ":end": { S: endDate },
                }
              : {}),
          },
          ScanIndexForward: false,
          Limit: parseInt(limit),
        })
      );
      items = result.Items || [];
    } else if (queueName) {
      // Query by queue using GSI
      const result = await dynamo.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: "queueName-initiationTimestamp-index",
          KeyConditionExpression:
            "queueName = :queue" +
            (startDate && endDate
              ? " AND initiationTimestamp BETWEEN :start AND :end"
              : ""),
          ExpressionAttributeValues: {
            ":queue": { S: queueName },
            ...(startDate && endDate
              ? {
                  ":start": { S: startDate },
                  ":end": { S: endDate },
                }
              : {}),
          },
          ScanIndexForward: false,
          Limit: parseInt(limit),
        })
      );
      items = result.Items || [];
    } else {
      // Scan with filters (less efficient but flexible)
      const filterExpressions: string[] = [];
      const expressionValues: Record<string, { S: string }> = {};

      if (startDate && endDate) {
        filterExpressions.push(
          "initiationTimestamp BETWEEN :start AND :end"
        );
        expressionValues[":start"] = { S: startDate };
        expressionValues[":end"] = { S: endDate };
      }
      if (sentiment) {
        filterExpressions.push("sentiment = :sentiment");
        expressionValues[":sentiment"] = { S: sentiment };
      }

      const result = await dynamo.send(
        new ScanCommand({
          TableName: TABLE_NAME,
          ...(filterExpressions.length > 0
            ? {
                FilterExpression: filterExpressions.join(" AND "),
                ExpressionAttributeValues: expressionValues,
              }
            : {}),
          Limit: parseInt(limit),
        })
      );
      items = result.Items || [];
    }

    const contacts = items.map((item) => unmarshall(item));

    // Sort by timestamp descending
    contacts.sort(
      (a, b) =>
        new Date(b.initiationTimestamp).getTime() -
        new Date(a.initiationTimestamp).getTime()
    );

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
              },
      body: JSON.stringify({
        contacts,
        count: contacts.length,
      }),
    };
  } catch (error) {
    console.error("Error querying contacts:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
              },
      body: JSON.stringify({
        error: "Failed to query contacts",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
