import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Play,
  Pause,
  Square,
  Phone,
  PhoneOff,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Megaphone,
  Users,
  Pencil,
  Copy,
  RefreshCw,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useCampaignStats } from "@/hooks/useCampaignStats";
import { useCampaignContacts, type CampaignContactRow } from "@/hooks/useCampaignContacts";
import { useCampaignMutations, type RelaunchScope } from "@/hooks/useCampaignMutations";
import { useCampaignContactMutations } from "@/hooks/useCampaignContactMutations";
import { getApiEndpoints } from "@/lib/api";
import { formatDistanceToNow, format } from "date-fns";
import { EditCampaignDialog } from "@/components/campaigns/EditCampaignDialog";
import { AddContactsDialog } from "@/components/campaigns/AddContactsDialog";
import { EditContactDialog } from "@/components/campaigns/EditContactDialog";
import { AssignedAgentsPanel } from "@/components/campaigns/AssignedAgentsPanel";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  dialing: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  connected: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  no_answer: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  failed: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
};

const CAMPAIGN_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  RUNNING: "bg-emerald-100 text-emerald-800",
  PAUSED: "bg-amber-100 text-amber-800",
  COMPLETED: "bg-blue-100 text-blue-800",
  CANCELLED: "bg-rose-100 text-rose-800",
};

