import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Megaphone,
  Plus,
  Phone,
  PhoneOff,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  Copy,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useCampaigns, type Campaign } from "@/hooks/useCampaigns";
import { useCampaignMutations } from "@/hooks/useCampaignMutations";
import { NewCampaignWizard } from "@/components/campaigns/NewCampaignWizard";
import { formatDistanceToNow } from "date-fns";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  RUNNING: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  PAUSED: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  COMPLETED: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  CANCELLED: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
};

function progressPct(c: Campaign): number {
  const total = Number(c.totalContacts || 0);
  if (!total) return 0;
  const done = Number(c.doneCount || 0) + Number(c.failedCount || 0);
  return Math.round((done / total) * 100);
}

export function CampaignsPage() {
  const navigate = useNavigate();
  const { campaigns, loading, error, refresh } = useCampaigns(5000);
  const [wizardOpen, setWizardOpen] = useState(false);
  const mutations = useCampaignMutations();

  const handleClone = async (
    e: React.MouseEvent,
    campaign: Campaign
  ) => {
    e.stopPropagation();
    try {
      const res = await mutations.clone(campaign.campaignId);
      toast.success(`Clonada como "${res.name}"`);
      navigate(`/campaigns/${res.campaignId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error clonando");
    }
  };

  const handleRelaunch = async (e: React.MouseEvent, campaign: Campaign) => {
    e.stopPropagation();
    if (!confirm(`¿Relanzar "${campaign.name}" con TODOS los contactos?`))
      return;
    try {
      const res = await mutations.relaunch(campaign.campaignId, "all");
      toast.success(
        `Relanzada · ${res.rowsReset} contactos reseteados a pending`
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error relanzando");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-pink-600 text-white shadow-md">
            <Megaphone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Campañas</h2>
            <p className="text-sm text-muted-foreground">
              Outbound voice campaigns · dial lists · live progress
            </p>
          </div>
        </div>
        <Button onClick={() => setWizardOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva campaña
        </Button>
      </div>

      {loading && campaigns.length === 0 && (
        <div className="flex items-center justify-center rounded-lg border bg-card py-10 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading campaigns...
        </div>
      )}

      {error && campaigns.length === 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      )}

      {!loading && !error && campaigns.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-100 to-pink-100 text-orange-600 dark:from-orange-950/30 dark:to-pink-950/30">
              <Megaphone className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No hay campañas aún</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Crea tu primera campaña outbound: sube un listado de contactos,
              elige un contact flow, y Connectview se encarga del dialing
              respetando la disponibilidad de agentes.
            </p>
            <Button
              className="mt-4"
              onClick={() => setWizardOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Crear primera campaña
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {campaigns.map((c) => {
          const pct = progressPct(c);
          return (
            <Card
              key={c.campaignId}
              className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
              onClick={() => navigate(`/campaigns/${c.campaignId}`)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">
                      {c.name}
                    </CardTitle>
                    {c.description && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {c.description}
                      </p>
                    )}
                  </div>
                  <Badge className={STATUS_STYLES[c.status] || ""}>
                    {c.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Progress bar */}
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">
                      {Number(c.doneCount || 0) +
                        Number(c.failedCount || 0)}{" "}
                      / {c.totalContacts}
                    </span>
                    <span className="text-muted-foreground">{pct}%</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-gradient-to-r from-orange-500 to-pink-600 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* Mini stats */}
                <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
                  <div className="rounded-md bg-muted/40 py-1.5">
                    <Clock className="mx-auto h-3 w-3 text-slate-500" />
                    <div className="mt-0.5 font-semibold tabular-nums">
                      {c.pendingCount || 0}
                    </div>
                    <div className="text-muted-foreground">Pending</div>
                  </div>
                  <div className="rounded-md bg-blue-50 py-1.5 dark:bg-blue-950/30">
                    <Phone className="mx-auto h-3 w-3 text-blue-600" />
                    <div className="mt-0.5 font-semibold tabular-nums">
                      {(c.dialingCount || 0) + (c.connectedCount || 0)}
                    </div>
                    <div className="text-muted-foreground">Live</div>
                  </div>
                  <div className="rounded-md bg-emerald-50 py-1.5 dark:bg-emerald-950/30">
                    <CheckCircle2 className="mx-auto h-3 w-3 text-emerald-600" />
                    <div className="mt-0.5 font-semibold tabular-nums">
                      {c.doneCount || 0}
                    </div>
                    <div className="text-muted-foreground">Done</div>
                  </div>
                  <div className="rounded-md bg-rose-50 py-1.5 dark:bg-rose-950/30">
                    <XCircle className="mx-auto h-3 w-3 text-rose-600" />
                    <div className="mt-0.5 font-semibold tabular-nums">
                      {(c.failedCount || 0) + (c.noAnswerCount || 0)}
                    </div>
                    <div className="text-muted-foreground">Retry/Fail</div>
                  </div>
                </div>

                {/* Meta + actions */}
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <PhoneOff className="h-3 w-3" />
                    {c.sourcePhoneNumber}
                  </span>
                  <span>
                    {c.createdAt
                      ? formatDistanceToNow(new Date(c.createdAt), {
                          addSuffix: true,
                        })
                      : ""}
                  </span>
                </div>

                <div className="flex gap-1.5 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    onClick={(e) => handleClone(e, c)}
                    disabled={mutations.pending}
                  >
                    <Copy className="mr-1 h-3 w-3" />
                    Clonar
                  </Button>
                  {(c.status === "COMPLETED" ||
                    c.status === "CANCELLED") && (
                    <Button
                      size="sm"
                      className="h-7 flex-1 text-xs"
                      onClick={(e) => handleRelaunch(e, c)}
                      disabled={mutations.pending}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" />
                      Relanzar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <NewCampaignWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={() => {
          setWizardOpen(false);
          refresh();
        }}
      />
    </div>
  );
}
