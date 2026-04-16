import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { RoleGate } from "@/components/layout/RoleGate";
import { Headset, Activity, BarChart3, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Welcome, {user?.username || "User"}
        </h2>
        <p className="text-muted-foreground">
          Connectview - Amazon Connect Control Panel
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card
          className="cursor-pointer transition-colors hover:bg-accent"
          onClick={() => navigate("/agent")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Agent Desktop</CardTitle>
            <Headset className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Access the Contact Control Panel to handle calls and chats
            </p>
          </CardContent>
        </Card>

        <RoleGate minRole="Supervisors">
          <Card className="cursor-not-allowed opacity-60">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Real-time Monitoring
              </CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Monitor queues and agent activity in real-time (Coming in Phase 2)
              </p>
            </CardContent>
          </Card>

          <Card className="cursor-not-allowed opacity-60">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Reports</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Contact Lens analytics and custom reports (Coming in Phase 3)
              </p>
            </CardContent>
          </Card>
        </RoleGate>

        <RoleGate minRole="Admins">
          <Card className="cursor-not-allowed opacity-60">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Admin</CardTitle>
              <Settings className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                User management and configuration (Coming in Phase 5)
              </p>
            </CardContent>
          </Card>
        </RoleGate>
      </div>
    </div>
  );
}
