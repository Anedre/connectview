import { defineFunction } from "@aws-amplify/backend";

/**
 * get-customer-attachments
 *
 * Returns every file ever exchanged with the customer across ALL contact
 * sessions and ALL channels (voice has none; chat/whatsapp has inline media
 * + ListContactReferences ATTACHMENTs; email has both inbound attachments
 * and outbound files). The frontend renders this as a single grid in the
 * /recordings page — the "Archivos compartidos" tab.
 */
export const getCustomerAttachments = defineFunction({
  name: "get-customer-attachments",
  resourceGroupName: "data",
  timeoutSeconds: 30,
  memoryMB: 512,
});
