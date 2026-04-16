import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Queue</TableHead>
            <TableHead className="text-center">In Queue</TableHead>
            <TableHead className="text-center">Oldest Wait</TableHead>
            <TableHead className="text-center">Available</TableHead>
            <TableHead className="text-center">Online</TableHead>
            <TableHead className="text-center">On Call</TableHead>
            <TableHead className="text-center">ACW</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {queues.map((queue) => (
            <TableRow key={queue.queueId}>
              <TableCell className="font-medium">{queue.queueName}</TableCell>
              <TableCell className="text-center">
                <Badge
                  variant={queue.contactsInQueue > 3 ? "destructive" : "secondary"}
                >
                  {queue.contactsInQueue}
                </Badge>
              </TableCell>
              <TableCell className="text-center">
                {formatWait(queue.oldestContactAge)}
              </TableCell>
              <TableCell className="text-center text-green-600 font-medium">
                {queue.agentsAvailable}
              </TableCell>
              <TableCell className="text-center">{queue.agentsOnline}</TableCell>
              <TableCell className="text-center text-blue-600">
                {queue.agentsOnCall}
              </TableCell>
              <TableCell className="text-center text-orange-600">
                {queue.agentsACW}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
