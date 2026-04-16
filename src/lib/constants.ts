export const CONNECT_INSTANCE_URL =
  import.meta.env.VITE_CONNECT_INSTANCE_URL || "";
export const CONNECT_REGION =
  import.meta.env.VITE_CONNECT_REGION || "us-east-1";

export const NAV_ITEMS = [
  {
    label: "Dashboard",
    path: "/",
    icon: "LayoutDashboard" as const,
    minRole: "Agents" as const,
  },
  {
    label: "Agent Desktop",
    path: "/agent",
    icon: "Headset" as const,
    minRole: "Agents" as const,
  },
  {
    label: "Monitoring",
    path: "/monitoring",
    icon: "Activity" as const,
    minRole: "Supervisors" as const,
  },
  {
    label: "Reports",
    path: "/reports",
    icon: "BarChart3" as const,
    minRole: "Supervisors" as const,
  },
  {
    label: "Recordings",
    path: "/recordings",
    icon: "Disc" as const,
    minRole: "Supervisors" as const,
  },
  {
    label: "Admin",
    path: "/admin",
    icon: "Settings" as const,
    minRole: "Admins" as const,
  },
] as const;
