import type { Handler } from "aws-lambda";
import {
  QConnectClient,
  QueryAssistantCommand,
} from "@aws-sdk/client-qconnect";

const client = new QConnectClient({});
const ASSISTANT_ID = process.env.Q_ASSISTANT_ID || "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const params = event.queryStringParameters || {};
  const query = params.query;

  if (!query) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "query parameter required" }),
    };
  }

  if (!ASSISTANT_ID) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        results: [],
        message: "Q Assistant ID not configured",
      }),
    };
  }

  try {
    const result = await client.send(
      new QueryAssistantCommand({
        assistantId: ASSISTANT_ID,
        queryText: query,
        maxResults: 5,
      })
    );

    const suggestions = (result.results || []).map((r) => ({
      id: r.resultId,
      type: r.type,
      title: r.document?.title?.text || "",
      excerpts: r.document?.excerpt?.text ? [r.document.excerpt.text] : [],
      url: r.document?.contentReference?.sourceURL,
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        results: suggestions,
      }),
    };
  } catch (error) {
    console.error("Error querying Q:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to query Q",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
