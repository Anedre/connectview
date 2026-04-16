export type UserRole = "Agents" | "Supervisors" | "Admins";

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  Agents: 0,
  Supervisors: 1,
  Admins: 2,
};

export interface AuthUser {
  email: string;
  userId: string;
  groups: UserRole[];
  highestRole: UserRole;
}
