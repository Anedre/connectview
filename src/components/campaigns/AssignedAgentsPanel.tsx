import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useCampaignAgents } from "@/hooks/useCampaignAgents";
import { useLiveQueue } from "@/hooks/useLiveQueue";
import type { Campaign } from "@/hooks/useCampaigns";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";

interface Props {
  campaign: Campaign;
  // Bug #28 — when a campaign has 0 explicit assignees but agents in the
  // queue answered the calls anyway (via routing profile), the empty
  // state used to look like a contradiction. The parent passes
  // `participatingAgentsCount` so we can show a clarifying note.
  participatingAgentsCount?: number;
}

export function AssignedAgentsPanel({ campaign, participatingAgentsCount = 0 }: Props) {
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
      <div className="card__head">
        <div className="card__title">
          <Icon.Users
            size={14}
            style={{ marginRight: 6, verticalAlign: "middle" }}
          />
          Agentes asignados
        </div>
        <span className="card__sub">{agents.length} asignados</span>
        <button
          className="btn btn--sm"
          style={{ marginLeft: "auto" }}
          onClick={() => setPickerOpen(true)}
          disabled={mutating}
        >
          <Icon.Plus size={11} /> Agregar agentes
        </button>
      </div>
      <CardBody>
        {!campaignQueueId && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: "var(--accent-amber-soft)",
              color: "var(--accent-amber)",
              fontSize: 11.5,
              marginBottom: 10,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <Icon.Flag size={12} />
            <span>
              Esta campaña no tiene queue asignada. Edita la campaña para elegir
              una queue antes de asignar agentes.
            </span>
          </div>
        )}
        {loading && agents.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--text-3)",
              fontSize: 12.5,
            }}
          >
            Cargando agentes…
          </div>
        ) : agents.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--text-3)",
              fontSize: 12.5,
              lineHeight: 1.6,
            }}
          >
            {participatingAgentsCount > 0 ? (
              <>
                Sin asignaciones explícitas, pero{" "}
                <strong>
                  {participatingAgentsCount}{" "}
                  {participatingAgentsCount === 1
                    ? "agente atendió llamadas"
                    : "agentes atendieron llamadas"}
                </strong>{" "}
                vía el routing profile (sección "Agentes en esta campaña"
                arriba). Si quieres priorizar agentes específicos haz click
                en <strong>"Agregar agentes"</strong>.
              </>
            ) : (
              <>
                No hay agentes asignados aún. Click{" "}
                <strong>"Agregar agentes"</strong> para empezar — el sistema
                los configurará automáticamente para recibir llamadas de esta
                campaña.
              </>
            )}
          </div>
        ) : (
          /* Inline pills that wrap — keeps the list compact when an
             agent has a short username (most cases) and gracefully
             stretches to ~360px when multiple chips need to coexist
             on the same row. */
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {agents.map((a) => {
              const live = liveQueue?.agents.find((x) => x.userId === a.userId);
              const statusName = (live?.statusName || "Offline").toLowerCase();
              const isAvailable = statusName === "available";
              const isOnContact = !!live?.activeContact;
              const avatarBg = isAvailable
                ? "var(--accent-green-soft)"
                : isOnContact
                ? "var(--accent-cyan-soft)"
                : "var(--bg-3)";
              const avatarFg = isAvailable
                ? "var(--accent-green)"
                : isOnContact
                ? "var(--accent-cyan)"
                : "var(--text-3)";
              const statusDotColor = isAvailable
                ? "var(--accent-green)"
                : isOnContact
                ? "var(--accent-cyan)"
                : "var(--text-3)";
              return (
                <div
                  key={a.userId}
                  className="row"
                  title={`${a.username} · ${live?.statusName || "Offline"} · prioridad ${a.priority}`}
                  style={{
                    gap: 8,
                    padding: "4px 6px 4px 4px",
                    background: "var(--bg-2)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 999,
                    alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: avatarBg,
                      color: avatarFg,
                      fontSize: 10,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {a.username.slice(0, 2).toUpperCase()}
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--text-1)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.username}
                  </span>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: statusDotColor,
                      flexShrink: 0,
                    }}
                    title={live?.statusName || "Offline"}
                  />
                  <span
                    className="muted mono"
                    style={{ fontSize: 10, flexShrink: 0 }}
                  >
                    p{a.priority}
                  </span>
                  {/* Queue mini-tags — show which queues this agent can
                      service (from their routing profile). Lets the
                      manager see at a glance "Andre handles
                      Pregrado+Posgrado, María only Posgrado" etc. We
                      trim "UDEP-" so the chips stay readable. */}
                  {live?.queues && live.queues.length > 0 && (
                    <span
                      className="row"
                      style={{ gap: 3, flexShrink: 0 }}
                      title={`Queues: ${live.queues
                        .map((q) => q.name)
                        .join(", ")}`}
                    >
                      {live.queues.slice(0, 4).map((q) => {
                        const label = q.name.replace(/^UDEP-/i, "");
                        return (
                          <span
                            key={q.id}
                            style={{
                              fontSize: 9,
                              padding: "1px 5px",
                              borderRadius: 4,
                              background: "var(--accent-cyan-soft)",
                              color: "var(--accent-cyan)",
                              fontWeight: 500,
                              lineHeight: 1.3,
                            }}
                          >
                            {label}
                          </span>
                        );
                      })}
                      {live.queues.length > 4 && (
                        <span
                          className="muted"
                          style={{ fontSize: 9, marginLeft: 2 }}
                        >
                          +{live.queues.length - 4}
                        </span>
                      )}
                    </span>
                  )}
                  {a.addedQueueToRoutingProfile && (
                    <span
                      className="muted"
                      style={{ fontSize: 9.5, flexShrink: 0 }}
                      title="Queue añadida automáticamente al routing profile"
                    >
                      · auto
                    </span>
                  )}
                  <button
                    onClick={() => handleRemove(a.userId, a.username)}
                    disabled={mutating}
                    title="Desasignar"
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-3)",
                      cursor: mutating ? "not-allowed" : "pointer",
                      display: "grid",
                      placeItems: "center",
                      padding: 0,
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLButtonElement).style.color =
                        "var(--accent-red)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLButtonElement).style.color =
                        "var(--text-3)")
                    }
                  >
                    <Icon.Close size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>

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
            <Icon.Search
              size={14}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-3)",
              }}
            />
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
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{u.username}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                      <span className="chip" style={{ fontSize: 9.5 }}>
                        {u.statusName || "Offline"}
                      </span>
                      {u.routingProfile && (
                        <span className="truncate">{u.routingProfile}</span>
                      )}
                      {/* Queue tags — same UX as the assigned list so the
                          manager can pick agents knowing what nivel they
                          will handle. */}
                      {u.queues && u.queues.length > 0 && (
                        <span className="flex gap-1 flex-wrap">
                          {u.queues.slice(0, 4).map((q) => (
                            <span
                              key={q.id}
                              style={{
                                fontSize: 9,
                                padding: "1px 5px",
                                borderRadius: 4,
                                background: "var(--accent-cyan-soft)",
                                color: "var(--accent-cyan)",
                                fontWeight: 500,
                                lineHeight: 1.3,
                              }}
                            >
                              {q.name.replace(/^UDEP-/i, "")}
                            </span>
                          ))}
                          {u.queues.length > 4 && (
                            <span className="text-[9px] opacity-70">
                              +{u.queues.length - 4}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <DialogFooter>
            <button
              className="btn btn--ghost"
              onClick={() => setPickerOpen(false)}
            >
              Cancelar
            </button>
            <button
              className="btn btn--primary"
              onClick={handleAddSelected}
              disabled={selectedIds.size === 0 || mutating}
            >
              {mutating ? (
                <>Asignando…</>
              ) : (
                <>
                  <Icon.Plus size={13} />
                  Asignar {selectedIds.size} agente
                  {selectedIds.size === 1 ? "" : "s"}
                </>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
