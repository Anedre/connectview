import { useAuth } from "./useAuth";
import type { UserRole } from "@/types/auth";
import { ROLE_HIERARCHY } from "@/types/auth";

export function useRoles() {
  const { user } = useAuth();

  function hasRole(role: UserRole): boolean {
    if (!user) return false;
    return user.groups.includes(role);
  }

  function isAtLeast(minimumRole: UserRole): boolean {
    if (!user) return false;
    return ROLE_HIERARCHY[user.highestRole] >= ROLE_HIERARCHY[minimumRole];
  }

  return {
    role: user?.highestRole ?? null,
    groups: user?.groups ?? [],
    hasRole,
    isAtLeast,
  };
}
