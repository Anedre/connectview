export type AgentState =
  | "Init"
  | "Available"
  | "Busy"
  | "AfterCallWork"
  | "CallingCustomer"
  | "Offline"
  | "Error";

export interface CCPConfig {
  instanceUrl: string;
  region: string;
}
