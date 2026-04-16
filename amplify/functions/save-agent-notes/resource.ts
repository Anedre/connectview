import { defineFunction } from "@aws-amplify/backend";

export const saveAgentNotes = defineFunction({
  name: "save-agent-notes",
  resourceGroupName: "data",
  timeoutSeconds: 10,
});
