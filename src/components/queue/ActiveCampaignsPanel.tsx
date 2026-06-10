import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Megaphone,
  Phone,
  PhoneCall,
  Clock,
  CheckCircle2,
  XCircle,
  PhoneOff,
  ArrowUpRight,
  Loader2,
  Pause,
} from "lucide-react";
import type { ActiveCampaignsData } from "@/hooks/useActiveCampaigns";

interface Props {
  data: ActiveCampaignsData | null;
  loading: boolean;
}

const STATUS_PILL: Record<string, string> = {
  RUNNING: "bg-[var(--accent-green-soft)] text-[var(--accent-green)]",
  PAUSED: "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)]",
};

export function ActiveCampaignsPanel({ data, loading }: Props) {
  const navigate = useNavigate();

  if (loading && !data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Cargando campañas activas...
        </CardContent>
      </Card>
    );
  }

  if (!data || data.campaigns.length === 0) {
    return null; // Don't clutter the page if there are no active campaigns
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="h-4 w-4 text-[var(--accent-amber)]" />
          Campañas activas ({data.campaigns.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.campaigns.map((view) => {
          const c = view.campaign;
          const counts = view.counts;
          const total = c.totalContacts || 0;
          const completed = counts.done + counts.failed + counts.no_answer;
          const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
          const live = counts.dialing + counts.connected;

          return (
            <div
              key={c.campaignId}
              className="rounded-lg border bg-card p-3 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {c.status === "PAUSED" ? (
                    <Pause className="h-4 w-4 shrink-0 text-[var(--accent-amber)]" />
                  ) : (
                    <PhoneCall className="h-4 w-4 shrink-0 text-[var(--accent-green)]" />
                  )}
                  <span className="truncate font-semibold">{c.name}</span>
                  <Badge className={STATUS_PILL[c.status] || "text-xs"}>
                    {c.status}
                  </Badge>
                  {c.campaignQueueName && (
                    <Badge variant="outline" className="text-[10px]">
                      {c.campaignQueueName}
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => navigate(`/campaigns/${c.campaignId}`)}
                >
                  Ver detalle
                  <ArrowUpRight className="ml-1 h-3 w-3" />
                </Button>
              </div>

              {/* Progress bar */}
              <div className="mt-2">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {completed} / {total}
                  </span>
                  <span>{pct}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--accent-amber)] to-[var(--accent-pink-soft)] transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {/* Mini KPI row — labels en español para alinear con el
                  resto de la UI. Antes mezclaba "Pending/Done/Failed". */}
              <div className="mt-2 grid grid-cols-6 gap-1 text-center text-[11px]">
                <MiniKpi
                  icon={Clock}
                  value={counts.pending}
                  label="Pendientes"
                  color="text-[var(--text-3)]"
                />
                <MiniKpi
                  icon={Phone}
                  value={counts.dialing}
                  label="Marcando"
                  color="text-[var(--accent-cyan)]"
                  highlight={counts.dialing > 0}
                />
                <MiniKpi
                  icon={PhoneCall}
                  value={counts.connected}
                  label="En llamada"
                  color="text-[var(--accent-green)]"
                  highlight={counts.connected > 0}
                />
                <MiniKpi
                  icon={CheckCircle2}
                  value={counts.done}
                  label="Cerrados"
                  color="text-[var(--accent-green)]"
                />
                <MiniKpi
                  icon={PhoneOff}
                  value={counts.no_answer}
                  label="Sin resp."
                  color="text-[var(--accent-amber)]"
                />
                <MiniKpi
                  icon={XCircle}
                  value={counts.failed}
                  label="Fallidos"
                  color="text-[var(--accent-red)]"
                />
              </div>

              {/* Live contacts of this campaign (if any) */}
              {view.liveContacts.length > 0 && (
                <div className="mt-3 space-y-1 border-t pt-2">
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                    En llamada ahora ({view.liveContacts.length})
                  </div>
                  {view.liveContacts.slice(0, 5).map((lc) => (
                    <div
                      key={lc.rowId}
                      className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-muted/40"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-2 w-2 animate-pulse rounded-full bg-[var(--accent-green)]" />
                        <span className="font-mono">
                          {lc.phone || lc.rowId.slice(0, 8)}
                        </span>
                        {lc.customerName && (
                          <span className="text-muted-foreground">
                            · {lc.customerName}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {lc.agentUsername && (
                          <Badge variant="outline" className="text-[9px]">
                            {lc.agentUsername}
                          </Badge>
                        )}
                        <Badge
                          className={
                            lc.status === "connected"
                              ? "bg-[var(--accent-green-soft)] text-[var(--accent-green)] text-[9px]"
                              : "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] text-[9px]"
                          }
                        >
                          {lc.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {view.liveContacts.length > 5 && (
                    <div className="text-center text-[10px] text-muted-foreground">
                      + {view.liveContacts.length - 5} más
                    </div>
                  )}
                </div>
              )}

              {/* Live summary when no contacts live */}
              {view.liveContacts.length === 0 && live === 0 && (
                <p className="mt-2 text-[11px] italic text-muted-foreground">
                  Sin llamadas en vivo · el dialer disparará la próxima en el
                  siguiente tick
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function MiniKpi({
  icon: Icon,
  value,
  label,
  color,
  highlight,
}: {
  icon: React.ElementType;
  value: number;
  label: string;
  color: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md py-1 ${
        highlight ? "bg-[var(--accent-cyan-soft)]" : "bg-muted/30"
      }`}
    >
      <Icon className={`mx-auto h-3 w-3 ${color}`} />
      <div className="font-semibold tabular-nums">{value}</div>
      <div className="text-[9px] text-muted-foreground">{label}</div>
    </div>
  );
}
