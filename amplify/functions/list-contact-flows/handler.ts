import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  ListContactFlowsCommand,
} from "@aws-sdk/client-connect";

const connect = new ConnectClient({ maxAttempts: 1 });
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    const params = event.queryStringParameters || {};
    // Filter by type (default CONTACT_FLOW which includes outbound-capable flows)
    const types = (params.types || "CONTACT_FLOW").split(",");

    const flows: Array<{ id: string; name: string; type: string; state: string }> = [];
    let nextToken: string | undefined;
    do {
      const res = await connect.send(
        new ListContactFlowsCommand({
          InstanceId: INSTANCE_ID,
          ContactFlowTypes: types as never,
          NextToken: nextToken,
          MaxResults: 100,
        })
      );
      for (const f of res.ContactFlowSummaryList || []) {
        if (f.ContactFlowState !== "ACTIVE") continue;
        flows.push({
          id: f.Id || "",
          name: f.Name || "",
          type: f.ContactFlowType || "",
          state: f.ContactFlowState || "",
        });
      }
      nextToken = res.NextToken;
    } while (nextToken);

    flows.sort((a, b) => a.name.localeCompare(b.name));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flows, total: flows.length }),
    };
  } catch (err) {
    console.error("list-contact-flows error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to list contact flows",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
