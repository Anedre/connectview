import outputs from "../../amplify_outputs.json";

interface ApiEndpoints {
  realtimeMetrics: string;
  queryContacts: string;
  getRecording: string;
  listUsers: string;
  lookupCustomerProfile: string;
  getLiveTranscript: string;
  getContactHistory: string;
  saveAgentNotes: string;
  generateCallSummary: string;
  getQSuggestions: string;
  getAgentActiveContact: string;
  getAgentLeaderboard?: string;
  getAgentWellness?: string;
  getChurnRisk?: string;
  // Campaign endpoints
  listContactFlows?: string;
  listSourcePhones?: string;
  createCampaign?: string;
  listCampaigns?: string;
  getCampaignStats?: string;
  getCampaignContacts?: string;
  controlCampaign?: string;
  // Queue manager / admin endpoints
  getLiveQueue?: string;
  adminTransferContact?: string;
  adminStopContact?: string;
  adminChangeAgentStatus?: string;
  adminMonitorContact?: string;
  adminUpdateContactAttrs?: string;
  adminListAudit?: string;
}

let endpoints: ApiEndpoints | null = null;

export function getApiEndpoints(): ApiEndpoints | null {
  if (endpoints) return endpoints;

  try {
    const custom = (outputs as Record<string, unknown>).custom as
      | Record<string, string>
      | undefined;
    if (custom?.apiEndpoints) {
      endpoints = JSON.parse(custom.apiEndpoints);
      return endpoints;
    }
  } catch {
    // Endpoints not configured yet
  }
  return null;
}
