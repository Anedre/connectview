import { defineFunction } from "@aws-amplify/backend";

/**
 * get-customer-thread
 *
 * Returns a single merged WhatsApp-style timeline of every chat message the
 * customer ever exchanged with us — across every CHAT contact session. The
 * frontend renders this as one continuous thread (instead of N separate
 * conversations). Also returns session metadata so the UI can draw
 * "── conversación cerrada · 3 días después ──" separators between contactIds
 * and a daysWithActivity histogram for the calendar picker that marks days
 * with messages.
 */
export const getCustomerThread = defineFunction({
  name: "get-customer-thread",
  resourceGroupName: "data",
  timeoutSeconds: 30,
  memoryMB: 512,
});
