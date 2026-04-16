import { defineFunction } from "@aws-amplify/backend";

export const queryContacts = defineFunction({
  name: "query-contacts",
  resourceGroupName: "data",
  timeoutSeconds: 15,
});
