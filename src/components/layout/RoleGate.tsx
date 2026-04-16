import type { ReactNode } from "react";
import type { UserRole } from "@/types/auth";
import { useRoles } from "@/hooks/useRoles";

interface RoleGateProps {
  minRole: UserRole;
  children: ReactNode;
  fallback?: ReactNode;
}

export function RoleGate({ minRole, children, fallback = null }: RoleGateProps) {
  const { isAtLeast } = useRoles();

  if (!isAtLeast(minRole)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
