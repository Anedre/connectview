import outputs from "../../amplify_outputs.json";

interface ApiEndpoints {
  realtimeMetrics: string;
  queryContacts: string;
  getRecording: string;
  listUsers: string;
  lookupCustomerProfile: string;
  getLiveTranscript: string;
  getContactHistory: string;
  /** Optional — only present after deploying the list-missed-contacts
   *  Lambda. Used by the "Perdidas" drawer in the agent desktop. */
  listMissedContacts?: string;
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
  // Campaign edit/clone/relaunch
  updateCampaign?: string;
  relaunchCampaign?: string;
  cloneCampaign?: string;
  editCampaignContacts?: string;
  listQueues?: string;
  assignCampaignAgents?: string;
  getCampaignAgents?: string;
  getFlowQueues?: string;
  // Outbound creation (task + email) — single Lambda dispatches by `type`.
  startOutboundContact?: string;
  // Lists the Connect-registered email "From" addresses for the New
  // Email composer's dropdown.
  listEmailAddresses?: string;
  // Idle Cliente 360° browser: search profiles by phone/email/name and
  // update editable fields. Same DynamoDB-audited admin-action style as
  // the rest of the privileged Lambdas.
  searchCustomerProfiles?: string;
  updateCustomerProfile?: string;
  // Lists recently-contacted customers (deduplicated by phone) for the
  // agent who's currently signed in. Powers the "Atendidos
  // recientemente" list in the idle Cliente 360° browser.
  listRecentCustomers?: string;
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
