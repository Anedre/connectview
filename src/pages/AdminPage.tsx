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
import { getApiEndpoints } from "@/lib/api";

const ROLE_STYLES: Record<string, string> = {
  Admins: "bg-red-100 text-red-800",
  Supervisors: "bg-blue-100 text-blue-800",
  Agents: "bg-green-100 text-green-800",
};

export function AdminPage() {
  const [users, setUsers] = useState<CognitoUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoints = getApiEndpoints();
      if (endpoints?.listUsers) {
        const response = await fetch(endpoints.listUsers);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        setUsers(data.users || []);
      } else {
        throw new Error("API not configured");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch users");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (username: string, newRole: string | null) => {
    if (!newRole) return;
    const endpoints = getApiEndpoints();
    if (!endpoints?.listUsers) return;

    const currentRole = highestGroup(
      users.find((u) => u.username === username)?.groups || []
    );

    try {
      await fetch(endpoints.listUsers, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          removeGroup: currentRole,
          addGroup: newRole,
        }),
      });
      // Refresh users list
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    }
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

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

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
          {users.length === 0 && !loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {error ? "Failed to load users." : "No users found."}
            </p>
          ) : (
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
                      {user.created
                        ? format(new Date(user.created), "MMM dd, yyyy")
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
