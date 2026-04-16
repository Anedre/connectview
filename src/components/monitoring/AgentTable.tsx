import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { AgentStatus } from "@/types/monitoring";

interface AgentTableProps {
  agents: AgentStatus[];
}

const STATUS_STYLES: Record<string, string> = {
  Available: "bg-green-100 text-green-800",
  "On call": "bg-blue-100 text-blue-800",
  "After call work": "bg-orange-100 text-orange-800",
  Busy: "bg-yellow-100 text-yellow-800",
  Offline: "bg-gray-100 text-gray-600",
};

function formatDuration(timestamp: string): string {
  const diff = Math.floor(
    (Date.now() - new Date(timestamp).getTime()) / 1000
  );
  if (diff < 60) return `${diff}s`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export function AgentTable({ agents }: AgentTableProps) {
  const sorted = [...agents].sort((a, b) => {
    // Available first, then On call, then ACW, then Offline
    const order: Record<string, number> = {
      Available: 0,
      "On call": 1,
      Busy: 2,
      "After call work": 3,
      Offline: 4,
    };
    return (order[a.status] ?? 5) - (order[b.status] ?? 5);
  });

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead className="text-center">Active Contacts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((agent) => {
            const activeCount = Object.values(agent.activeContacts).reduce(
              (sum, v) => sum + v,
              0
            );
            return (
              <TableRow key={agent.agentId}>
                <TableCell className="font-medium">{agent.username}</TableCell>
                <TableCell>
                  <Badge className={STATUS_STYLES[agent.status] || ""}>
                    {agent.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDuration(agent.statusStartTimestamp)}
                </TableCell>
                <TableCell className="text-center">
                  {activeCount > 0 ? (
                    <Badge variant="secondary">{activeCount}</Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
