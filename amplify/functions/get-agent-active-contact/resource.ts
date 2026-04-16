import { defineFunction } from "@aws-amplify/backend";

export const getAgentActiveContact = defineFunction({
  name: "get-agent-active-contact",
  resourceGroupName: "auth",
  timeoutSeconds: 10,
});
