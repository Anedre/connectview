import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollText, Check, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAdminAudit } from "@/hooks/useAdminAudit";

export function AuditLogPanel() {
  const { entries, loading } = useAdminAudit(50, 8000);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="h-4 w-4" />
          Audit log ({entries.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-[500px] overflow-y-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60">
              <tr>
                <th className="p-2 text-left">Cuando</th>
                <th className="p-2 text-left">Acción</th>
                <th className="p-2 text-left">Admin</th>
                <th className="p-2 text-left">Target</th>
                <th className="p-2 text-left">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {loading && entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Cargando...
                  </td>
                </tr>
              )}
              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    Sin entradas aún.
                  </td>
                </tr>
              )}
              {entries.map((e) => {
                const target =
                  typeof e.target === "object" && e.target !== null
                    ? (e.target as Record<string, unknown>)
                    : {};
                const targetStr = Object.entries(target)
                  .map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`)
                  .join(" · ");
                return (
                  <tr key={e.auditId} className="border-t">
                    <td className="p-2 text-muted-foreground">
                      {formatDistanceToNow(new Date(e.timestamp), {
                        addSuffix: true,
                      })}
                    </td>
                    <td className="p-2 font-medium">{e.action}</td>
                    <td className="p-2">{e.actor}</td>
                    <td className="max-w-xs p-2 truncate text-[11px] text-muted-foreground">
                      {targetStr || "—"}
                    </td>
                    <td className="p-2">
                      {e.result === "success" ? (
                        <Badge className="bg-emerald-100 text-emerald-800">
                          <Check className="mr-0.5 h-3 w-3" />
                          OK
                        </Badge>
                      ) : (
                        <Badge className="bg-rose-100 text-rose-800">
                          <X className="mr-0.5 h-3 w-3" />
                          Error
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
