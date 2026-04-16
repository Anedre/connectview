import { defineFunction } from "@aws-amplify/backend";

export const lookupCustomerProfile = defineFunction({
  name: "lookup-customer-profile",
  resourceGroupName: "data",
  timeoutSeconds: 10,
});
