import { defineFunction } from "@aws-amplify/backend";

export const getContactDetail = defineFunction({
  name: "get-contact-detail",
  timeoutSeconds: 20,
});
