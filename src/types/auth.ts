export type UserRole = "Agents" | "Supervisors" | "Admins";

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  Agents: 0,
  Supervisors: 1,
  Admins: 2,
};

// Map Connect security profile names to app roles
export const SECURITY_PROFILE_TO_ROLE: Record<string, UserRole> = {
  Admin: "Admins",
  CallCenterManager: "Supervisors",
  QualityAnalyst: "Supervisors",
  Agent: "Agents",
};

export interface AuthUser {
  email: string;
  userId: string;
  username: string;
  groups: UserRole[];
  highestRole: UserRole;
  securityProfiles: string[];
}
