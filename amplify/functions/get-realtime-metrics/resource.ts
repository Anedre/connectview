import { defineFunction } from "@aws-amplify/backend";

export const getRealtimeMetrics = defineFunction({
  name: "get-realtime-metrics",
  timeoutSeconds: 15,
});
