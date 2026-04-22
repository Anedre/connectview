import { useMemo, useRef, useState, useEffect, useLayoutEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDrop } from "react-dnd";
import {
  Phone,
  CheckCircle2,
  Headphones,
  Clock,
  Coffee,
  UserX,
  Megaphone,
  Layers,
  CheckCircle2 as CheckIcon,
  AlertTriangle,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ContactBubble, DND_BUBBLE } from "./ContactBubble";
import type { BubbleDragPayload } from "./ContactBubble";
import type { LiveAgent } from "@/hooks/useLiveQueue";
import type { PipelineContact } from "@/hooks/usePipelineStages";
import type { PipelineConfig } from "@/hooks/usePipelineConfig";
import type { FinishedBucket } from "@/hooks/useFinishedBuckets";

// ── Drag types for agent pool assignment ──────────────────────────────────
export const DND_AGENT = "pipeline-agent";

export interface AgentDragPayload {
  userId: string;
  username: string;
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface FlowViewProps {
  /** Agents actually shown in the flow (assigned to the active campaign, or
   *  all agents if no campaign context). */
  agents: LiveAgent[];
  /** Unassigned pool — rendered on the side for drag-to-assign. */
  unassignedAgents?: LiveAgent[];
  /** Banner title (usually the active campaign's name). */
  activeLabel?: string;
  arrived: PipelineContact[];
  inIvr: PipelineContact[];
  inQueueByAgent: Map<string, PipelineContact[]>;
  finishedBuckets: FinishedBucket[];
  config: PipelineConfig;
  contactToCampaign?: Map<
    string,
    { campaignId: string; campaignName: string }
  >;
  selectedIds?: string[];
  isPinned?: (contactId: string) => boolean;
  onBubbleClick?: (c: PipelineContact, event: React.MouseEvent) => void;
  onTogglePin?: (contactId: string) => void;
  onContactDroppedOnAgent?: (
    agent: LiveAgent,
    payload: BubbleDragPayload
  ) => void;
  onAgentClick?: (agent: LiveAgent) => void;
  /** Drag-drop: pool agent dropped onto campaign flow → assign. */
  onAssignAgent?: (userId: string) => void;
  /** Drag-drop: assigned agent dropped back to pool → unassign. */
  onUnassignAgent?: (userId: string) => void;
}

// ─── helpers ───────────────────────────────────────────────────────────────

function statusColor(status: string | null): string {
  if (!status) return "bg-slate-200 text-slate-700";
  const s = status.toLowerCase();
  if (s === "available") return "bg-emerald-200 text-emerald-900";
  if (s.includes("call") || s === "on call" || s === "busy")
    return "bg-blue-200 text-blue-900";
  if (s.includes("break") || s === "lunch") return "bg-amber-200 text-amber-900";
  if (s === "offline") return "bg-slate-200 text-slate-500";
  if (s === "aftercallwork" || s === "acw") return "bg-orange-200 text-orange-900";
  return "bg-slate-200 text-slate-700";
}
function statusIcon(status: string | null): React.ElementType {
  if (!status) return UserX;
  const s = status.toLowerCase();
  if (s === "available") return Headphones;
  if (s.includes("break") || s === "lunch") return Coffee;
  if (s === "offline") return UserX;
  return Phone;
}

function activeContactToBubble(a: LiveAgent): PipelineContact | null {
  if (!a.activeContact) return null;
  const ac = a.activeContact;
  const connectedMs = ac.connectedToAgentTimestamp
    ? new Date(ac.connectedToAgentTimestamp).getTime()
    : Date.now();
  return {
    contactId: ac.contactId,
    phone: ac.phone,
    customerName: null,
    channel: ac.channel,
    queueId: null,
    queueName: ac.queueName,
    initiationMethod: "",
    initiationTimestamp: null,
    state: "WITH_AGENT",
    stageEnteredAt: new Date(connectedMs).toISOString(),
    waitingSeconds: Math.max(
      0,
      Math.round((Date.now() - connectedMs) / 1000)
    ),
    agentUserId: a.userId,
    agentUsername: a.username,
  };
}

function translateRect(r: DOMRect, container: DOMRect): DOMRect {
  return new DOMRect(
    r.left - container.left,
    r.top - container.top,
    r.width,
    r.height
  );
}

// ─── Stage Block (used for Llegada, IVR) ───────────────────────────────────

function StageBlock({
  id,
  label,
  Icon,
  contacts,
  accent,
  config,
  contactToCampaign,
  selectedIds,
  isPinned,
  onBubbleClick,
  onTogglePin,
}: {
  id: string;
  label: string;
  Icon: React.ElementType;
  contacts: PipelineContact[];
  accent: { grad: string; ring: string; text: string; dot: string };
  config: PipelineConfig;
  contactToCampaign?: FlowViewProps["contactToCampaign"];
  selectedIds?: string[];
  isPinned?: (id: string) => boolean;
  onBubbleClick?: FlowViewProps["onBubbleClick"];
  onTogglePin?: FlowViewProps["onTogglePin"];
}) {
  return (
    <motion.div
      data-flow-node={id}
      layout
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={`relative mx-auto flex w-full max-w-xs flex-col rounded-2xl border bg-card/80 p-3 backdrop-blur-md shadow-sm ring-1 ${accent.ring}`}
    >
      {/* Connection handle (top dot — looks like Connect flow builder) */}
      <span
        data-handle={`${id}-top`}
        className={`absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-background ${accent.dot}`}
      />
      {/* Connection handle (bottom dot) */}
      <span
        data-handle={`${id}-bottom`}
        className={`absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-background ${accent.dot}`}
      />

      <div className="mb-1.5 flex items-center gap-2">
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br ${accent.grad} text-white shadow-sm`}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1">
          <div className={`text-sm font-semibold ${accent.text}`}>{label}</div>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {contacts.length}
        </Badge>
      </div>
      <div className="flex min-h-[32px] flex-wrap items-start gap-1 rounded-lg bg-muted/30 p-1.5">
        <AnimatePresence mode="popLayout" initial={false}>
          {contacts.length === 0 ? (
            <span className="w-full py-1 text-center text-[10px] italic text-muted-foreground/50">
              sin contactos
            </span>
          ) : (
            contacts.slice(0, 40).map((c) => (
              <ContactBubble
                key={c.campaignRowId || c.contactId}
                contact={c}
                compact={config.compact}
                warnSeconds={config.warnSeconds}
                urgentSeconds={config.urgentSeconds}
                campaignInfo={contactToCampaign?.get(c.contactId)}
                pinned={isPinned?.(c.contactId)}
                selected={selectedIds?.includes(c.contactId)}
                selectionIds={selectedIds}
                onClick={onBubbleClick}
                onTogglePin={onTogglePin}
              />
            ))
          )}
        </AnimatePresence>
        {contacts.length > 40 && (
          <span className="text-[10px] text-muted-foreground">
            +{contacts.length - 40}
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ─── Agent Column (Queue block + Agent block) ──────────────────────────────

function AgentColumn({
  agent,
  inQueueForMe,
  config,
  contactToCampaign,
  selectedIds,
  isPinned,
  onBubbleClick,
  onTogglePin,
  onContactDroppedOnAgent,
  onUnassignAgent,
  onAgentClick,
  draggable,
}: {
  agent: LiveAgent;
  inQueueForMe: PipelineContact[];
  config: PipelineConfig;
  contactToCampaign?: FlowViewProps["contactToCampaign"];
  selectedIds?: string[];
  isPinned?: (id: string) => boolean;
  onBubbleClick?: FlowViewProps["onBubbleClick"];
  onTogglePin?: FlowViewProps["onTogglePin"];
  onContactDroppedOnAgent?: FlowViewProps["onContactDroppedOnAgent"];
  onUnassignAgent?: FlowViewProps["onUnassignAgent"];
  onAgentClick?: FlowViewProps["onAgentClick"];
  /** When true the agent block is draggable back to the unassigned pool. */
  draggable?: boolean;
}) {
  const canReceive =
    agent.statusName?.toLowerCase() === "available" && !agent.activeContact;
  const active = activeContactToBubble(agent);

  const [{ isOver, canDrop }, dropRef] = useDrop(
    () => ({
      accept: DND_BUBBLE,
      canDrop: () => canReceive,
      drop: (item: BubbleDragPayload) => {
        if (canReceive) onContactDroppedOnAgent?.(agent, item);
      },
      collect: (m) => ({ isOver: m.isOver(), canDrop: m.canDrop() }),
    }),
    [agent.userId, canReceive, onContactDroppedOnAgent]
  );

  // When `draggable`, the agent block itself can be dragged to the
  // unassigned pool to remove them from the campaign.
  const Icon = statusIcon(agent.statusName);

  return (
    <motion.div
      layout
      className="flex min-w-[200px] max-w-[220px] shrink-0 flex-col gap-2"
      onDoubleClick={() => draggable && onUnassignAgent?.(agent.userId)}
    >
      {/* QUEUE BLOCK */}
      <motion.div
        data-flow-node-queue={agent.userId}
        whileHover={{ y: -2 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="relative rounded-2xl border bg-card/80 p-2 backdrop-blur-md shadow-sm ring-1 ring-sky-200/60 dark:ring-sky-900/40"
      >
        <span
          data-handle={`queue-${agent.userId}-top`}
          className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-background bg-sky-500"
        />
        <span
          data-handle={`queue-${agent.userId}-bottom`}
          className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-background bg-sky-500"
        />
        <div className="mb-1 flex items-center gap-1.5">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-sky-400 to-blue-500 text-white">
            <Clock className="h-3 w-3" />
          </div>
          <span className="truncate text-[11px] font-semibold text-sky-900 dark:text-sky-200">
            Cola · {agent.username}
          </span>
          <Badge className="ml-auto bg-sky-100 text-[9px] text-sky-800 dark:bg-sky-950 dark:text-sky-200">
            {inQueueForMe.length}
          </Badge>
        </div>
        <div className="flex min-h-[32px] flex-wrap items-start gap-1 rounded-md bg-muted/30 p-1.5">
          <AnimatePresence mode="popLayout" initial={false}>
            {inQueueForMe.length === 0 ? (
              <span className="w-full py-1 text-center text-[10px] italic text-muted-foreground/50">
                sin espera
              </span>
            ) : (
              inQueueForMe.map((c) => (
                <ContactBubble
                  key={`${agent.userId}-${c.campaignRowId || c.contactId}`}
                  contact={c}
                  compact={config.compact}
                  warnSeconds={config.warnSeconds}
                  urgentSeconds={config.urgentSeconds}
                  campaignInfo={contactToCampaign?.get(c.contactId)}
                  pinned={isPinned?.(c.contactId)}
                  selected={selectedIds?.includes(c.contactId)}
                  selectionIds={selectedIds}
                  onClick={onBubbleClick}
                  onTogglePin={onTogglePin}
                />
              ))
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* AGENT BLOCK */}
      <motion.div
        ref={dropRef as unknown as React.Ref<HTMLDivElement>}
        data-flow-node-agent={agent.userId}
        layout
        whileHover={{ y: -2 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        onClick={() => onAgentClick?.(agent)}
        className={`relative cursor-pointer rounded-2xl border bg-card p-2.5 text-[11px] backdrop-blur-md shadow-sm transition-all ${
          isOver && canDrop
            ? "ring-4 ring-emerald-400/60 scale-[1.02]"
            : isOver && !canDrop
              ? "ring-4 ring-rose-400/40"
              : canReceive
                ? "ring-1 ring-emerald-200/60"
                : "ring-1 ring-border/60"
        }`}
      >
        <span
          data-handle={`agent-${agent.userId}-top`}
          className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-background bg-emerald-500"
        />

        <div className="flex items-center gap-1.5">
          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${statusColor(agent.statusName)}`}>
            <Icon className="h-3 w-3" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{agent.username}</div>
            <Badge className={`${statusColor(agent.statusName)} text-[9px]`}>
              {agent.statusName || "Offline"}
            </Badge>
          </div>
        </div>

        {active ? (
          <div className="mt-1.5 flex justify-center">
            <ContactBubble
              contact={active}
              compact={config.compact}
              warnSeconds={config.warnSeconds}
              urgentSeconds={config.urgentSeconds}
              campaignInfo={contactToCampaign?.get(active.contactId)}
              pinned={isPinned?.(active.contactId)}
              selected={selectedIds?.includes(active.contactId)}
              selectionIds={selectedIds}
              onClick={onBubbleClick}
              onTogglePin={onTogglePin}
            />
          </div>
        ) : (
          <div className="mt-1.5 py-1 text-center text-[10px] italic text-muted-foreground/50">
            {canReceive ? "disponible · drop ↓" : "idle"}
          </div>
        )}

        <div className="mt-1.5 flex items-center justify-between gap-1 border-t pt-1 text-[9px]">
          <div className="flex flex-wrap items-center gap-0.5">
            <Layers className="h-2.5 w-2.5 text-muted-foreground" />
            {(agent.queues || []).slice(0, 2).map((q) => (
              <span
                key={q.id}
                className="rounded bg-sky-100 px-1 text-[8px] text-sky-800 dark:bg-sky-950 dark:text-sky-200"
              >
                {q.name.length > 8 ? q.name.slice(0, 7) + "…" : q.name}
              </span>
            ))}
            {(agent.queues?.length || 0) > 2 && (
              <span className="text-[8px] text-muted-foreground">
                +{agent.queues!.length - 2}
              </span>
            )}
          </div>
          {agent.stats && (
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-0.5 text-emerald-700 dark:text-emerald-300">
                <CheckIcon className="h-2.5 w-2.5" />
                {agent.stats.completedToday}
              </span>
              <span
                className={`flex items-center gap-0.5 ${
                  agent.stats.errorsToday > 0
                    ? "text-rose-700 dark:text-rose-300"
                    : "text-muted-foreground"
                }`}
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                {agent.stats.errorsToday}
              </span>
            </div>
          )}
        </div>

        {agent.activeContact && contactToCampaign?.get(agent.activeContact.contactId) && (
          <div className="mt-1 flex items-center gap-0.5 text-[9px] text-orange-700 dark:text-orange-300">
            <Megaphone className="h-2.5 w-2.5" />
            {contactToCampaign.get(agent.activeContact.contactId)!.campaignName}
          </div>
        )}

        {draggable && (
          <div className="absolute top-1 right-1 text-[8px] text-muted-foreground/60">
            doble-click: quitar
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── Unassigned Agent Pool ─────────────────────────────────────────────────

function UnassignedPool({
  agents,
  onAssignAgent,
}: {
  agents: LiveAgent[];
  onAssignAgent?: FlowViewProps["onAssignAgent"];
}) {
  return (
    <div className="rounded-2xl border border-dashed bg-muted/20 p-3 backdrop-blur-sm">
      <div className="mb-2 flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">
          Agentes sin asignar ({agents.length})
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground italic">
          doble-click para asignar
        </span>
      </div>
      {agents.length === 0 ? (
        <div className="py-3 text-center text-xs italic text-muted-foreground">
          Todos asignados a la campaña.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {agents.map((a) => {
            const Icon = statusIcon(a.statusName);
            return (
              <button
                type="button"
                key={a.userId}
                onDoubleClick={() => onAssignAgent?.(a.userId)}
                title={`Doble-click para asignar ${a.username} a la campaña`}
                className={`group flex items-center gap-1.5 rounded-full border bg-card px-2 py-1 text-[11px] transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-95`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full ${statusColor(
                    a.statusName
                  )}`}
                >
                  <Icon className="h-2.5 w-2.5" />
                </span>
                <span className="font-medium">{a.username}</span>
                <UserPlus className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main FlowView ─────────────────────────────────────────────────────────

type Edge = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  active: boolean;
  colorFrom: string;
  colorTo: string;
};

export function FlowView({
  agents,
  unassignedAgents = [],
  activeLabel,
  arrived,
  inIvr,
  inQueueByAgent,
  finishedBuckets,
  config,
  contactToCampaign,
  selectedIds,
  isPinned,
  onBubbleClick,
  onTogglePin,
  onContactDroppedOnAgent,
  onAssignAgent,
  onUnassignAgent,
  onAgentClick,
}: FlowViewProps) {
  const sorted = useMemo(
    () =>
      [...agents].sort((a, b) => {
        const score = (x: LiveAgent) => {
          const st = (x.statusName || "offline").toLowerCase();
          if (st === "available" && !x.activeContact) return 0;
          if (x.activeContact) return 1;
          if (st === "aftercallwork" || st === "acw") return 2;
          if (st.includes("break") || st === "lunch") return 3;
          if (st === "offline") return 5;
          return 4;
        };
        return score(a) - score(b);
      }),
    [agents]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edge[]>([]);

  const recomputeEdges = () => {
    if (!containerRef.current) return;
    const box = containerRef.current.getBoundingClientRect();
    const handle = (sel: string): { x: number; y: number } | null => {
      const el = containerRef.current!.querySelector(sel);
      if (!el) return null;
      const r = translateRect(el.getBoundingClientRect(), box);
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      // If the handle is outside the visible container (e.g. the agent
      // column scrolled off the horizontal strip) we skip the edge rather
      // than drawing a line into empty space.
      if (x < 0 || x > box.width || y < -20 || y > box.height + 20) return null;
      return { x, y };
    };

    const next: Edge[] = [];
    const arrivedOut = handle('[data-handle="arrived-bottom"]');
    const ivrIn = handle('[data-handle="ivr-top"]');
    const ivrOut = handle('[data-handle="ivr-bottom"]');

    // 1. Llegada -> IVR
    if (arrivedOut && ivrIn) {
      next.push({
        fromX: arrivedOut.x,
        fromY: arrivedOut.y,
        toX: ivrIn.x,
        toY: ivrIn.y,
        active: arrived.length > 0,
        colorFrom: "#f59e0b",
        colorTo: "#a855f7",
      });
    }

    // 2. IVR -> each agent's queue (fan-out)
    if (ivrOut) {
      for (const a of sorted) {
        const q = handle(`[data-handle="queue-${a.userId}-top"]`);
        if (q) {
          const hasTraffic =
            inIvr.length > 0 || (inQueueByAgent.get(a.userId) || []).length > 0;
          next.push({
            fromX: ivrOut.x,
            fromY: ivrOut.y,
            toX: q.x,
            toY: q.y,
            active: hasTraffic,
            colorFrom: "#a855f7",
            colorTo: "#0ea5e9",
          });
        }
      }
    }

    // 3. Queue -> Agent per column
    for (const a of sorted) {
      const qOut = handle(`[data-handle="queue-${a.userId}-bottom"]`);
      const aIn = handle(`[data-handle="agent-${a.userId}-top"]`);
      if (qOut && aIn) {
        next.push({
          fromX: qOut.x,
          fromY: qOut.y,
          toX: aIn.x,
          toY: aIn.y,
          active: !!a.activeContact,
          colorFrom: "#0ea5e9",
          colorTo: "#10b981",
        });
      }
    }
    setEdges(next);
  };

  useLayoutEffect(() => {
    recomputeEdges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted.length, arrived.length, inIvr.length, finishedBuckets.length]);

  useEffect(() => {
    const handler = () => recomputeEdges();
    window.addEventListener("resize", handler);
    const timer = setInterval(handler, 1500);
    return () => {
      window.removeEventListener("resize", handler);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-xl border bg-gradient-to-b from-background via-background/60 to-muted/30 p-4"
    >
      {activeLabel && (
        <div className="mb-3 flex items-center justify-center">
          <span className="rounded-full bg-gradient-to-r from-sky-500 to-cyan-500 px-3 py-1 text-xs font-semibold text-white shadow-sm">
            {activeLabel}
          </span>
        </div>
      )}

      {/* PENDIENTES (reuses the IN_IVR slot — label re-targeted for outbound campaigns) */}
      <div className="mb-10">
        <StageBlock
          id="arrived"
          label="Pendientes"
          Icon={Clock}
          contacts={inIvr}
          accent={{
            grad: "from-amber-400 to-orange-500",
            ring: "ring-amber-200/70 dark:ring-amber-800/50",
            text: "text-amber-900 dark:text-amber-200",
            dot: "bg-amber-500",
          }}
          config={config}
          contactToCampaign={contactToCampaign}
          selectedIds={selectedIds}
          isPinned={isPinned}
          onBubbleClick={onBubbleClick}
          onTogglePin={onTogglePin}
        />
      </div>

      {/* MARCANDO (reuses the ARRIVED slot — dialing rows from campaign dialer) */}
      <div className="mb-10">
        <StageBlock
          id="ivr"
          label="Marcando"
          Icon={Phone}
          contacts={arrived}
          accent={{
            grad: "from-violet-500 to-purple-600",
            ring: "ring-violet-200/70 dark:ring-violet-800/50",
            text: "text-violet-900 dark:text-violet-200",
            dot: "bg-violet-500",
          }}
          config={config}
          contactToCampaign={contactToCampaign}
          selectedIds={selectedIds}
          isPinned={isPinned}
          onBubbleClick={onBubbleClick}
          onTogglePin={onTogglePin}
        />
      </div>

      {/* Agent columns fan-out */}
      <div className="flex justify-start gap-3 overflow-x-auto pb-2">
        {sorted.length === 0 ? (
          <div className="flex min-h-[140px] w-full items-center justify-center rounded-xl border border-dashed text-sm italic text-muted-foreground">
            Arrastrá o doble-click agentes desde el panel abajo para asignarlos
            a la campaña
          </div>
        ) : (
          sorted.map((a) => (
            <AgentColumn
              key={a.userId}
              agent={a}
              inQueueForMe={inQueueByAgent.get(a.userId) || []}
              config={config}
              contactToCampaign={contactToCampaign}
              selectedIds={selectedIds}
              isPinned={isPinned}
              onBubbleClick={onBubbleClick}
              onTogglePin={onTogglePin}
              onContactDroppedOnAgent={onContactDroppedOnAgent}
              onAgentClick={onAgentClick}
              onUnassignAgent={onUnassignAgent}
              draggable={!!onUnassignAgent}
            />
          ))
        )}
      </div>

      {/* Unassigned pool */}
      {(onAssignAgent || unassignedAgents.length > 0) && (
        <div className="mt-6">
          <UnassignedPool
            agents={unassignedAgents}
            onAssignAgent={onAssignAgent}
          />
        </div>
      )}

      {/* Finished buckets */}
      <div className="mt-8 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
        {finishedBuckets.map((b) => (
          <div
            key={b.id}
            className={`rounded-2xl border bg-card/80 p-2 backdrop-blur-md shadow-sm ring-1 ${b.ring}`}
          >
            <div className="mb-1 flex items-center gap-1">
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-md ${b.color}`}
              >
                <CheckCircle2 className="h-3 w-3" />
              </div>
              <span className="truncate text-[11px] font-semibold">
                {b.label}
              </span>
              <Badge className={`ml-auto text-[9px] ${b.color}`} variant="outline">
                {b.contacts.length}
              </Badge>
            </div>
            <div className="mb-1 truncate text-[9px] text-muted-foreground">
              {b.hint}
            </div>
            <div className="flex min-h-[32px] flex-wrap items-start gap-1 rounded-md bg-muted/30 p-1.5">
              <AnimatePresence mode="popLayout" initial={false}>
                {b.contacts.length === 0 ? (
                  <span className="w-full py-1 text-center text-[10px] italic text-muted-foreground/50">
                    vacío
                  </span>
                ) : (
                  b.contacts.slice(0, 20).map((c) => (
                    <ContactBubble
                      key={`${b.id}-${c.campaignRowId || c.contactId}`}
                      contact={c}
                      compact={config.compact}
                      warnSeconds={config.warnSeconds}
                      urgentSeconds={config.urgentSeconds}
                      campaignInfo={contactToCampaign?.get(c.contactId)}
                      pinned={isPinned?.(c.contactId)}
                      selected={selectedIds?.includes(c.contactId)}
                      selectionIds={selectedIds}
                      onClick={onBubbleClick}
                      onTogglePin={onTogglePin}
                    />
                  ))
                )}
              </AnimatePresence>
              {b.contacts.length > 20 && (
                <span className="text-[9px] text-muted-foreground">
                  +{b.contacts.length - 20} más
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── SVG overlay: modern Connect-flow-style connectors ──
          Clipped to the container bounds so edges to agents that scrolled
          out of the horizontal strip don't bleed into the rest of the page. */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ zIndex: 1, overflow: "hidden" }}
      >
        <defs>
          {edges.map((e, i) => (
            <linearGradient
              key={`grad-${i}`}
              id={`edge-grad-${i}`}
              x1={e.fromX}
              y1={e.fromY}
              x2={e.toX}
              y2={e.toY}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor={e.colorFrom} />
              <stop offset="100%" stopColor={e.colorTo} />
            </linearGradient>
          ))}
          <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        {edges.map((e, i) => {
          const dx = Math.abs(e.toX - e.fromX);
          const dy = Math.abs(e.toY - e.fromY);
          // Smooth cubic bezier: control points offset vertically for fan-out feel.
          const c1x = e.fromX;
          const c1y = e.fromY + Math.max(20, dy * 0.5);
          const c2x = e.toX;
          const c2y = e.toY - Math.max(20, dy * 0.5);
          const d = `M ${e.fromX} ${e.fromY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${e.toX} ${e.toY}`;
          const isHovered = hoveredEdge === i;
          return (
            <g
              key={i}
              onMouseEnter={() => setHoveredEdge(i)}
              onMouseLeave={() => setHoveredEdge(null)}
              style={{ pointerEvents: "stroke" }}
            >
              {/* Glow halo (only when active) */}
              {e.active && (
                <path
                  d={d}
                  fill="none"
                  stroke={`url(#edge-grad-${i})`}
                  strokeWidth={isHovered ? 10 : 6}
                  strokeLinecap="round"
                  opacity={0.25}
                  filter="url(#soft-glow)"
                />
              )}
              {/* Main line */}
              <path
                d={d}
                fill="none"
                stroke={e.active ? `url(#edge-grad-${i})` : "rgb(148 163 184 / 0.35)"}
                strokeWidth={isHovered ? 3 : e.active ? 2 : 1.2}
                strokeLinecap="round"
              />
              {/* Animated dot flowing along the path (only when active) */}
              {e.active && (
                <circle r={3} fill={e.colorTo} opacity={0.95}>
                  <animateMotion
                    dur={`${isHovered ? 1.2 : 1.8}s`}
                    repeatCount="indefinite"
                    path={d}
                    rotate="auto"
                  />
                </circle>
              )}
              {e.active && dx > 60 && (
                <circle r={2} fill={e.colorFrom} opacity={0.8}>
                  <animateMotion
                    dur={`${isHovered ? 1.2 : 1.8}s`}
                    repeatCount="indefinite"
                    begin="-0.6s"
                    path={d}
                    rotate="auto"
                  />
                </circle>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
