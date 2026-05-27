import { useMemo } from "react";
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
import { useUsers, UUID_RE } from "@/hooks/useUsers";
import { useQueues } from "@/hooks/useQueues";
import { formatDurationSec } from "@/lib/utils";

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

export function ContactsTable({ contacts }: ContactsTableProps) {
  // Bug #9 / #10 — the backend frequently returns raw Connect UUIDs in
  // `agentUsername` and `queueName` (the field names are misleading).
  // We map them client-side to real names before rendering.
  const { userIdToName } = useUsers();
  const { queues } = useQueues();
  const queueIdToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const q of queues) map.set(q.id, q.name);
    return map;
  }, [queues]);

  const resolveAgent = (raw?: string): string => {
    if (!raw) return "—";
    if (UUID_RE.test(raw)) {
      const resolved = userIdToName.get(raw);
      // Bug #9 — until the listUsers Lambda redeploy lands the userId
      // field, fall back to a short prefix so the column has SOME
      // signal instead of a bare em-dash for every row.
      return resolved || `agente-${raw.slice(0, 4)}`;
    }
    return raw;
  };
  const resolveQueue = (raw?: string): string => {
    if (!raw) return "—";
    if (UUID_RE.test(raw)) {
      const resolved = queueIdToName.get(raw);
      return resolved || `cola-${raw.slice(0, 4)}`;
    }
    return raw;
  };

  // Bug #12 — hide the Categories column entirely when NONE of the contacts
  // in the current dataset have any. Removes a permanently-empty column.
  const showCategories = useMemo(
    () => contacts.some((c) => (c.categories?.length ?? 0) > 0),
    [contacts]
  );

  if (contacts.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        No hay contactos. Ajusta los filtros y vuelve a buscar.
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Agente</TableHead>
            <TableHead>Cola</TableHead>
            <TableHead>Canal</TableHead>
            <TableHead className="text-center">Duración</TableHead>
            <TableHead>Sentiment</TableHead>
            {showCategories && <TableHead>Categorías</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => {
            // Bug #11 — emails/SMS don't have a meaningful "duration",
            // and chats can run > 1 hour: format as HH:MM:SS in that
            // case and show a clear "—" for non-applicable channels.
            const channelUpper = (contact.channel || "").toUpperCase();
            const hasDuration =
              channelUpper === "VOICE" ||
              channelUpper === "TELEPHONY" ||
              channelUpper === "CHAT";
            return (
              <TableRow key={contact.contactId}>
                <TableCell className="text-sm">
                  {format(new Date(contact.initiationTimestamp), "MMM dd, HH:mm")}
                </TableCell>
                <TableCell className="font-medium">
                  {resolveAgent(contact.agentUsername)}
                </TableCell>
                <TableCell>{resolveQueue(contact.queueName)}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-xs">
                    {contact.channel}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  {hasDuration ? formatDurationSec(contact.duration) : "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    className={SENTIMENT_STYLES[contact.sentiment || "UNKNOWN"]}
                  >
                    {contact.sentiment || "N/A"}
                  </Badge>
                </TableCell>
                {showCategories && (
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {contact.categories?.map((cat, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {cat}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
