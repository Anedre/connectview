import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDrop } from "react-dnd";
import { initials } from "@/lib/initials";
import {
  Phone,
  Headphones,
  Clock,
  Coffee,
  UserX,
  PhoneCall,
  AlertTriangle,
  Hourglass,
  PhoneIncoming,
  UserPlus,
} from "lucide-react";
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
  /** Agents shown as primary cards (assigned to the active campaign, or
   *  the general agent pool if no campaign context). */
  agents: LiveAgent[];
  /** Unassigned pool — rendered as a slim dock at the bottom. */
  unassignedAgents?: LiveAgent[];
  /** Banner title (usually the active campaign's name). */
  activeLabel?: string;
  arrived: PipelineContact[];
  inIvr: PipelineContact[];
  inQueueByAgent: Map<string, PipelineContact[]>;
  /** Per-agent pre-assigned bucket (FIFO oldest-first = next to dial). */
  pendingBucketByAgent?: Map<string, PipelineContact[]>;
  /** Pending contacts NOT yet assigned to any agent. */
  unassignedPending?: PipelineContact[];
  /** Campaign's maxContactsPerAgent — used for "X/N" capacity hints. */
  maxContactsPerAgent?: number;
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

// ─── status helpers ────────────────────────────────────────────────────────

interface StatusMeta {
  label: string;
  Icon: React.ElementType;
  /** Single accent dot color — the only color signal we keep for status. */
  dot: string;
}

