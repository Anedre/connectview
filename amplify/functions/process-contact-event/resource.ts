import { defineFunction } from "@aws-amplify/backend";

export const processContactEvent = defineFunction({
  name: "process-contact-event",
  timeoutSeconds: 30,
});
