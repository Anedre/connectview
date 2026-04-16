import { useState, useEffect, useCallback } from "react";
import { fetchAuthSession, signOut } from "aws-amplify/auth";
import type { AuthUser, UserRole } from "@/types/auth";
import { ROLE_HIERARCHY } from "@/types/auth";

function getHighestRole(groups: UserRole[]): UserRole {
  return groups.reduce<UserRole>((highest, group) => {
    if (ROLE_HIERARCHY[group] > ROLE_HIERARCHY[highest]) {
      return group;
    }
    return highest;
  }, "Agents");
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      if (!idToken) {
        setUser(null);
        return;
      }

      const groups = (idToken.payload["cognito:groups"] as UserRole[]) || [
        "Agents",
      ];
      const email = (idToken.payload.email as string) || "";
      const userId = (idToken.payload.sub as string) || "";

      setUser({
        email,
        userId,
        groups,
        highestRole: getHighestRole(groups),
      });
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setUser(null);
  }, []);

  return { user, loading, signOut: handleSignOut, refreshSession };
}
