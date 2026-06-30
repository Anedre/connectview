import { useMemo, useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
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
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { useUsers, UUID_RE } from "@/hooks/useUsers";
import { useQueues } from "@/hooks/useQueues";
import { formatDurationSec } from "@/lib/utils";

interface ContactsTableProps {
  contacts: ContactRecord[];
}

const SENTIMENT_STYLES: Record<string, string> = {
  POSITIVE: "bg-[var(--accent-green-soft)] text-[var(--accent-green)]",
  NEGATIVE: "bg-[var(--accent-red-soft)] text-[var(--accent-red)]",
  NEUTRAL: "bg-[var(--bg-2)] text-[var(--text-2)]",
  MIXED: "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)]",
  UNKNOWN: "bg-[var(--bg-2)] text-[var(--text-3)]",
};

// Canales con "duración" significativa (emails/SMS no tienen).
const CHANNELS_WITH_DURATION = new Set(["VOICE", "TELEPHONY", "CHAT"]);

/**
 * ContactsTable — migrada a TanStack Table (headless): mantiene el markup
 * shadcn (Table/TableRow/…) y los estilos, pero ahora cada columna es
 * ordenable haciendo click en su cabecera (getSortedRowModel). El ordenamiento
 * de "Agente"/"Cola" usa el nombre YA resuelto (no el UUID crudo).
 */
export function ContactsTable({ contacts }: ContactsTableProps) {
  // Bug #9 / #10 — el backend suele devolver UUIDs crudos en `agentUsername`
  // y `queueName`; los mapeamos a nombres reales antes de render/ordenar.
  const { userIdToName } = useUsers();
  const { queues } = useQueues();
  const [sorting, setSorting] = useState<SortingState>([]);

  const queueIdToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const q of queues) map.set(q.id, q.name);
    return map;
  }, [queues]);

  // Bug #12 — ocultar la columna Categorías si NINGÚN contacto tiene.
  const showCategories = useMemo(
    () => contacts.some((c) => (c.categories?.length ?? 0) > 0),
    [contacts]
  );

  const columns = useMemo<ColumnDef<ContactRecord>[]>(() => {
    const resolveAgent = (raw?: string): string => {
      if (!raw) return "—";
      if (UUID_RE.test(raw)) return userIdToName.get(raw) || `agente-${raw.slice(0, 4)}`;
      return raw;
    };
    const resolveQueue = (raw?: string): string => {
      if (!raw) return "—";
      if (UUID_RE.test(raw)) return queueIdToName.get(raw) || `cola-${raw.slice(0, 4)}`;
      return raw;
    };

    const cols: ColumnDef<ContactRecord>[] = [
      {
        accessorKey: "initiationTimestamp",
        header: "Fecha",
        cell: ({ getValue }) => (
          <span className="text-sm">
            {format(new Date(getValue<string>()), "MMM dd, HH:mm")}
          </span>
        ),
      },
      {
        id: "agente",
        accessorFn: (c) => resolveAgent(c.agentUsername),
        header: "Agente",
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue<string>()}</span>
        ),
      },
      {
        id: "cola",
        accessorFn: (c) => resolveQueue(c.queueName),
        header: "Cola",
      },
      {
        accessorKey: "channel",
        header: "Canal",
        cell: ({ getValue }) => (
          <Badge variant="secondary" className="text-xs">
            {getValue<string>()}
          </Badge>
        ),
      },
      {
        accessorKey: "duration",
        header: "Duración",
        cell: ({ row }) => {
          const ch = (row.original.channel || "").toUpperCase();
          return CHANNELS_WITH_DURATION.has(ch)
            ? formatDurationSec(row.original.duration)
            : "—";
        },
      },
      {
        accessorKey: "sentiment",
        header: "Sentiment",
        cell: ({ getValue }) => {
          const s = getValue<string>();
          return (
            <Badge className={SENTIMENT_STYLES[s || "UNKNOWN"]}>{s || "N/A"}</Badge>
          );
        },
      },
    ];

    if (showCategories) {
      cols.push({
        id: "categorias",
        header: "Categorías",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.categories?.map((cat, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {cat}
              </Badge>
            ))}
          </div>
        ),
      });
    }
    return cols;
  }, [showCategories, userIdToName, queueIdToName]);

  const table = useReactTable({
    data: contacts,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

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
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <TableHead
                    key={header.id}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    className={
                      header.column.id === "duration" ? "text-center" : undefined
                    }
                    style={canSort ? { cursor: "pointer", userSelect: "none" } : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {canSort &&
                        (sorted === "asc" ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : sorted === "desc" ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-40" />
                        ))}
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={cell.column.id === "duration" ? "text-center" : undefined}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
