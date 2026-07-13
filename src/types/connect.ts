export type AgentState =
  | "Init"
  | "Available"
  | "Busy"
  | "AfterCallWork"
  | "CallingCustomer"
  | "Offline"
  | "Error"
  // Connect moves the agent here automatically when they miss a routed
  // contact. The state blocks new routed contacts until the agent
  // returns to Available manually. Different instances spell it
  // differently — accept the common variants.
  | "MissedCallAgent"
  | "MissedCall"
  | "Missed Call Agent"
  // Connect también mueve al agente aquí cuando FALLA el connect de un contacto
  // ruteado (p.ej. la media WebRTC no se estableció). Mismo bloqueo + misma
  // recuperación manual que el missed.
  | "FailedConnectAgent"
  | "FailedConnect"
  // Custom states defined per-instance (any string) — kept as a
  // string fallback so we don't have to type-narrow every read.
  | (string & {});

export interface CCPConfig {
  instanceUrl: string;
  region: string;
}
