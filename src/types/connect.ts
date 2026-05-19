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
  // Custom states defined per-instance (any string) — kept as a
  // string fallback so we don't have to type-narrow every read.
  | (string & {});

export interface CCPConfig {
  instanceUrl: string;
  region: string;
}
