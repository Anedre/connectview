import { defineFunction } from "@aws-amplify/backend";

export const getLiveTranscript = defineFunction({
  name: "get-live-transcript",
  timeoutSeconds: 10,
});
