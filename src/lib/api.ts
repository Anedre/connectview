import outputs from "../../amplify_outputs.json";

interface ApiEndpoints {
  realtimeMetrics: string;
  queryContacts: string;
  getRecording: string;
  listUsers: string;
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
