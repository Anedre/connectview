/**
 * connectors — API pública del Connector Framework (C0).
 * Ver design/connector-framework.md.
 */
export * from "./types";
export { makeRestClient, type RestClientOpts } from "./restClient";
export { readConnectorSecret, connectorSecretName } from "./tokens";
export { loadConnectorMapping, resetConnectorMappingCache } from "./fieldMapping";
export { salesforceConnector } from "./salesforce";
export {
  CRM_CONNECTORS,
  enabledConnectors,
  buildCtx,
  resetConnectorRegistryCache,
} from "./registry";
