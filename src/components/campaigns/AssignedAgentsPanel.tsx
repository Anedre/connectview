import { useEffect, useState, useMemo } from "react";
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
import { useFlowQueues } from "@/hooks/useFlowQueues";
import { useCan } from "@/hooks/usePermissions";
import { initials } from "@/lib/initials";
import type { Campaign } from "@/hooks/useCampaigns";
import { Card, CardBody } from "@/components/vox/primitives";
import * as Icon from "@/components/vox/primitives";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Props {
  campaign: Campaign;
  // Bug #28 — when a campaign has 0 explicit assignees but agents in the
  // queue answered the calls anyway (via routing profile), the empty
  // state used to look like a contradiction. The parent passes
  // `participatingAgentsCount` so we can show a clarifying note.
  participatingAgentsCount?: number;
}

export function AssignedAgentsPanel({ campaign, participatingAgentsCount = 0 }: Props) {
  const { agents, loading, mutating, assign } = useCampaignAgents(campaign.campaignId, 10000);
  // Agregar/quitar agentes = gestión de campaña. Antes el panel quedaba
  // editable para cualquiera que viera la página.
  const canManage = useCan("manage_campaigns");
  const { data: liveQueue } = useLiveQueue(5000);
  const { confirm, confirmDialog } = useConfirm();
  // Discover which queues THIS campaign's flow actually routes to.
  // For UDEP-Outbound-Smart this returns Pregrado/Posgrado/Diplomados/
  // Alumnos (lead-attribute routing). For UDEP-Campaign-Outbound it
  // returns just Pregrado. The picker uses this list so we don't offer
  // queues the campaign would never route to.
  const { data: flowQueues, loading: flowQueuesLoading } = useFlowQueues(
    campaign.contactFlowId || null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Per-selected-agent queue choice. When the campaign's flow has
   *  multiple literal queues, the picker shows a Select next to each
   *  selected agent so the admin can pick which one. */
  const [queueByUserId, setQueueByUserId] = useState<Record<string, string>>({});

  const campaignQueueId = (campaign as unknown as { campaignQueueId?: string }).campaignQueueId;

  /** Queues the campaign's flow actually uses. Empty = fall back to
   *  campaign.campaignQueueId (legacy behaviour). */
  const flowLiteralQueues = useMemo(() => flowQueues?.literalQueues || [], [flowQueues]);

  /** When >1 queue, the picker MUST surface a selector (smart routing).
   *  When 1 queue, default to it silently. When 0, use campaign fallback. */
  const isMultiQueueCampaign = flowLiteralQueues.length > 1;

  const assignedIds = useMemo(() => new Set(agents.map((a) => a.userId)), [agents]);

  const availableUsers = useMemo(() => {
    const all = liveQueue?.agents || [];
    return all
      .filter((a) => !assignedIds.has(a.userId))
      .filter((a) =>
        search.trim() ? a.username.toLowerCase().includes(search.toLowerCase()) : true,
      )
      .sort((a, b) => a.username.localeCompare(b.username));
  }, [liveQueue?.agents, assignedIds, search]);

  /** When an agent is selected/deselected, also seed/clear their queue
   *  choice with a smart default:
   *    - intersection with their routing-profile queues (matches what
   *      they're already qualified for) → first match
   *    - else the flow's primaryQueue
   *    - else the campaign's fallback queue
   */
  const defaultQueueFor = (userId: string): string => {
    if (flowLiteralQueues.length === 0) return campaignQueueId || "";
    if (flowLiteralQueues.length === 1) return flowLiteralQueues[0].queueId;
    const agent = liveQueue?.agents.find((a) => a.userId === userId);
    const agentQueueIds = new Set((agent?.queues || []).map((q) => q.id));
    const intersect = flowLiteralQueues.find((q) => agentQueueIds.has(q.queueId));
    if (intersect) return intersect.queueId;
    return flowQueues?.primaryQueue?.queueId || flowLiteralQueues[0].queueId;
  };

  const toggleSelect = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
        setQueueByUserId((q) => {
          const c = { ...q };
          delete c[userId];
          return c;
        });
      } else {
        next.add(userId);
        setQueueByUserId((q) => ({ ...q, [userId]: defaultQueueFor(userId) }));
      }
      return next;
    });
  };

  // When the campaign's flow changes (or first loads), re-seed any
  // already-checked agents' queue choice so it isn't stuck on a stale
  // value from the previous flow.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    setQueueByUserId((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) {
        if (!next[id]) next[id] = defaultQueueFor(id);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowQueues?.contactFlowId]);

  const handleAddSelected = async () => {
    if (selectedIds.size === 0) return;
    // Validate that every selected agent has a resolvable queue. Either
    // explicit (multi-queue smart flow) or via fallback (campaignQueueId).
    const missing: string[] = [];
    for (const uid of selectedIds) {
      const q =
        queueByUserId[uid] ||
        (flowLiteralQueues.length === 1 ? flowLiteralQueues[0].queueId : campaignQueueId);
      if (!q) missing.push(uid);
    }
    if (missing.length > 0) {
      toast.error(
        flowLiteralQueues.length > 1
          ? "Elige una cola para cada agente seleccionado."
          : "La campaña no tiene cola asignada. Edita la campaña primero.",
      );
      return;
    }
    try {
      const res = await assign([...selectedIds], [], {
        queueByUserId: { ...queueByUserId },
      });
      toast.success(
        `${res.added?.length || 0} agentes asignados${
          res.errors?.length ? ` · ${res.errors.length} errores` : ""
        }`,
      );
      if (res.errors?.length) {
        console.warn("assign errors:", res.errors);
      }
      setSelectedIds(new Set());
      setQueueByUserId({});
      setPickerOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error asignando");
    }
  };

  const handleRemove = async (userId: string, username: string) => {
    if (
      !(await confirm({
        title: `¿Desasignar ${username} de esta campaña?`,
        destructive: true,
        confirmLabel: "Desasignar",
      }))
    )
      return;
    try {
      await assign([], [userId], {});
      toast.success(`${username} desasignado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error desasignando");
    }
  };

  return (
    <Card>
      <div className="card__head">
        <div className="card__title">
          <Icon.Users size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
          Agentes asignados
        </div>
        <span className="card__sub">{agents.length} asignados</span>
        {/* Chips de modo — que se VEA que la asignación es ruteo real. */}
        {campaign.agentRouting === "exclusive" && (
          <span className="chip chip--violet" style={{ height: 20, fontSize: 10 }}>
            <Icon.User size={10} /> Exclusivo por agente
          </span>
        )}
        {campaign.directConnect === true && (
          <span className="chip chip--cyan" style={{ height: 20, fontSize: 10 }}>
            Conexión directa
          </span>
        )}
        {campaign.autoAccept === true && (
          <span className="chip chip--green" style={{ height: 20, fontSize: 10 }}>
            Auto-contestar
          </span>
        )}
        {canManage && (
          <button
            className="btn btn--sm"
            style={{ marginLeft: "auto" }}
            onClick={() => setPickerOpen(true)}
            disabled={mutating}
          >
            <Icon.Plus size={11} /> Agregar agentes
          </button>
        )}
      </div>
      <CardBody>
        {!campaignQueueId && flowLiteralQueues.length === 0 && (
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
              Esta campaña no tiene queue asignada. Edita la campaña para elegir una queue antes de
              asignar agentes.
            </span>
          </div>
        )}
        {isMultiQueueCampaign && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: "var(--accent-cyan-soft)",
              color: "var(--accent-cyan)",
              fontSize: 11.5,
              marginBottom: 10,
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <Icon.Sparkles size={12} style={{ marginTop: 1 }} />
            <span>
              Esta campaña usa routing inteligente — su flow puede mandar los leads a{" "}
              {flowLiteralQueues.length} colas distintas
              {" ("}
              {flowLiteralQueues.map((q) => q.queueName.replace(/^UDEP-/i, "")).join(", ")}
              {"). "}
              Al asignar agentes vas a elegir cuál cola atiende cada uno.
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
                vía el routing profile (sección "Agentes en esta campaña" arriba). Si quieres
                priorizar agentes específicos haz click en <strong>"Agregar agentes"</strong>.
              </>
            ) : (
              <>
                No hay agentes asignados aún. Click <strong>"Agregar agentes"</strong> para empezar
                — el sistema los configurará automáticamente para recibir llamadas de esta campaña.
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
                    {initials(a.username)}
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
                  <span className="muted mono" style={{ fontSize: 10, flexShrink: 0 }}>
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
                      title={`Queues: ${live.queues.map((q) => q.name).join(", ")}`}
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
                        <span className="muted" style={{ fontSize: 9, marginLeft: 2 }}>
                          +{live.queues.length - 4}
                        </span>
                      )}
                    </span>
                  )}
                  {a.addedQueueToRoutingProfile && (
                    <span
                      className="muted"
                      style={{ fontSize: 9.5, flexShrink: 0 }}
                      title="Cola añadida automáticamente al perfil de ruteo"
                    >
                      · auto
                    </span>
                  )}
                  <button
                    onClick={() => handleRemove(a.userId, a.username)}
                    disabled={mutating || !canManage}
                    title={canManage ? "Desasignar" : "Requiere permiso de gestión de campañas"}
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
                      ((e.currentTarget as HTMLButtonElement).style.color = "var(--accent-red)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLButtonElement).style.color = "var(--text-3)")
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Asignar agentes a la campaña</DialogTitle>
            <DialogDescription>
              {isMultiQueueCampaign ? (
                <>
                  Esta campaña enruta por <strong>udep_nivel</strong> del lead. Para cada agente
                  seleccionado, elige a qué cola va a atender (Pregrado, Posgrado, etc). Si su
                  routing profile no incluye la cola, se le agrega automáticamente.
                </>
              ) : flowQueuesLoading ? (
                "Detectando colas de la campaña…"
              ) : (
                <>
                  Los seleccionados recibirán llamadas de esta campaña. Si su routing profile no
                  incluye la queue, se agregará automáticamente.
                </>
              )}
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
              const agentQueueIds = new Set((u.queues || []).map((q) => q.id));
              return (
                <div
                  key={u.userId}
                  className={`flex items-start gap-3 rounded px-2 py-1.5 transition-colors hover:bg-muted ${
                    isSelected ? "bg-primary/10" : ""
                  }`}
                >
                  <label className="flex flex-1 cursor-pointer items-center gap-3 min-w-0">
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
                        {u.routingProfile && <span className="truncate">{u.routingProfile}</span>}
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
                              <span className="text-[9px] opacity-70">+{u.queues.length - 4}</span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                  {/* Smart-routing queue selector — only when the campaign's
                      flow has multiple queues AND this agent is selected.
                      Defaults to the queue intersection with their routing
                      profile so it matches what they're already qualified
                      for; falls back to the flow's primaryQueue. */}
                  {isMultiQueueCampaign && isSelected && (
                    <div className="flex flex-col items-end gap-1 min-w-[150px]">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                        Cola asignada
                      </span>
                      <select
                        value={queueByUserId[u.userId] || ""}
                        onChange={(e) =>
                          setQueueByUserId((q) => ({
                            ...q,
                            [u.userId]: e.target.value,
                          }))
                        }
                        className="text-xs rounded border bg-background px-2 py-1 w-full"
                        style={{ minWidth: 140 }}
                      >
                        {flowLiteralQueues.map((q) => {
                          const inProfile = agentQueueIds.has(q.queueId);
                          return (
                            <option key={q.queueId} value={q.queueId}>
                              {q.queueName.replace(/^UDEP-/i, "")}
                              {inProfile ? " ✓" : " (se agrega)"}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <button className="btn btn--ghost" onClick={() => setPickerOpen(false)}>
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
      {confirmDialog}
    </Card>
  );
}
