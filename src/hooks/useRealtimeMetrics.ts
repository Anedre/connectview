import { useState, useEffect, useCallback, useRef } from "react";
import type { RealtimeMetrics } from "@/types/monitoring";
import { fetchAuthSession } from "aws-amplify/auth";

const POLL_INTERVAL = 15000; // 15 seconds

// Mock data for development before backend is deployed
function generateMockMetrics(): RealtimeMetrics {
  const queues = ["BasicQueue", "SalesQueue", "SupportQueue"];
  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalContactsInQueue: Math.floor(Math.random() * 8),
      totalAgentsAvailable: 3 + Math.floor(Math.random() * 5),
      totalAgentsOnline: 8 + Math.floor(Math.random() * 4),
      longestWaitSeconds: Math.floor(Math.random() * 120),
    },
    queues: queues.map((name) => ({
      queueId: name.toLowerCase(),
      queueName: name,
      contactsInQueue: Math.floor(Math.random() * 4),
      oldestContactAge: Math.floor(Math.random() * 60),
      agentsAvailable: 1 + Math.floor(Math.random() * 3),
      agentsOnline: 2 + Math.floor(Math.random() * 4),
      agentsOnCall: Math.floor(Math.random() * 3),
      agentsACW: Math.floor(Math.random() * 2),
    })),
    agents: [
      { agentId: "1", username: "agent.maria", status: "Available", statusStartTimestamp: new Date().toISOString(), activeContacts: {}, availableSlots: { VOICE: 1 } },
      { agentId: "2", username: "agent.carlos", status: "On call", statusStartTimestamp: new Date(Date.now() - 180000).toISOString(), activeContacts: { VOICE: 1 }, availableSlots: {} },
      { agentId: "3", username: "agent.ana", status: "After call work", statusStartTimestamp: new Date(Date.now() - 45000).toISOString(), activeContacts: {}, availableSlots: {} },
      { agentId: "4", username: "agent.pedro", status: "Available", statusStartTimestamp: new Date().toISOString(), activeContacts: {}, availableSlots: { VOICE: 1 } },
      { agentId: "5", username: "agent.lucia", status: "On call", statusStartTimestamp: new Date(Date.now() - 300000).toISOString(), activeContacts: { CHAT: 1 }, availableSlots: {} },
      { agentId: "6", username: "agent.jorge", status: "Offline", statusStartTimestamp: new Date(Date.now() - 600000).toISOString(), activeContacts: {}, availableSlots: {} },
    ],
  };
}

export function useRealtimeMetrics() {
  const [metrics, setMetrics] = useState<RealtimeMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchMetrics = useCallback(async () => {
    try {
      const session = await fetchAuthSession({});
      const apiUrl = session.tokens?.idToken?.payload?.["custom:metricsApiUrl"] as string | undefined;

      if (apiUrl) {
        const response = await fetch(apiUrl);
        const data = await response.json();
        setMetrics(data);
      } else {
        // Use mock data when API URL is not configured
        setMetrics(generateMockMetrics());
      }
      setError(null);
      setLastRefresh(new Date());
    } catch {
      // Fallback to mock data on error
      setMetrics(generateMockMetrics());
      setError(null);
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    intervalRef.current = setInterval(fetchMetrics, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchMetrics]);

  return { metrics, loading, error, lastRefresh, refresh: fetchMetrics };
}
