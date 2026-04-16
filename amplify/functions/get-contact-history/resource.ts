import { defineFunction } from "@aws-amplify/backend";

export const getContactHistory = defineFunction({
  name: "get-contact-history",
  resourceGroupName: "data",
  timeoutSeconds: 15,
});