export function CampaignDetailPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { data, loading, error, refresh } = useCampaignStats(campaignId || null, 3000);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const { contacts, refresh: refreshContacts } = useCampaignContacts(
    campaignId || null,
    filterStatus,
    5000
  );
  const [controlling, setControlling] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addContactsOpen, setAddContactsOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<CampaignContactRow | null>(
    null
  );
  const mutations = useCampaignMutations();
  const contactMutations = useCampaignContactMutations();

  const handleDeleteContact = async (row: CampaignContactRow) => {
    if (!campaignId) return;
    if (!confirm(`¿Eliminar ${row.phone} (${row.customerName || "sin nombre"})?`))
      return;
    try {
      const res = await contactMutations.deleteContacts(campaignId, [row.rowId]);
      if (res.removed > 0) {
        toast.success("Contacto eliminado");
      } else if (res.errors?.length) {
        toast.error(res.errors[0]);
      }
      refresh();
      refreshContacts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error eliminando");
    }
  };

  const handleControl = async (
    action: "start" | "pause" | "resume" | "cancel"
  ) => {
    if (!campaignId) return;
    setControlling(true);
    try {
      const endpoints = getApiEndpoints();
      if (!endpoints?.controlCampaign) throw new Error("endpoint not configured");
      const r = await fetch(endpoints.controlCampaign, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, action }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(body?.error || body?.message || `HTTP ${r.status}`);
      toast.success(`Campaña ${action}d`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setControlling(false);
    }
  };

  const handleClone = async () => {
    if (!campaignId) return;
    try {
      const res = await mutations.clone(campaignId);
      toast.success(`Clonada como "${res.name}". Abriendo la nueva...`);
      navigate(`/campaigns/${res.campaignId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error clonando");
    }
  };

  const handleRelaunch = async (scope: RelaunchScope = "all") => {
    if (!campaignId) return;
    const label =
      scope === "all"
        ? "TODOS los contactos (se reenvían)"
        : "solo los failed / no-answer";
    if (!confirm(`¿Relanzar ${label}?`)) return;
    try {
      const res = await mutations.relaunch(campaignId, scope);
      toast.success(
        `Campaña relanzada · ${res.rowsReset} contactos reseteados a pending`
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error relanzando");
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading campaign...
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
        {error}
      </div>
    );
  }
  if (!data) return null;

  const c = data.campaign;
  const counts = data.counts;
  const total = c.totalContacts || 0;
  const completed = counts.done + counts.failed + counts.no_answer;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const statusCards: Array<{
    key: keyof typeof counts;
    label: string;
    icon: React.ElementType;
    color: string;
  }> = [
    { key: "pending", label: "Pending", icon: Clock, color: "text-slate-600" },
    { key: "dialing", label: "Dialing", icon: Phone, color: "text-blue-600" },
    { key: "connected", label: "Connected", icon: Phone, color: "text-emerald-600" },
    { key: "done", label: "Done", icon: CheckCircle2, color: "text-emerald-700" },
    { key: "no_answer", label: "No answer", icon: PhoneOff, color: "text-amber-600" },
    { key: "failed", label: "Failed", icon: XCircle, color: "text-rose-600" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/campaigns")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-pink-600 text-white shadow-md">
            <Megaphone className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight">{c.name}</h2>
              <Badge className={CAMPAIGN_STATUS_COLORS[c.status] || ""}>
                {c.status}
              </Badge>
            </div>
            {c.description && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {c.description}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {c.sourcePhoneNumber} · {c.dialMode} · concurrencia{" "}
              {c.concurrency} ·{" "}
              {c.createdAt
                ? `creada ${formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}`
                : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Edit — only while still editable */}
          {(c.status === "DRAFT" ||
            c.status === "RUNNING" ||
            c.status === "PAUSED") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
              disabled={controlling}
            >
              <Pencil className="mr-1 h-4 w-4" />
              Editar
            </Button>
          )}

          {/* Clone — always available */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleClone}
            disabled={mutations.pending}
          >
            <Copy className="mr-1 h-4 w-4" />
            Clonar
          </Button>

          {/* Relaunch — only for terminal states */}
          {(c.status === "COMPLETED" || c.status === "CANCELLED") && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRelaunch("failed")}
                disabled={mutations.pending}
              >
                <RefreshCw className="mr-1 h-4 w-4" />
                Relanzar fallidos
              </Button>
              <Button
                size="sm"
                onClick={() => handleRelaunch("all")}
                disabled={mutations.pending}
              >
                <RefreshCw className="mr-1 h-4 w-4" />
                Relanzar todos
              </Button>
            </>
          )}

          {/* DRAFT → Start */}
          {c.status === "DRAFT" && (
            <Button
              size="sm"
              onClick={() => handleControl("start")}
              disabled={controlling}
            >
              <Play className="mr-1 h-4 w-4" />
              Iniciar
            </Button>
          )}
          {c.status === "RUNNING" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleControl("pause")}
                disabled={controlling}
              >
                <Pause className="mr-1 h-4 w-4" />
                Pausar
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleControl("cancel")}
                disabled={controlling}
              >
                <Square className="mr-1 h-4 w-4" />
                Cancelar
              </Button>
            </>
          )}
          {c.status === "PAUSED" && (
            <Button
              size="sm"
              onClick={() => handleControl("resume")}
              disabled={controlling}
            >
              <Play className="mr-1 h-4 w-4" />
              Reanudar
            </Button>
          )}
        </div>
      </div>

      {/* Progress banner */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold">
                {completed} <span className="text-lg text-muted-foreground">/ {total}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                Contactos procesados · {pct}%
              </div>
            </div>
            <div className="text-right text-sm">
              <div className="text-muted-foreground">
                {counts.pending} pending · {counts.dialing + counts.connected} live
              </div>
              {c.startedAt && (
                <div className="text-xs text-muted-foreground">
                  Iniciada {format(new Date(c.startedAt), "HH:mm")}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-gradient-to-r from-orange-500 to-pink-600 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Status tiles */}
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {statusCards.map((s) => {
          const active = filterStatus === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setFilterStatus(active ? null : s.key)}
              className={`rounded-lg border p-3 text-left transition-all hover:border-primary/50 ${
                active ? "border-primary ring-2 ring-primary/20" : ""
              }`}
            >
              <s.icon className={`h-4 w-4 ${s.color}`} />
              <div className="mt-1 text-2xl font-bold tabular-nums">
                {counts[s.key]}
              </div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </button>
          );
        })}
      </div>

      {/* Live agents on calls */}
      {data.liveContacts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              En llamada ahora ({data.liveContacts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.liveContacts.map((lc) => (
                <div
                  key={lc.rowId}
                  className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                    <div>
                      <div className="font-medium">
                        {lc.customerName || lc.phone}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {lc.phone}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {lc.agentUsername && (
                      <Badge variant="outline" className="text-xs">
                        {lc.agentUsername}
                      </Badge>
                    )}
                    <Badge className={STATUS_COLORS[lc.status] || ""}>
                      {lc.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assigned agents — routing profile auto-configured */}
      <AssignedAgentsPanel campaign={c} />

      <EditCampaignDialog
        campaign={c}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => refresh()}
      />
      <AddContactsDialog
        campaignId={campaignId || null}
        open={addContactsOpen}
        onClose={() => setAddContactsOpen(false)}
        onAdded={() => {
          refresh();
          refreshContacts();
        }}
      />
      <EditContactDialog
        campaignId={campaignId || ""}
        contact={editingContact}
        open={!!editingContact}
        onClose={() => setEditingContact(null)}
        onSaved={() => {
          refresh();
          refreshContacts();
        }}
      />

      {/* Contacts table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Contactos
              {filterStatus && (
                <Badge variant="outline" className="ml-2 text-xs">
                  filtro: {filterStatus}
                  <button
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setFilterStatus(null)}
                  >
                    ✕
                  </button>
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {contacts.length} rows
              </span>
              {c.status !== "COMPLETED" && c.status !== "CANCELLED" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setAddContactsOpen(true)}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Agregar contactos
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[500px] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60">
                <tr>
                  <th className="p-2 text-left text-xs">Phone</th>
                  <th className="p-2 text-left text-xs">Nombre</th>
                  <th className="p-2 text-left text-xs">Status</th>
                  <th className="p-2 text-left text-xs">Attempts</th>
                  <th className="p-2 text-left text-xs">Agent</th>
                  <th className="p-2 text-left text-xs">Last attempt</th>
                  <th className="p-2 text-right text-xs">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {contacts.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="p-6 text-center text-xs text-muted-foreground"
                    >
                      Sin contactos para este filtro.
                    </td>
                  </tr>
                )}
                {contacts.map((row) => {
                  const locked =
                    row.status === "dialing" || row.status === "connected";
                  return (
                    <tr key={row.rowId} className="border-t">
                      <td className="p-2 font-mono text-xs">{row.phone}</td>
                      <td className="p-2">{row.customerName || "—"}</td>
                      <td className="p-2">
                        <Badge className={STATUS_COLORS[row.status] || ""}>
                          {row.status}
                        </Badge>
                      </td>
                      <td className="p-2 text-xs">{row.attempts}</td>
                      <td className="p-2 text-xs">{row.agentUsername || "—"}</td>
                      <td className="p-2 text-[11px] text-muted-foreground">
                        {row.lastAttemptAt
                          ? formatDistanceToNow(new Date(row.lastAttemptAt), {
                              addSuffix: true,
                            })
                          : "—"}
                      </td>
                      <td className="p-2 text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => setEditingContact(row)}
                            disabled={locked}
                            title={
                              locked
                                ? "No se puede editar llamada activa"
                                : "Editar"
                            }
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700"
                            onClick={() => handleDeleteContact(row)}
                            disabled={locked || contactMutations.pending}
                            title={
                              locked
                                ? "No se puede eliminar llamada activa"
                                : "Eliminar"
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
