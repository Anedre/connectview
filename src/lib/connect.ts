import "amazon-connect-streams";

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
    ccpAckTimeout: 5000,
    ccpSynTimeout: 3000,
    ccpLoadTimeout: 10000,
  });
}

export function terminateCCP() {
  try {
    connect.core.terminate();
  } catch {
    // CCP may not be initialized
  }
}
