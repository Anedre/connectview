/* eslint-disable @typescript-eslint/no-explicit-any */
declare namespace connect {
  function core(): void;

  namespace core {
    function initCCP(
      container: HTMLElement,
      options: InitCCPOptions
    ): void;
    function terminate(): void;
    /** Se dispara cuando el CCP pierde la autenticación (el token expiró y el
     *  refresh silencioso no pudo renovarlo). Clave para recuperar la sesión sin
     *  forzar un re-login manual. */
    function onAuthFail(callback: () => void): void;
    /** Se dispara cuando Connect rechaza el acceso del CCP. */
    function onAccessDenied(callback: () => void): void;
  }

  function agent(callback: (agent: Agent) => void): void;
  function contact(callback: (contact: Contact) => void): void;

  interface InitCCPOptions {
    ccpUrl: string;
    loginPopup?: boolean;
    loginPopupAutoClose?: boolean;
    loginUrl?: string;
    /** Geometría + auto-cierre del popup de login. `autoClose` cierra el popup
     *  apenas la auth termina (re-login silencioso cuando la sesión SSO sigue viva). */
    loginOptions?: {
      autoClose?: boolean;
      height?: number;
      width?: number;
      top?: number;
      left?: number;
    };
    softphone?: {
      allowFramedSoftphone?: boolean;
      disableRingtone?: boolean;
    };
    pageOptions?: {
      enableAudioDeviceSettings?: boolean;
      enablePhoneTypeSettings?: boolean;
    };
    ccpAckTimeout?: number;
    ccpSynTimeout?: number;
    ccpLoadTimeout?: number;
  }

  interface Agent {
    getState(): AgentStateDefinition;
    getName(): string;
    getConfiguration(): AgentConfiguration;
    getContacts(contactTypeFilter?: string): Contact[];
    getRoutingProfile(): any;
    onStateChange(callback: (state: AgentStateChange) => void): void;
    onRefresh(callback: (agent: Agent) => void): void;
    onError(callback: (error: any) => void): void;
    setState(
      state: AgentStateDefinition,
      callbacks?: {
        success?: () => void;
        failure?: (err: any) => void;
      }
    ): void;
    getAgentStates(): AgentStateDefinition[];
  }

  interface AgentConfiguration {
    name: string;
    username: string;
    agentARN: string;
    permissions: string[];
    extension?: string;
    routingProfile: {
      name: string;
      routingProfileARN: string;
    };
  }

  interface AgentStateDefinition {
    name: string;
    type: string;
    agentStateARN?: string;
  }

  interface AgentStateChange {
    agent: Agent;
    oldState: string;
    newState: string;
  }

  interface Contact {
    getContactId(): string;
    getType(): string;
    getState(): ContactStateDefinition;
    getQueue(): any;
    getInitialConnection(): Connection | null;
    getAttributes(): Record<string, { name: string; value: string }>;
    onConnecting(callback: (contact: Contact) => void): void;
    onConnected(callback: (contact: Contact) => void): void;
    onEnded(callback: (contact: Contact) => void): void;
    onDestroy(callback: (contact: Contact) => void): void;
    onACW(callback: (contact: Contact) => void): void;
    onError(callback: (contact: Contact) => void): void;
  }

  interface Connection {
    getEndpoint(): Endpoint;
    getContactId(): string;
  }

  interface Endpoint {
    phoneNumber?: string;
    type?: string;
    name?: string;
  }

  interface ContactStateDefinition {
    type: string;
    timestamp: Date;
  }
}
