import { createContext, useContext, useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { initCCP, terminateCCP } from "@/lib/connect";
import { CONNECT_INSTANCE_URL } from "@/lib/constants";
import { SECURITY_PROFILE_TO_ROLE, ROLE_HIERARCHY } from "@/types/auth";
import type { AuthUser, UserRole } from "@/types/auth";

interface ConnectAuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  ccpContainerRef: React.RefObject<HTMLDivElement | null>;
  signOut: () => void;
}

const ConnectAuthContext = createContext<ConnectAuthContextValue | null>(null);

function mapSecurityProfilesToRoles(profiles: string[]): UserRole[] {
  const roles = new Set<UserRole>();
  for (const profile of profiles) {
    const role = SECURITY_PROFILE_TO_ROLE[profile];
    if (role) roles.add(role);
  }
  // Every authenticated Connect user is at least an Agent
  if (roles.size === 0) roles.add("Agents");
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

export function ConnectAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ccpContainerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    const container = ccpContainerRef.current;
    if (!container || initialized.current) return;
    if (!CONNECT_INSTANCE_URL) {
      setError("Connect instance URL not configured");
      setLoading(false);
      return;
    }

    initialized.current = true;

    try {
      initCCP(container, CONNECT_INSTANCE_URL);

      connect.agent((agent) => {
        try {
          const config = agent.getConfiguration();
          // permissions contains security profile names
          const securityProfiles = config.permissions || [];
          const groups = mapSecurityProfilesToRoles(securityProfiles);

          setUser({
            email: config.username + "@novasys.connect",
            userId: config.agentARN.split("/").pop() || "",
            username: config.username,
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
      initialized.current = false;
    }

    return () => {
      if (initialized.current) {
        terminateCCP();
        initialized.current = false;
      }
    };
  }, []);

  const signOut = () => {
    // Connect doesn't have a programmatic signout - redirect to logout URL
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
