import { defineFunction } from "@aws-amplify/backend";

export const enrichContactLens = defineFunction({
  name: "enrich-contact-lens",
  timeoutSeconds: 60,
});
