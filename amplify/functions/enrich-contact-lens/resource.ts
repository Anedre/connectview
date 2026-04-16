import { defineFunction } from "@aws-amplify/backend";

export const enrichContactLens = defineFunction({
  name: "enrich-contact-lens",
  resourceGroupName: "data",
  timeoutSeconds: 60,
});
