import type { Handler } from "aws-lambda";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID || "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  // Support both API Gateway v1 (httpMethod) and Function URL v2 (requestContext.http.method)
  const method = event.httpMethod || event.requestContext?.http?.method || "GET";

  try {
    if (method === "GET") {
      // List all users with their groups
      const usersResponse = await client.send(
        new ListUsersCommand({
          UserPoolId: USER_POOL_ID,
          Limit: 60,
        })
      );

      const users = await Promise.all(
        (usersResponse.Users || []).map(async (user) => {
          const groupsResponse = await client.send(
            new AdminListGroupsForUserCommand({
              UserPoolId: USER_POOL_ID,
              Username: user.Username!,
            })
          );

          const email =
            user.Attributes?.find((a) => a.Name === "email")?.Value || "";

          return {
            username: user.Username,
            email,
            status: user.UserStatus,
            enabled: user.Enabled,
            created: user.UserCreateDate?.toISOString(),
            groups:
              groupsResponse.Groups?.map((g) => g.GroupName || "") || [],
          };
        })
      );

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users }),
      };
    }

    if (method === "POST") {
      // Change user group
      const body = JSON.parse(event.body || "{}");
      const { username, addGroup, removeGroup } = body;

      if (!username) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "username is required" }),
        };
      }

      if (removeGroup) {
        await client.send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: USER_POOL_ID,
            Username: username,
            GroupName: removeGroup,
          })
        );
      }

      if (addGroup) {
        await client.send(
          new AdminAddUserToGroupCommand({
            UserPoolId: USER_POOL_ID,
            Username: username,
            GroupName: addGroup,
          })
        );
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: true }),
      };
    }

    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  } catch (error) {
    console.error("Error managing users:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to manage users",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
