import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { UserPlus, UserMinus, Users, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useCampaignAgents } from "@/hooks/useCampaignAgents";
import { useLiveQueue } from "@/hooks/useLiveQueue";
import type { Campaign } from "@/hooks/useCampaigns";

interface Props {
  campaign: Campaign;
}

export function AssignedAgentsPanel({ campaign }: Props) {
  const { agents, loading, mutating, assign } = useCampaignAgents(
    campaign.campaignId,
    10000
  );
  const { data: liveQueue } = useLiveQueue(5000);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const campaignQueueId = (campaign as unknown as { campaignQueueId?: string })
    .campaignQueueId;

  const assignedIds = useMemo(
    () => new Set(agents.map((a) => a.userId)),
    [agents]
  );

  const availableUsers = useMemo(() => {
    const all = liveQueue?.agents || [];
    return all
      .filter((a) => !assignedIds.has(a.userId))
      .filter((a) =>
        search.trim()
          ? a.username.toLowerCase().includes(search.toLowerCase())
          : true
      )
      .sort((a, b) => a.username.localeCompare(b.username));
  }, [liveQueue?.agents, assignedIds, search]);

  const toggleSelect = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleAddSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!campaignQueueId) {
      toast.error(
        "La campaña no tiene queue asignada. Edita la campaña y elige una queue primero."
      );
      return;
    }
    try {
      const res = await assign([...selectedIds], []);
      toast.success(
        `${res.added?.length || 0} agentes asignados${
          res.errors?.length ? ` · ${res.errors.length} errores` : ""
        }`
      );
      if (res.errors?.length) {
        console.warn("assign errors:", res.errors);
      }
      setSelectedIds(new Set());
      setPickerOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error asignando");
    }
  };

  const handleRemove = async (userId: string, username: string) => {
    if (!confirm(`¿Desasignar ${username} de esta campaña?`)) return;
    try {
      await assign([], [userId]);
      toast.success(`${username} desasignado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error desasignando");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Agentes asignados ({agents.length})
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPickerOpen(true)}
            disabled={mutating}
          >
            <UserPlus className="mr-1 h-4 w-4" />
            Agregar agentes
          </Button>
        </div>
        {!campaignQueueId && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            ⚠️ Esta campaña no tiene queue asignada. Edita la campaña para elegir
            una queue antes de asignar agentes.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {loading && agents.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Cargando agentes...
          </div>
        ) : agents.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No hay agentes asignados aún. Click "Agregar agentes" para empezar —
            el sistema los configurará automáticamente para recibir llamadas de
            esta campaña.
          </p>
        ) : (
          <div className="space-y-2">
            {agents.map((a) => {
              // Find live status from Queue Manager data
              const live = liveQueue?.agents.find((x) => x.userId === a.userId);
              return (
                <div
                  key={a.userId}
                  className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                        live?.statusName?.toLowerCase() === "available"
                          ? "bg-emerald-100 text-emerald-700"
                          : live?.activeContact
                          ? "bg-blue-100 text-blue-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {a.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{a.username}</div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Badge variant="outline" className="text-[9px]">
                          {live?.statusName || "Offline"}
                        </Badge>
                        {a.addedQueueToRoutingProfile && (
                          <Badge className="bg-emerald-50 text-emerald-700 text-[9px] dark:bg-emerald-950/50 dark:text-emerald-300">
                            queue agregada auto
                          </Badge>
                        )}
                        <span>prioridad {a.priority}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700"
                    onClick={() => handleRemove(a.userId, a.username)}
                    disabled={mutating}
                    title="Desasignar"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Picker modal */}
      <Dialog open={pickerOpen} onOpenChange={(o) => !o && setPickerOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Asignar agentes a la campaña</DialogTitle>
            <DialogDescription>
              Los seleccionados recibirán llamadas de esta campaña. Si su routing
              profile no incluye la queue, se agregará automáticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar agente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border p-1">
            {availableUsers.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {search
                  ? "No hay agentes que coincidan."
                  : "Todos los agentes ya están asignados o no hay agentes disponibles."}
              </p>
            )}
            {availableUsers.map((u) => {
              const isSelected = selectedIds.has(u.userId);
              return (
                <label
                  key={u.userId}
                  className={`flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 transition-colors hover:bg-muted ${
                    isSelected ? "bg-primary/10" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(u.userId)}
                    className="h-4 w-4"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{u.username}</div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge variant="outline" className="text-[9px]">
                        {u.statusName || "Offline"}
                      </Badge>
                      {u.routingProfile && (
                        <span className="truncate">{u.routingProfile}</span>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPickerOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleAddSelected}
              disabled={selectedIds.size === 0 || mutating}
            >
              {mutating ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Asignando...
                </>
              ) : (
                <>
                  <UserPlus className="mr-1 h-4 w-4" />
                  Asignar {selectedIds.size} agente
                  {selectedIds.size === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
