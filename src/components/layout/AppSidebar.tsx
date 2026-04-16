import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Headset,
  Activity,
  BarChart3,
  Disc,
  Settings,
  Sparkles,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { NAV_ITEMS } from "@/lib/constants";
import { useRoles } from "@/hooks/useRoles";
import { useConnectAuth } from "@/context/ConnectAuthContext";

const ICON_MAP = {
  LayoutDashboard,
  Headset,
  Activity,
  BarChart3,
  Disc,
  Settings,
} as const;

// Accent colors for each icon
const ICON_COLORS: Record<string, string> = {
  LayoutDashboard: "text-blue-400",
  Headset: "text-emerald-400",
  Activity: "text-amber-400",
  BarChart3: "text-purple-400",
  Disc: "text-pink-400",
  Settings: "text-rose-400",
};

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAtLeast } = useRoles();
  const { user } = useConnectAuth();

  const visibleItems = NAV_ITEMS.filter((item) => isAtLeast(item.minRole));

  return (
    <Sidebar className="border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/30">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-sidebar-foreground">
              Connectview
            </h1>
            <p className="text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
              Novasys
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3 py-4">
        <SidebarGroup>
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
            Workspace
          </div>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {visibleItems.map((item, idx) => {
                const Icon = ICON_MAP[item.icon];
                const isActive = location.pathname === item.path;
                const iconColor = isActive
                  ? "text-white"
                  : ICON_COLORS[item.icon] || "text-sidebar-foreground/70";

                return (
                  <SidebarMenuItem
                    key={item.path}
                    className="animate-fade-in-up"
                    style={{ animationDelay: `${idx * 40}ms` }}
                  >
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => navigate(item.path)}
                      className={`group relative h-10 rounded-lg transition-all duration-200 ${
                        isActive
                          ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-600/30 hover:from-indigo-500 hover:to-purple-500"
                          : "hover:bg-sidebar-accent"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-white" />
                      )}
                      <Icon
                        className={`h-4 w-4 transition-colors ${iconColor}`}
                      />
                      <span className="text-sm font-medium">{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3 rounded-lg bg-sidebar-accent/50 p-3">
          <div className="relative">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-xs font-semibold text-white">
              {user?.username?.slice(0, 2).toUpperCase() || "??"}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-sidebar animate-pulse-dot" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-sidebar-foreground">
              {user?.username || "Loading..."}
            </div>
            <div className="truncate text-[10px] text-sidebar-foreground/60">
              {user?.highestRole}
            </div>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
