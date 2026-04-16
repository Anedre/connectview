import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  DescribeContactCommand,
  GetCurrentUserDataCommand,
  ListUsersCommand,
} from "@aws-sdk/client-connect";

const client = new ConnectClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

// Enrich missing CustomerEndpoint via DescribeContact — GetCurrentUserData doesn't always
// populate the customer endpoint while the call is still in early CONNECTING state.
async function describeContactSafe(contactId: string): Promise<{
  customerPhone: string | null;
  customerEndpointType: string | null;
} | null> {
  try {
    const res = await client.send(
      new DescribeContactCommand({
        InstanceId: INSTANCE_ID,
        ContactId: contactId,
      })
    );
    const ep = res.Contact?.CustomerEndpoint;
    return {
      customerPhone: ep?.Address || null,
      customerEndpointType: ep?.Type || null,
    };
  } catch (err) {
    console.error("DescribeContact fallback failed:", err);
    return null;
  }
}

// Cache username -> userId lookups
const userIdCache = new Map<string, string>();

async function resolveUserId(username: string): Promise<string | null> {
  if (userIdCache.has(username)) return userIdCache.get(username)!;
  try {
    let nextToken: string | undefined;
    do {
      const res = await client.send(
        new ListUsersCommand({
          InstanceId: INSTANCE_ID,
          MaxResults: 100,
          NextToken: nextToken,
        })
      );
      for (const u of res.UserSummaryList || []) {
        if (u.Username && u.Id) {
          userIdCache.set(u.Username, u.Id);
        }
      }
      nextToken = res.NextToken;
      if (userIdCache.has(username)) return userIdCache.get(username)!;
    } while (nextToken);
    return null;
  } catch (err) {
    console.error("Failed to resolve userId:", err);
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    const params = event.queryStringParameters || {};
    const username = params.username as string | undefined;
    const userId = params.userId as string | undefined;

    if (!username && !userId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "username or userId required" }),
      };
    }

    let resolvedUserId = userId;
    if (!resolvedUserId && username) {
      resolvedUserId = (await resolveUserId(username)) || undefined;
      if (!resolvedUserId) {
        return {
          statusCode: 404,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contact: null,
            reason: "user-not-found",
            username,
          }),
        };
      }
    }

    const res = await client.send(
      new GetCurrentUserDataCommand({
        InstanceId: INSTANCE_ID,
        Filters: {
          Agents: [resolvedUserId!],
        },
      })
    );

    const userData = res.UserDataList?.[0];
    const contacts = userData?.Contacts || [];

    if (contacts.length === 0) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: null,
          agentStatus: userData?.Status?.StatusName || null,
        }),
      };
    }

    // Prefer the most recent ACTIVE contact (CONNECTED, INCOMING, CONNECTING)
    const active = contacts.find((c) =>
      ["CONNECTED", "INCOMING", "CONNECTING", "ON_HOLD"].includes(
        c.ContactState || ""
      )
    ) || contacts[0];

    let customerPhone = active.CustomerEndpoint?.Address || null;
    let customerEndpointType = active.CustomerEndpoint?.Type || null;

    // Fallback: GetCurrentUserData often returns null CustomerEndpoint —
    // ask DescribeContact for the real endpoint.
    if (!customerPhone && active.ContactId) {
      const enriched = await describeContactSafe(active.ContactId);
      if (enriched) {
        customerPhone = enriched.customerPhone;
        customerEndpointType = enriched.customerEndpointType;
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact: {
          contactId: active.ContactId,
          channel: active.Channel,
          state: active.ContactState,
          initiationMethod: active.InitiationMethod,
          stateStartTimestamp: active.StateStartTimestamp,
          connectedToAgentTimestamp: active.ConnectedToAgentTimestamp,
          queueName: active.Queue?.Name || null,
          queueArn: active.Queue?.Arn || null,
          customerPhone,
          customerEndpointType,
        },
        agentStatus: userData?.Status?.StatusName || null,
      }),
    };
  } catch (error) {
    console.error("Error getting agent active contact:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to get active contact",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
