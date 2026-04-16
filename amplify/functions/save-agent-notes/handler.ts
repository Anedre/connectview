import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const dynamo = new DynamoDBClient({});
const TABLE_NAME = process.env.CONTACTS_TABLE_NAME || "connectview-contacts";

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
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          notes: item?.agentNotes || "",
          wrapUpCode: item?.wrapUpCode || "",
          summary: item?.summary || "",
        }),
      };
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { contactId, notes, wrapUpCode, summary, agentUsername } = body;

      if (!contactId) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "contactId required" }),
        };
      }

      // Build item - only include fields that were provided
      const item: Record<string, { S: string }> = {
        contactId: { S: contactId },
        updatedAt: { S: new Date().toISOString() },
      };
      if (notes !== undefined) item.agentNotes = { S: notes };
      if (wrapUpCode !== undefined) item.wrapUpCode = { S: wrapUpCode };
      if (summary !== undefined) item.summary = { S: summary };
      if (agentUsername !== undefined) item.agentUsername = { S: agentUsername };

      await dynamo.send(
        new PutItemCommand({
          TableName: TABLE_NAME,
          Item: item,
        })
      );

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: true, contactId }),
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
