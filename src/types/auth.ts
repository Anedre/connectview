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

// Human-readable singular labels for the user-visible role chip.
// Bug #19: the topbar/sidebar used to show the raw enum value
// ("Admins", "Supervisors") in a context that grammatically expects
// a singular noun ("Listo · Admins" → should read "Listo · Admin").
export const ROLE_LABEL: Record<UserRole, string> = {
  Admins: "Admin",
  Supervisors: "Supervisor",
  Agents: "Agente",
};

export function roleLabelOf(role: UserRole | undefined | null): string {
  if (!role) return "Agente";
  return ROLE_LABEL[role] ?? "Agente";
}

export interface AuthUser {
  email: string;
  userId: string;
  username: string;
  groups: UserRole[];
  highestRole: UserRole;
  securityProfiles: string[];
}
