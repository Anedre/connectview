import "amazon-connect-streams";

// Embed the full Agent Workspace (CCP + Customer Profiles + Cases + Wisdom)
// instead of just the CCP. The Agent Workspace URL is /connect/agent-app-v2
// and includes additional apps that integrate automatically when they are
// associated with the instance (in our case: Cases, Wisdom, Customer Profiles).
export function initCCP(containerEl: HTMLElement, instanceUrl: string) {
  connect.core.initCCP(containerEl, {
    ccpUrl: `${instanceUrl}/connect/ccp-v2`,
    loginPopup: true,
    loginPopupAutoClose: true,
    loginUrl: `${instanceUrl}/connect/login`,
    softphone: {
      allowFramedSoftphone: true,
      disableRingtone: false,
    },
    pageOptions: {
      enableAudioDeviceSettings: true,
      enablePhoneTypeSettings: true,
    },
    // Enable the Agent Workspace apps (Customer Profiles, Cases, Wisdom)
    // These apps need to be pre-associated with the Connect instance (they are in our case)
    ccpAckTimeout: 5000,
    ccpSynTimeout: 3000,
    ccpLoadTimeout: 10000,
  });
}

// Initialize the full Agent App (Agent Workspace) as a separate iframe.
// This shows the left-panel CCP alongside Customer Profiles, Cases, Wisdom in tabs.
export function getAgentAppUrl(instanceUrl: string): string {
  return `${instanceUrl}/connect/agent-app-v2`;
}

export function terminateCCP() {
  try {
    connect.core.terminate();
  } catch {
    // CCP may not be initialized
  }
}
