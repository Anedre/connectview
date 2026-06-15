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
  /** Se invoca cuando el CCP pierde la auth (token expiró y el refresh silencioso
   *  no pudo renovarlo). El consumidor (ConnectAuthContext) lo usa para marcar el
   *  softphone como caído y ofrecer reconexión limpia en vez de morir en silencio. */
  onAuthFail?: () => void;
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
    // Persistencia de sesión (#login): `loginPopup=true` es la pieza CLAVE para
    // que el agente se loguee ~1 vez al día y NO cada 15-30 min. Cuando el access
    // token del CCP expira (~15-30 min) y el refresh silencioso del iframe falla
    // —típico en el embed por cookies de 3ra parte / SameSite—, Streams reabre el
    // login en un POPUP. El popup corre en contexto de PRIMERA parte sobre el
    // dominio de Connect, así que SÍ ve la cookie de sesión SSO (viva ~la jornada)
    // → se re-autentica solo y, con `loginPopupAutoClose`, cierra el popup sin que
    // el agente toque nada. Solo cuando la sesión SSO de verdad caduca aparece un
    // login real (~1 vez al día). El SoftphoneBanner queda como fallback manual si
    // un popup-blocker lo frena en la 1ra carga.
    // (Con federación SAML el `loginUrl` es el signInUrl y el flujo es aún más
    //  silencioso; para instancias CONNECT_MANAGED cae al /connect/login.)
    loginPopup: true,
    loginPopupAutoClose: true,
    loginOptions: { autoClose: true, height: 600, width: 433 },
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

  // Recuperación de auth (#login): si el CCP pierde la sesión (token expiró + el
  // refresh no pudo renovarla, o Connect deniega el acceso), avisamos al
  // consumidor para ofrecer reconexión. Con `loginPopup=true` Streams ya intenta
  // re-autenticar solo primero (popup silencioso si la cookie SSO sigue viva);
  // esto es la red de seguridad + observabilidad cuando ni eso alcanza.
  try {
    connect.core.onAuthFail(() => {
      console.warn("[CCP] auth perdida — sesión de Connect caída (onAuthFail)");
      opts.onAuthFail?.();
    });
    connect.core.onAccessDenied?.(() => {
      console.warn("[CCP] acceso denegado por Connect (onAccessDenied)");
      opts.onAuthFail?.();
    });
  } catch (e) {
    console.warn("[CCP] no se pudieron registrar los handlers de auth:", e);
  }
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
