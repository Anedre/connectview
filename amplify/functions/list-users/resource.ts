import { defineFunction } from "@aws-amplify/backend";

export const listUsers = defineFunction({
  name: "list-users",
  resourceGroupName: "auth",
  timeoutSeconds: 15,
});
