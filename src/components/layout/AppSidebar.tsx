import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Headset,
  Activity,
  BarChart3,
  Disc,
  Settings,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { NAV_ITEMS } from "@/lib/constants";
import { useRoles } from "@/hooks/useRoles";

const ICON_MAP = {
  LayoutDashboard,
  Headset,
  Activity,
  BarChart3,
  Disc,
  Settings,
} as const;

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAtLeast } = useRoles();

  const visibleItems = NAV_ITEMS.filter((item) => isAtLeast(item.minRole));

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">Connectview</h1>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const Icon = ICON_MAP[item.icon];
                const isActive = location.pathname === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => navigate(item.path)}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
