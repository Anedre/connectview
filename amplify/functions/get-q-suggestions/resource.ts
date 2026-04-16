import { defineFunction } from "@aws-amplify/backend";

export const getQSuggestions = defineFunction({
  name: "get-q-suggestions",
  timeoutSeconds: 15,
});
