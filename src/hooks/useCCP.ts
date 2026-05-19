/**
 * The useCCP hook moved into a Context provider (CCPContext) so all
 * components share a single subscription to amazon-connect-streams.
 * This file re-exports the hook and the agent-state type for backwards
 * compatibility with existing imports.
 */
export {
  useCCP,
  type ConnectAgentState,
  type QuickConnectEntry,
} from "@/context/CCPContext";
