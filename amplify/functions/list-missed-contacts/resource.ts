import { defineFunction } from "@aws-amplify/backend";

export const listMissedContacts = defineFunction({
  name: "list-missed-contacts",
  resourceGroupName: "data",
  timeoutSeconds: 15,
});
