import { defineFunction } from "@aws-amplify/backend";

export const getRecording = defineFunction({
  name: "get-recording",
  timeoutSeconds: 15,
});
