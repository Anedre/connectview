import type { PostConfirmationTriggerHandler } from "aws-lambda";
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient();

export const handler: PostConfirmationTriggerHandler = async (event) => {
  const command = new AdminAddUserToGroupCommand({
    GroupName: "Agents",
    UserPoolId: event.userPoolId,
    Username: event.userName,
  });

  await client.send(command);
  return event;
};
