import { useEffect, useState, useMemo } from "react";
import { getApiEndpoints } from "@/lib/api";

export interface ConnectUserSummary {
  username: string;
  userId?: string;
  agentARN?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  groups?: string[];
}

/**
 * Fetch the list of Connect users + a memoized userId → username map.
 * Used by Reports (Bug #9) and other surfaces that need to resolve raw
 * Connect user UUIDs to human-readable usernames.
 */
export function useUsers() {
  const [users, setUsers] = useState<ConnectUserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const endpoints = getApiEndpoints();
    if (!endpoints?.listUsers) return;
    setLoading(true);
    fetch(endpoints.listUsers)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => setUsers(j.users || []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  const userIdToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) {
      const id =
        u.userId || (u.agentARN ? u.agentARN.split("/").pop() : undefined);
      if (id) map.set(id, u.username);
    }
    return map;
  }, [users]);

  return { users, loading, error, userIdToName };
}

// UUID v4-ish heuristic — matches the user/queue ARN suffix form Connect emits.
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
