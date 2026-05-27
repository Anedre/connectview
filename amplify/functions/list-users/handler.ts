import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  ListUsersCommand,
  DescribeUserCommand,
  DescribeSecurityProfileCommand,
} from "@aws-sdk/client-connect";

const client = new ConnectClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

// Cache security profile names to avoid repeated lookups
const profileNameCache = new Map<string, string>();

async function getProfileName(profileId: string): Promise<string> {
  if (profileNameCache.has(profileId)) return profileNameCache.get(profileId)!;
  try {
    const res = await client.send(
      new DescribeSecurityProfileCommand({
        InstanceId: INSTANCE_ID,
        SecurityProfileId: profileId,
      })
    );
    const name = res.SecurityProfile?.SecurityProfileName || profileId;
    profileNameCache.set(profileId, name);
    return name;
  } catch {
    return profileId;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.httpMethod || event.requestContext?.http?.method || "GET";

  try {
    if (method === "GET") {
      const summariesRes = await client.send(
        new ListUsersCommand({
          InstanceId: INSTANCE_ID,
          MaxResults: 100,
        })
      );

      const summaries = summariesRes.UserSummaryList || [];

      // Fetch full details for each user in parallel
      const users = await Promise.all(
        summaries.map(async (summary) => {
          try {
            const userRes = await client.send(
              new DescribeUserCommand({
                InstanceId: INSTANCE_ID,
                UserId: summary.Id!,
              })
            );

            const user = userRes.User;
            const profileIds = user?.SecurityProfileIds || [];
            const profileNames = await Promise.all(
              profileIds.map((id) => getProfileName(id))
            );

            return {
              // Bug #9 — expose the Connect userId so the frontend can
              // resolve the agentARN UUID returned by getContact /
              // queryContacts to a real username.
              userId: summary.Id || "",
              username: summary.Username || "",
              email: user?.IdentityInfo?.Email || "",
              firstName: user?.IdentityInfo?.FirstName || "",
              lastName: user?.IdentityInfo?.LastName || "",
              status: "CONFIRMED",
              enabled: true,
              created: "",
              groups: profileNames,
            };
          } catch {
            return {
              userId: summary.Id || "",
              username: summary.Username || "",
              email: "",
              firstName: "",
              lastName: "",
              status: "UNKNOWN",
              enabled: true,
              created: "",
              groups: [],
            };
          }
        })
      );

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users }),
      };
    }

    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  } catch (error) {
    console.error("Error listing Connect users:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to list users",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
