import { defineFunction } from "@aws-amplify/backend";

export const generateCallSummary = defineFunction({
  name: "generate-call-summary",
  resourceGroupName: "data",
  timeoutSeconds: 30,
});
