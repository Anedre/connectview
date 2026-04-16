import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shield, Users, RefreshCw } from "lucide-react";
import type { CognitoUser } from "@/types/admin";
import { format } from "date-fns";

// Mock users for development
function generateMockUsers(): CognitoUser[] {
  return [
    { username: "admin-001", email: "admin@novasys.com", status: "CONFIRMED", enabled: true, created: "2026-04-15T19:00:00Z", groups: ["Admins", "Agents"] },
    { username: "sup-001", email: "supervisor1@novasys.com", status: "CONFIRMED", enabled: true, created: "2026-04-15T19:05:00Z", groups: ["Supervisors", "Agents"] },
    { username: "agent-001", email: "agent.maria@novasys.com", status: "CONFIRMED", enabled: true, created: "2026-04-15T19:10:00Z", groups: ["Agents"] },
    { username: "agent-002", email: "agent.carlos@novasys.com", status: "CONFIRMED", enabled: true, created: "2026-04-15T19:11:00Z", groups: ["Agents"] },
    { username: "agent-003", email: "agent.ana@novasys.com", status: "CONFIRMED", enabled: true, created: "2026-04-15T19:12:00Z", groups: ["Agents"] },
    { username: "agent-004", email: "agent.pedro@novasys.com", status: "FORCE_CHANGE_PASSWORD", enabled: true, created: "2026-04-15T19:13:00Z", groups: ["Agents"] },
    { username: "agent-005", email: "agent.lucia@novasys.com", status: "CONFIRMED", enabled: false, created: "2026-04-15T19:14:00Z", groups: ["Agents"] },
  ];
}

const ROLE_STYLES: Record<string, string> = {
  Admins: "bg-red-100 text-red-800",
  Supervisors: "bg-blue-100 text-blue-800",
  Agents: "bg-green-100 text-green-800",
};

export function AdminPage() {
  const [users, setUsers] = useState<CognitoUser[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    // TODO: Replace with real API call
    await new Promise((r) => setTimeout(r, 500));
    setUsers(generateMockUsers());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (username: string, newRole: string | null) => {
    if (!newRole) return;
    // TODO: Call list-users Lambda to change group
    setUsers((prev) =>
      prev.map((u) =>
        u.username === username
          ? { ...u, groups: [newRole, ...(newRole !== "Agents" ? ["Agents"] : [])] }
          : u
      )
    );
  };

  const highestGroup = (groups: string[]) => {
    if (groups.includes("Admins")) return "Admins";
    if (groups.includes("Supervisors")) return "Supervisors";
    return "Agents";
  };

  const stats = {
    total: users.length,
    active: users.filter((u) => u.enabled).length,
    admins: users.filter((u) => u.groups.includes("Admins")).length,
    supervisors: users.filter((u) => u.groups.includes("Supervisors")).length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Administration</h2>
          <p className="text-muted-foreground">
            User management and role assignments
          </p>
        </div>
        <Button variant="outline" onClick={fetchUsers} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
            <Shield className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Admins</CardTitle>
            <Shield className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.admins}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Supervisors</CardTitle>
            <Shield className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.supervisors}</div>
          </CardContent>
        </Card>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Change Role</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.username}>
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell>
                    <Badge
                      variant={user.enabled ? "secondary" : "destructive"}
                    >
                      {user.enabled
                        ? user.status === "CONFIRMED"
                          ? "Active"
                          : "Pending"
                        : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={ROLE_STYLES[highestGroup(user.groups)]}>
                      {highestGroup(user.groups)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={highestGroup(user.groups)}
                      onValueChange={(v) => handleRoleChange(user.username, v)}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Agents">Agent</SelectItem>
                        <SelectItem value="Supervisors">Supervisor</SelectItem>
                        <SelectItem value="Admins">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(user.created), "MMM dd, yyyy")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
