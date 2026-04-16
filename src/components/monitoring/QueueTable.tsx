import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { QueueMetrics } from "@/types/monitoring";

interface QueueTableProps {
  queues: QueueMetrics[];
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export function QueueTable({ queues }: QueueTableProps) {
  if (queues.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No queues configured or no data available.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b bg-muted/40 hover:bg-muted/40">
          <TableHead className="h-11 font-semibold text-foreground">
            Queue
          </TableHead>
          <TableHead className="h-11 text-center font-semibold text-foreground">
            In Queue
          </TableHead>
          <TableHead className="h-11 text-center font-semibold text-foreground">
            Oldest Wait
          </TableHead>
          <TableHead className="h-11 text-center font-semibold text-foreground">
            Available
          </TableHead>
          <TableHead className="h-11 text-center font-semibold text-foreground">
            Online
          </TableHead>
          <TableHead className="h-11 text-center font-semibold text-foreground">
            On Call
          </TableHead>
          <TableHead className="h-11 text-center font-semibold text-foreground">
            ACW
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {queues.map((queue) => {
          const hasWaiting = queue.contactsInQueue > 0;
          const isCritical = queue.contactsInQueue > 3;

          return (
            <TableRow
              key={queue.queueId}
              className="transition-colors hover:bg-muted/30"
            >
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  {hasWaiting && (
                    <span className="relative flex h-2 w-2">
                      <span
                        className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                          isCritical ? "bg-rose-400" : "bg-amber-400"
                        }`}
                      />
                      <span
                        className={`relative inline-flex h-2 w-2 rounded-full ${
                          isCritical ? "bg-rose-500" : "bg-amber-500"
                        }`}
                      />
                    </span>
                  )}
                  {queue.queueName}
                </div>
              </TableCell>
              <TableCell className="text-center">
                <span
                  className={`inline-flex min-w-[2.5rem] items-center justify-center rounded-md px-2 py-1 text-sm font-semibold ${
                    isCritical
                      ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                      : hasWaiting
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {queue.contactsInQueue}
                </span>
              </TableCell>
              <TableCell className="text-center font-mono text-sm text-muted-foreground">
                {formatWait(queue.oldestContactAge)}
              </TableCell>
              <TableCell className="text-center">
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {queue.agentsAvailable}
                </span>
              </TableCell>
              <TableCell className="text-center font-medium">
                {queue.agentsOnline}
              </TableCell>
              <TableCell className="text-center font-medium text-blue-600 dark:text-blue-400">
                {queue.agentsOnCall}
              </TableCell>
              <TableCell className="text-center font-medium text-orange-600 dark:text-orange-400">
                {queue.agentsACW}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
