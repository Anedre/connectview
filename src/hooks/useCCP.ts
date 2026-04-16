import { useState, useEffect } from "react";
import type { AgentState } from "@/types/connect";

export function useCCP() {
  const [agentState, setAgentState] = useState<AgentState>("Init");
  const [agentName, setAgentName] = useState("");
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The CCP is initialized by ConnectAuthProvider at the app level.
    // Here we just subscribe to agent events.
    if (typeof connect === "undefined" || !connect.agent) return;

    try {
      connect.agent((agent) => {
        setAgentName(agent.getName());
        setIsInitialized(true);

        const currentState = agent.getState();
        setAgentState(currentState.name as AgentState);

        agent.onStateChange((stateChange) => {
          setAgentState(stateChange.newState as AgentState);
        });

        agent.onError(() => {
          setError("Agent connection error");
          setAgentState("Error");
        });
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to subscribe to agent"
      );
    }
  }, []);

  return { agentState, agentName, isInitialized, error };
}
