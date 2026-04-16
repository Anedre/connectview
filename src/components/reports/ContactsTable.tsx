import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { ContactRecord } from "@/types/monitoring";
import { format } from "date-fns";

interface ContactsTableProps {
  contacts: ContactRecord[];
}

const SENTIMENT_STYLES: Record<string, string> = {
  POSITIVE: "bg-green-100 text-green-800",
  NEGATIVE: "bg-red-100 text-red-800",
  NEUTRAL: "bg-gray-100 text-gray-800",
  MIXED: "bg-yellow-100 text-yellow-800",
  UNKNOWN: "bg-gray-50 text-gray-500",
};

function formatDuration(seconds?: number): string {
  if (!seconds) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function ContactsTable({ contacts }: ContactsTableProps) {
  if (contacts.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        No contacts found. Adjust your filters and search again.
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead>Queue</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead className="text-center">Duration</TableHead>
            <TableHead>Sentiment</TableHead>
            <TableHead>Categories</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => (
            <TableRow key={contact.contactId}>
              <TableCell className="text-sm">
                {format(new Date(contact.initiationTimestamp), "MMM dd, HH:mm")}
              </TableCell>
              <TableCell className="font-medium">
                {contact.agentUsername}
              </TableCell>
              <TableCell>{contact.queueName}</TableCell>
              <TableCell>
                <Badge variant="secondary" className="text-xs">
                  {contact.channel}
                </Badge>
              </TableCell>
              <TableCell className="text-center">
                {formatDuration(contact.duration)}
              </TableCell>
              <TableCell>
                <Badge
                  className={SENTIMENT_STYLES[contact.sentiment || "UNKNOWN"]}
                >
                  {contact.sentiment || "N/A"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {contact.categories?.map((cat, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {cat}
                    </Badge>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
