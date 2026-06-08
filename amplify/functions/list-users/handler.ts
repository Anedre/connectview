import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  ListUsersCommand,
  DescribeUserCommand,
  DescribeSecurityProfileCommand,
} from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";

const legacyClient = new ConnectClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";

// Cache de nombres de perfil — keyed por instancia+perfil para no mezclar tenants.
const profileNameCache = new Map<string, string>();

async function getProfileName(
  profileId: string,
  client: ConnectClient,
  instanceId: string
): Promise<string> {
  const key = `${instanceId}:${profileId}`;
  if (profileNameCache.has(key)) return profileNameCache.get(key)!;
  try {
    const res = await client.send(
      new DescribeSecurityProfileCommand({
        InstanceId: instanceId,
        SecurityProfileId: profileId,
      })
    );
    const name = res.SecurityProfile?.SecurityProfileName || profileId;
    profileNameCache.set(key, name);
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
      // Connect del tenant (o legacy de Vox si no está configurado / sin token).
      const { client, instanceId } = await resolveConnect(event?.headers, legacyClient, INSTANCE_ID);
      const summariesRes = await client.send(
        new ListUsersCommand({
          InstanceId: instanceId,
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
                InstanceId: instanceId,
                UserId: summary.Id!,
              })
            );

            const user = userRes.User;
            const profileIds = user?.SecurityProfileIds || [];
            const profileNames = await Promise.all(
              profileIds.map((id) => getProfileName(id, client, instanceId))
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
