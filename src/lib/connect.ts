import "amazon-connect-streams";
// chatjs piggybacks on streams and exposes connect.ChatSession + chat
// media controllers. Importing it here makes the global available
// everywhere the streams namespace is used.
import "amazon-connect-chatjs";

// Tell chatjs which region to target for the Connect Participant API.
// Without this, the SDK defaults to us-west-2 and every GetTranscript
// / SendMessage / SendEvent call against a contact from our us-east-1
// instance returns 403 Forbidden (the participant token is region-scoped).
//
// We use both setGlobalConfig AND a .create() monkey-patch because the
// Connect Streams library bundled with us-west-2 default invokes
// ChatSession.create() without forwarding the global config — so options
// have to be injected at call time.
const CONNECT_REGION = import.meta.env.VITE_AWS_REGION || "us-east-1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function patchChatJsRegion(CS: any): boolean {
  if (!CS) return false;
  try {
    if (CS.setGlobalConfig) {
      CS.setGlobalConfig({
        region: CONNECT_REGION,
        loggerConfig: {
          useDefaultLogger: true,
          level: CS.LogLevel?.INFO ?? "INFO",
        },
      });
    }
    if (CS.create && !CS.__voxRegionPatched) {
      const original = CS.create.bind(CS);
      // chatjs internally resolves region via:
      //   L.getRegionOverride() || e.region || L.getRegion() || "us-west-2"
      // where `e` is the create() argument. So we inject region at BOTH
      // the root level (where chatjs reads it) and in options (to be
      // future-proof against API shape changes).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      CS.create = (input: any) => {
        const patched = {
          ...(input || {}),
          region: CONNECT_REGION,
          options: {
            region: CONNECT_REGION,
            ...((input && input.options) || {}),
          },
        };
        return original(patched);
      };
      CS.__voxRegionPatched = true;
    }
    // Also patch the global LOG.getRegion / regionOverride fallback by
    // setting `connect.ChatSession.GlobalConfig` directly. Some versions
    // of chatjs respect this even if setGlobalConfig didn't propagate.
    if (CS.GlobalConfig) {
      try {
        CS.GlobalConfig.region = CONNECT_REGION;
        CS.GlobalConfig.regionOverride = CONNECT_REGION;
      } catch {
        /* readonly — skip */
      }
    }
    return true;
  } catch {
    return false;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
patchChatJsRegion((connect as any).ChatSession);

/** Opciones extra de `initCCP`. `federationSignInUrl` se obtiene del Lambda
 *  `get-federation-token` y, si está presente, reemplaza el loginUrl normal
 *  + apaga el popup → el iframe se autentica solo (silent SSO). Si está
 *  ausente, caemos al popup login clásico (Connect-hosted credentials). */
export interface InitCCPOptions {
  federationSignInUrl?: string;
}

// Embed the full Agent Workspace (CCP + Customer Profiles + Cases + Wisdom)
// instead of just the CCP. The Agent Workspace URL is /connect/agent-app-v2
// and includes additional apps that integrate automatically when they are
// associated with the instance (in our case: Cases, Wisdom, Customer Profiles).
export function initCCP(
  containerEl: HTMLElement,
  instanceUrl: string,
  opts: InitCCPOptions = {}
) {
  // Re-apply chatjs region on every CCP init. Idempotent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patchChatJsRegion((connect as any).ChatSession);

  const useFederation = !!opts.federationSignInUrl;

  connect.core.initCCP(containerEl, {
    ccpUrl: `${instanceUrl}/connect/ccp-v2`,
    // Top-level region. Streams' MediaFactory grabs params.region for chat
    // sessions; without it streams defaults to 'us-west-2' and every chat
    // API call 403s on our us-east-1 instance.
    region: CONNECT_REGION,
    // Federación: el iframe abre el signInUrl (auth silencioso vía SAML del
    // tenant) → setea cookie → redirige al CCP. Sin popup.
    // SIN federación: NO auto-abrimos el popup de login. Era molesto (saltaba
    // solo al cargar) y lo bloquean los popup-blockers. El agente/admin decide
    // CUÁNDO loguearse con el botón del SoftphoneBanner ("Iniciar sesión en
    // Connect"), que abre el CCP en una pestaña. Por eso loginPopup=false.
    loginPopup: false,
    loginPopupAutoClose: false,
    loginUrl: useFederation
      ? opts.federationSignInUrl!
      : `${instanceUrl}/connect/login`,
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
    // Same goes for the chat config — be explicit so streams doesn't
    // pull defaults from us-west-2.
    chat: {
      region: CONNECT_REGION,
    },
  } as Parameters<typeof connect.core.initCCP>[1] & {
    region?: string;
    chat?: { region?: string };
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
