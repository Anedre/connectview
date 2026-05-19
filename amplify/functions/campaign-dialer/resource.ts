import { defineFunction } from "@aws-amplify/backend";

/**
 * campaign-dialer
 *
 * Background Lambda that wakes up periodically (EventBridge schedule) and
 * pumps the outbound dialer for every RUNNING campaign:
 *   - Reads the campaigns table for RUNNING rows.
 *   - For each, checks the calling window + concurrency budget, finds
 *     pending contacts, and fires `StartOutboundVoiceContact`.
 *   - Bucket-mode (default) targets pre-assigned agents; legacy mode
 *     uses the agentless / generic-pool path.
 *
 * 60s timeout is the EventBridge rate budget — we'd rather have the
 * Lambda time out and retry next tick than back up multiple invocations.
 */
export const campaignDialer = defineFunction({
  name: "campaign-dialer",
  resourceGroupName: "data",
  timeoutSeconds: 60,
  memoryMB: 512,
});