function statusMeta(status: string | null): StatusMeta {
  const s = (status || "").toLowerCase();
  if (s === "available") {
    return { label: "Available", Icon: Headphones, dot: "bg-[var(--accent-green)]" };
  }
  if (s.includes("call") || s === "on call" || s === "busy") {
    return { label: "En llamada", Icon: Phone, dot: "bg-[var(--accent-cyan)]" };
  }
  if (s === "aftercallwork" || s === "acw") {
    return { label: "ACW", Icon: Phone, dot: "bg-[var(--accent-amber)]" };
  }
  if (s.includes("break") || s === "lunch") {
    return { label: "Break", Icon: Coffee, dot: "bg-[var(--accent-amber)]" };
  }
  if (s === "offline") {
    return { label: "Offline", Icon: UserX, dot: "bg-muted-foreground/40" };
  }
  return { label: status || "—", Icon: AlertTriangle, dot: "bg-muted-foreground/40" };
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

// ─── StageStrip ────────────────────────────────────────────────────────────
// Horizontal funnel at the top showing the four campaign stages with counts
// and a small preview of the bubbles inside each. Replaces the previous
// vertical "Pendientes → Marcando" flowchart that took two screens to read.

interface StageDef {
  id: string;
  label: string;
  hint: string;
  Icon: React.ElementType;
  contacts: PipelineContact[];
}

function StageStrip({
  stages,
  config,
  contactToCampaign,
  selectedIds,
  isPinned,
  onBubbleClick,
  onTogglePin,
}: {
  stages: StageDef[];
  config: PipelineConfig;
  contactToCampaign?: FlowViewProps["contactToCampaign"];
  selectedIds?: string[];
  isPinned?: (id: string) => boolean;
  onBubbleClick?: FlowViewProps["onBubbleClick"];
  onTogglePin?: FlowViewProps["onTogglePin"];
}) {
  // Hero stage strip: 4 huge numbers in a row, generous padding, label
  // underneath in tracked caps. No cards / borders. The eye sees the
  // numbers FIRST and then reads the labels — proper visual hierarchy.
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-8 md:grid-cols-4">
      {stages.map((stage) => {
        const isActive = stage.contacts.length > 0;
        return (
          <div key={stage.id} className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span
                className={`text-5xl font-semibold tabular-nums tracking-tight ${
                  isActive ? "text-foreground" : "text-muted-foreground/25"
                }`}
              >
                {stage.contacts.length}
              </span>
              <stage.Icon className="h-4 w-4 text-muted-foreground/40" />
            </div>
            <div className="mt-3">
              <div className="text-xs font-medium uppercase tracking-[0.1em] text-foreground/80">
                {stage.label}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {stage.hint}
              </div>
            </div>
            {stage.contacts.length > 0 && (
              <div className="mt-3 flex flex-wrap items-start gap-1">
                <AnimatePresence mode="popLayout" initial={false}>
                  {stage.contacts.slice(0, 6).map((c) => (
                    <ContactBubble
                      key={`stage-${stage.id}-${c.campaignRowId || c.contactId}`}
                      contact={c}
                      compact
                      warnSeconds={config.warnSeconds}
                      urgentSeconds={config.urgentSeconds}
                      campaignInfo={contactToCampaign?.get(c.contactId)}
                      pinned={isPinned?.(c.contactId)}
                      selected={selectedIds?.includes(c.contactId)}
                      selectionIds={selectedIds}
                      onClick={onBubbleClick}
                      onTogglePin={onTogglePin}
                    />
                  ))}
                </AnimatePresence>
                {stage.contacts.length > 6 && (
                  <span className="text-xs text-muted-foreground">
                    +{stage.contacts.length - 6}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── AgentRowCard ──────────────────────────────────────────────────────────
// Each agent is one wide card: avatar + name + status on the left, then
// three inline sections (bucket / cola Connect / llamada actual) on the
// right separated by chevrons. Replaces the previous vertical stack of
// queue-then-agent blocks plus the SVG connectors.

function AgentRowCard({
  agent,
  bucket,
  bucketCapacity,
  inQueueForMe,
  config,
  contactToCampaign,
  selectedIds,
  isPinned,
  onBubbleClick,
  onTogglePin,
  onContactDroppedOnAgent,
  onAgentClick,
  onUnassignAgent,
}: {
  agent: LiveAgent;
  bucket: PipelineContact[];
  bucketCapacity?: number;
  inQueueForMe: PipelineContact[];
  config: PipelineConfig;
  contactToCampaign?: FlowViewProps["contactToCampaign"];
  selectedIds?: string[];
  isPinned?: (id: string) => boolean;
  onBubbleClick?: FlowViewProps["onBubbleClick"];
  onTogglePin?: FlowViewProps["onTogglePin"];
  onContactDroppedOnAgent?: FlowViewProps["onContactDroppedOnAgent"];
  onAgentClick?: FlowViewProps["onAgentClick"];
  onUnassignAgent?: FlowViewProps["onUnassignAgent"];
}) {
  const meta = statusMeta(agent.statusName);
  const Icon = meta.Icon;
  const canReceive =
    agent.statusName?.toLowerCase() === "available" && !agent.activeContact;
  const activeBubble = activeContactToBubble(agent);

  // Surface a clear warning when an agent has leads queued in their bucket
  // but isn't actually online — the dialer can't reach them and the
  // bucket will just sit waiting. Without this banner the admin sees a
  // bucket "1/3" with no indication of why nothing is dialing.
  const isOfflineWithWork =
    (agent.statusName || "").toLowerCase() === "offline" &&
    (bucket.length > 0 || (bucketCapacity || 0) > 0);

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

  // Connect queue names this agent is routed to (first 2, +N).
  const queueLabel = useMemo(() => {
    const list = (agent.queues || []).map((q) => q.name).filter(Boolean);
    if (list.length === 0) return "Sin colas asignadas";
    if (list.length <= 2) return list.join(", ");
    return `${list.slice(0, 2).join(", ")} +${list.length - 2}`;
  }, [agent.queues]);

  return (
    <motion.div
      ref={dropRef as unknown as React.Ref<HTMLDivElement>}
      layout
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      onClick={() => onAgentClick?.(agent)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onUnassignAgent?.(agent.userId);
      }}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-card transition ${
        isOver && canDrop
          ? "border-[var(--accent-green)] ring-2 ring-[var(--accent-green-soft)]"
          : isOver && !canDrop
            ? "border-[var(--accent-red)] ring-2 ring-[var(--accent-red-soft)]"
            : "hover:border-foreground/30"
      }`}
      title={
        canReceive
          ? `Arrastrá un contacto aquí para transferir a ${agent.username}`
          : undefined
      }
    >
      {isOfflineWithWork && (
        <div className="flex items-center gap-2 border-b border-[var(--accent-amber-soft)] bg-[var(--accent-amber-soft)] px-5 py-2 text-xs text-[var(--accent-amber)]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium">Offline</span> — sus leads no se
            marcan hasta que esté Available
          </span>
        </div>
      )}

      {/* ── Identity row: large avatar + name + status ────────────── */}
      <div className="flex items-center gap-4 px-6 pt-6 pb-4">
        <div className="relative">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border bg-muted/40 text-lg font-medium text-foreground">
            {initials(agent.username)}
          </div>
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background ${meta.dot}`}
            title={meta.label}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold leading-tight">
            {agent.username}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0 text-xs text-muted-foreground">
            <span className="font-medium">{meta.label}</span>
            {queueLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{queueLabel}</span>
              </>
            )}
          </div>
        </div>
        {/* Use the icon var so eslint doesn't flag the unused destructure. */}
        <Icon className="hidden h-0 w-0" aria-hidden="true" />
      </div>

      {/* ── Active call hero — when present, takes prominence ───── */}
      {activeBubble && (
        <div className="border-t bg-muted/20 px-6 py-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            En llamada
          </div>
          <div className="mt-2">
            <ContactBubble
              contact={activeBubble}
              compact={config.compact}
              warnSeconds={config.warnSeconds}
              urgentSeconds={config.urgentSeconds}
              campaignInfo={contactToCampaign?.get(activeBubble.contactId)}
              pinned={isPinned?.(activeBubble.contactId)}
              selected={selectedIds?.includes(activeBubble.contactId)}
              selectionIds={selectedIds}
              onClick={onBubbleClick}
              onTogglePin={onTogglePin}
            />
          </div>
        </div>
      )}

      {/* ── Bucket / queue stats ─────────────────────────────────── */}
      <div className="grid grid-cols-2 divide-x border-t">
        {(bucketCapacity || bucket.length > 0) && (
          <div className="px-6 py-4">
            <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Su cola asignada
            </div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span
                className={`text-3xl font-semibold tabular-nums ${
                  bucket.length > 0
                    ? "text-foreground"
                    : "text-muted-foreground/30"
                }`}
              >
                {bucket.length}
              </span>
              {bucketCapacity && (
                <span className="text-base text-muted-foreground/50 tabular-nums">
                  / {bucketCapacity}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-start gap-1">
              {bucket.length === 0 ? (
                <span className="text-[11px] text-muted-foreground/50">
                  esperando asignación
                </span>
              ) : (
                <>
                  <AnimatePresence mode="popLayout" initial={false}>
                    {bucket.slice(0, 8).map((c, i) => (
                      <ContactBubble
                        key={`bucket-${agent.userId}-${c.campaignRowId || c.contactId}`}
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
                        highlighted={i === 0}
                      />
                    ))}
                  </AnimatePresence>
                  {bucket.length > 8 && (
                    <span className="self-center text-[10px] text-muted-foreground">
                      +{bucket.length - 8}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div className="px-6 py-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Hoy
          </div>
          <div className="mt-1.5 flex items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums">
              {agent.stats?.completedToday ?? 0}
            </span>
            <span className="text-sm text-muted-foreground">completadas</span>
          </div>
          {agent.stats && agent.stats.errorsToday > 0 && (
            <div className="mt-2 text-xs text-[var(--accent-red)]">
              <span className="font-medium tabular-nums">
                {agent.stats.errorsToday}
              </span>{" "}
              error{agent.stats.errorsToday === 1 ? "" : "es"} hoy
            </div>
          )}
          {inQueueForMe.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium tabular-nums text-foreground">
                {inQueueForMe.length}
              </span>{" "}
              en espera Connect
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── UnassignedAgentsDock ──────────────────────────────────────────────────
// Slim, collapsible-feeling pool at the bottom. Same drag affordances as
// before but visually quieter — these agents aren't doing anything for
// THIS campaign, they're a "roster".

function UnassignedAgentsDock({
  agents,
  onAssignAgent,
}: {
  agents: LiveAgent[];
  onAssignAgent?: FlowViewProps["onAssignAgent"];
}) {
  const isAssignable = typeof onAssignAgent === "function";
  if (agents.length === 0 && !isAssignable) return null;
  if (agents.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">
        Todos los agentes están asignados a la campaña.
      </p>
    );
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {agents.map((a) => {
          const meta = statusMeta(a.statusName);
          return (
            <button
              type="button"
              key={a.userId}
              onDoubleClick={
                isAssignable ? () => onAssignAgent?.(a.userId) : undefined
              }
              title={
                isAssignable
                  ? `Doble-click para asignar ${a.username}`
                  : `${a.username} · ${meta.label}`
              }
              className={`group flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs transition ${
                isAssignable
                  ? "hover:border-foreground/30 hover:bg-muted/40"
                  : "opacity-60"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              <span className="font-medium">{a.username}</span>
              {isAssignable && (
                <UserPlus className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              )}
            </button>
          );
        })}
      </div>
      {isAssignable && (
        <p className="mt-2 text-[10px] italic text-muted-foreground/60">
          Doble-click un agente para asignarlo a la campaña.
        </p>
      )}
    </div>
  );
}

// ─── ResultsStrip ──────────────────────────────────────────────────────────
// Finished buckets used to be 5 large boxes taking a whole row. Now they
// are inline chips — one line, much less weight, still scannable.

function ResultsStrip({
  buckets,
  config,
  contactToCampaign,
  selectedIds,
  isPinned,
  onBubbleClick,
  onTogglePin,
}: {
  buckets: FinishedBucket[];
  config: PipelineConfig;
  contactToCampaign?: FlowViewProps["contactToCampaign"];
  selectedIds?: string[];
  isPinned?: (id: string) => boolean;
  onBubbleClick?: FlowViewProps["onBubbleClick"];
  onTogglePin?: FlowViewProps["onTogglePin"];
}) {
  const hasAny = buckets.some((b) => b.contacts.length > 0);
  if (!hasAny) {
    return (
      <p className="text-xs italic text-muted-foreground/60">
        Aún sin contactos terminados.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {buckets.map((b) => (
        <details
          key={b.id}
          className="min-w-0 rounded-md border bg-card px-2 py-1"
        >
          <summary
            className={`flex cursor-pointer list-none items-center gap-1.5 text-[11px] ${
              b.contacts.length === 0 ? "opacity-50" : ""
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${b.color}`} />
            <span className="font-medium">{b.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {b.contacts.length}
            </span>
          </summary>
          {b.contacts.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-start gap-1">
              {b.contacts.slice(0, 20).map((c) => (
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
              ))}
              {b.contacts.length > 20 && (
                <span className="text-[9px] text-muted-foreground">
                  +{b.contacts.length - 20} más
                </span>
              )}
            </div>
          )}
        </details>
      ))}
    </div>
  );
}

// ─── Main FlowView ─────────────────────────────────────────────────────────

export function FlowView({
  agents,
  unassignedAgents = [],
  activeLabel,
  arrived,
  inIvr,
  inQueueByAgent,
  pendingBucketByAgent,
  unassignedPending,
  maxContactsPerAgent,
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

  // Top-funnel data. When the campaign uses buckets, the global "Pendientes"
  // tile reflects only the unassigned pool (rows already bucketed live
  // under their agent's card instead). When buckets are absent, fall back
  // to the full pending list so the old behaviour is preserved.
  const topPending =
    unassignedPending !== undefined ? unassignedPending : inIvr;

  // Aggregate active calls across agents for the "Con agente" stage tile.
  const allActiveCalls = useMemo(() => {
    return sorted
      .map(activeContactToBubble)
      .filter((c): c is PipelineContact => !!c);
  }, [sorted]);

  // Aggregate all queue contacts across agents for the "En cola" tile.
  const allInQueue = useMemo(() => {
    const out: PipelineContact[] = [];
    const seen = new Set<string>();
    for (const list of inQueueByAgent.values()) {
      for (const c of list) {
        if (!seen.has(c.contactId)) {
          seen.add(c.contactId);
          out.push(c);
        }
      }
    }
    return out;
  }, [inQueueByAgent]);

  // Stage labels reflect the actual Connect lifecycle honestly. The
  // intermediate "espera de agente" stage only fills when an agent isn't
  // immediately available — when one is, Connect routes the call directly
  // and the bubble appears to jump from dialing to with-agent, because in
  // reality the IN_QUEUE state was sub-second. The labels make this
  // explicit so the admin understands what they're seeing.
  const stages: StageDef[] = [
    {
      id: "pool",
      label:
        unassignedPending !== undefined ? "Pool sin asignar" : "Pendientes",
      hint: "Leads esperando ser asignados",
      Icon: Hourglass,
      contacts: topPending,
    },
    {
      id: "dialing",
      label: "Marcando",
      hint: "Dialer + welcome TTS + AMD",
      Icon: PhoneIncoming,
      contacts: arrived,
    },
    {
      id: "in-queue",
      label: "En espera",
      hint: "Cliente atendió, agentes ocupados",
      Icon: Clock,
      contacts: allInQueue,
    },
    {
      id: "with-agent",
      label: "Con agente",
      hint: "Conversación en curso",
      Icon: PhoneCall,
      contacts: allActiveCalls,
    },
  ];

  // Pull campaign name and status from the activeLabel "Name · STATUS".
  const [campaignName, campaignStatus] = (activeLabel || "").split(" · ");
  const isRunning = (campaignStatus || "").toUpperCase() === "RUNNING";

  return (
    <div className="space-y-8">
      {/* ── Campaign title row ─────────────────────────────────────── */}
      {activeLabel && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              {campaignName}
            </h2>
            {campaignStatus && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isRunning
                      ? "bg-[var(--accent-green)] animate-pulse"
                      : campaignStatus.toUpperCase() === "PAUSED"
                        ? "bg-[var(--accent-amber)]"
                        : "bg-muted-foreground/40"
                  }`}
                />
                {campaignStatus.charAt(0) +
                  campaignStatus.slice(1).toLowerCase()}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Stage funnel ───────────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Flujo de la llamada
        </h3>
        <StageStrip
          stages={stages}
          config={config}
          contactToCampaign={contactToCampaign}
          selectedIds={selectedIds}
          isPinned={isPinned}
          onBubbleClick={onBubbleClick}
          onTogglePin={onTogglePin}
        />
      </section>

      {/* ── Agent cards in portrait grid (2-3 per row depending on viewport) */}
      <section>
        <div className="mb-5 flex items-baseline justify-between">
          <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Agentes
            <span className="ml-2 font-normal text-muted-foreground/60">
              {sorted.length}
            </span>
          </h3>
        </div>
        {sorted.length === 0 ? (
          <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
            Doble-click un agente del panel inferior para asignarlo a la
            campaña.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((a) => (
              <AgentRowCard
                key={a.userId}
                agent={a}
                bucket={pendingBucketByAgent?.get(a.userId) || []}
                bucketCapacity={maxContactsPerAgent}
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
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Unassigned dock ───────────────────────────────────────── */}
      {(onAssignAgent || unassignedAgents.length > 0) && (
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Agentes sin asignar
            <span className="ml-1.5 font-normal text-muted-foreground/70">
              ({unassignedAgents.length})
            </span>
          </h3>
          <UnassignedAgentsDock
            agents={unassignedAgents}
            onAssignAgent={onAssignAgent}
          />
        </section>
      )}

      {/* ── Results strip ─────────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Resultados
        </h3>
        <ResultsStrip
          buckets={finishedBuckets}
          config={config}
          contactToCampaign={contactToCampaign}
          selectedIds={selectedIds}
          isPinned={isPinned}
          onBubbleClick={onBubbleClick}
          onTogglePin={onTogglePin}
        />
      </section>
    </div>
  );
}
