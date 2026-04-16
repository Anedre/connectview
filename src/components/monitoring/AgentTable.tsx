import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgentStatus } from "@/types/monitoring";

interface AgentTableProps {
  agents: AgentStatus[];
}

const STATUS_STYLES: Record<string, { bg: string; dot: string }> = {
  Available: {
    bg: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
    dot: "bg-emerald-500",
  },
  "On call": {
    bg: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900",
    dot: "bg-blue-500",
  },
  "After call work": {
    bg: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-900",
    dot: "bg-orange-500",
  },
  Busy: {
    bg: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900",
    dot: "bg-amber-500",
  },
  Offline: {
    bg: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-950/50 dark:text-slate-400 dark:border-slate-800",
    dot: "bg-slate-400",
  },
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
  if (agents.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No agents connected right now.
      </div>
    );
  }

  const sorted = [...agents].sort((a, b) => {
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
    <Table>
      <TableHeader>
        <TableRow className="border-b bg-muted/40 hover:bg-muted/40">
          <TableHead className="h-11 font-semibold text-foreground">
            Agent
          </TableHead>
          <TableHead className="h-11 font-semibold text-foreground">
            Status
          </TableHead>
          <TableHead className="h-11 font-semibold text-foreground">
            Duration
          </TableHead>
          <TableHead className="h-11 text-center font-semibold text-foreground">
            Active Contacts
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((agent) => {
          const activeCount = Object.values(agent.activeContacts).reduce(
            (sum, v) => sum + v,
            0
          );
          const style = STATUS_STYLES[agent.status] || STATUS_STYLES.Offline;
          const initials = agent.username.slice(0, 2).toUpperCase();

          return (
            <TableRow
              key={agent.agentId}
              className="transition-colors hover:bg-muted/30"
            >
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-[10px] font-semibold text-white">
                    {initials}
                  </div>
                  <span className="font-medium">{agent.username}</span>
                </div>
              </TableCell>
              <TableCell>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.bg}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${style.dot} ${
                      agent.status === "On call" ? "animate-pulse" : ""
                    }`}
                  />
                  {agent.status}
                </span>
              </TableCell>
              <TableCell className="font-mono text-sm text-muted-foreground">
                {formatDuration(agent.statusStartTimestamp)}
              </TableCell>
              <TableCell className="text-center">
                {activeCount > 0 ? (
                  <span className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                    {activeCount}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
