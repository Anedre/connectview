import { defineFunction } from "@aws-amplify/backend";

export const queryContacts = defineFunction({
  name: "query-contacts",
  timeoutSeconds: 15,
});
