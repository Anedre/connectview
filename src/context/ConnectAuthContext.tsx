import { createContext, useContext, useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { initCCP } from "@/lib/connect";
import { CONNECT_INSTANCE_URL } from "@/lib/constants";
import {
  SECURITY_PROFILE_TO_ROLE,
  ROLE_HIERARCHY,
} from "@/types/auth";
import type { AuthUser, UserRole } from "@/types/auth";
import { getApiEndpoints } from "@/lib/api";

interface ConnectAuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  ccpContainerRef: React.RefObject<HTMLDivElement | null>;
  signOut: () => void;
}

const ConnectAuthContext = createContext<ConnectAuthContextValue | null>(null);

function mapSecurityProfilesToRoles(profiles: string[]): UserRole[] {
  const roles = new Set<UserRole>(["Agents"]); // Everyone is at least an Agent
  for (const profile of profiles) {
    const role = SECURITY_PROFILE_TO_ROLE[profile];
    if (role) roles.add(role);
  }
  return Array.from(roles);
}

function getHighestRole(groups: UserRole[]): UserRole {
  return groups.reduce<UserRole>((highest, group) => {
    if (ROLE_HIERARCHY[group] > ROLE_HIERARCHY[highest]) {
      return group;
    }
    return highest;
  }, "Agents");
}

async function fetchSecurityProfiles(username: string): Promise<string[]> {
  try {
    const endpoints = getApiEndpoints();
    if (!endpoints?.listUsers) return [];
    const response = await fetch(endpoints.listUsers);
    if (!response.ok) return [];
    const data = await response.json();
    const user = (data.users || []).find(
      (u: { username: string }) => u.username === username
    );
    return user?.groups || [];
  } catch {
    return [];
  }
}

// Module-level guard so React StrictMode (dev) doesn't double-init the CCP iframe.
// The CCP iframe must live for the full page lifetime — we never tear it down on cleanup.
let ccpInitialized = false;

export function ConnectAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ccpContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ccpContainerRef.current;
    if (!container || ccpInitialized) return;
    if (!CONNECT_INSTANCE_URL) {
      setError("Connect instance URL not configured");
      setLoading(false);
      return;
    }

    ccpInitialized = true;

    try {
      initCCP(container, CONNECT_INSTANCE_URL);

      connect.agent(async (agent) => {
        try {
          const config = agent.getConfiguration();
          const username = config.username;

          // Fetch the REAL security profiles from the Connect API via our Lambda
          const securityProfiles = await fetchSecurityProfiles(username);
          const groups = mapSecurityProfilesToRoles(securityProfiles);

          setUser({
            email: username + "@novasys.connect",
            userId: config.agentARN.split("/").pop() || "",
            username,
            groups,
            highestRole: getHighestRole(groups),
            securityProfiles,
          });
          setLoading(false);
          setError(null);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Failed to load agent config"
          );
          setLoading(false);
        }

        agent.onError((err) => {
          console.error("Agent error:", err);
          setError("Agent connection error");
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize CCP");
      setLoading(false);
      ccpInitialized = false;
    }
    // No cleanup: the CCP iframe is a singleton tied to the page, not the component lifecycle.
    // Terminating it on StrictMode unmount/remount breaks event listeners (core.initialized stays false).
  }, []);

  const signOut = () => {
    window.location.href = `${CONNECT_INSTANCE_URL}/connect/logout`;
  };

  return (
    <ConnectAuthContext.Provider
      value={{ user, loading, error, ccpContainerRef, signOut }}
    >
      {children}
    </ConnectAuthContext.Provider>
  );
}

export function useConnectAuth() {
  const ctx = useContext(ConnectAuthContext);
  if (!ctx) {
    throw new Error("useConnectAuth must be used within ConnectAuthProvider");
  }
  return ctx;
}
