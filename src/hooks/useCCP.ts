import { useState, useEffect, useRef, useCallback } from "react";
import { initCCP, terminateCCP } from "@/lib/connect";
import { CONNECT_INSTANCE_URL } from "@/lib/constants";
import type { AgentState } from "@/types/connect";

export function useCCP() {
  const [agentState, setAgentState] = useState<AgentState>("Init");
  const [agentName, setAgentName] = useState("");
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasInitialized = useRef(false);

  const initialize = useCallback((container: HTMLElement) => {
    if (hasInitialized.current) return;
    if (!CONNECT_INSTANCE_URL) {
      setError("Connect instance URL not configured");
      return;
    }

    hasInitialized.current = true;

    try {
      initCCP(container, CONNECT_INSTANCE_URL);

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
        err instanceof Error ? err.message : "Failed to initialize CCP"
      );
      hasInitialized.current = false;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (hasInitialized.current) {
        terminateCCP();
        hasInitialized.current = false;
      }
    };
  }, []);

  return { agentState, agentName, isInitialized, error, initialize };
}
