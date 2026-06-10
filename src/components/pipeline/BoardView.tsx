import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDrop } from "react-dnd";
import {
  Clock,
  Phone,
  PhoneIncoming,
  Headphones,
  CheckCircle2,
  Coffee,
  UserX,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ContactBubble, DND_BUBBLE } from "./ContactBubble";
import type { BubbleDragPayload } from "./ContactBubble";
import type { LiveAgent } from "@/hooks/useLiveQueue";
import type { PipelineContact } from "@/hooks/usePipelineStages";
import type { PipelineConfig } from "@/hooks/usePipelineConfig";
import type { FinishedBucket } from "@/hooks/useFinishedBuckets";

export interface BoardViewProps {
  agents: LiveAgent[];
  activeLabel?: string;
  arrived: PipelineContact[];
  inIvr: PipelineContact[];
  inQueue: PipelineContact[];
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
  /** Drop on an agent drop-zone or on the "Con agente" column after picking. */
  onContactDroppedOnAgent?: (
    agent: LiveAgent,
    payload: BubbleDragPayload
  ) => void;
  /** Drop on Finalizados — treat as stopContact (caller confirms). */
  onContactDroppedOnFinished?: (payload: BubbleDragPayload) => void;
  /** Drop back to En cola from Con agente — transfer without userId. */
  onContactDroppedOnQueue?: (payload: BubbleDragPayload) => void;
  onAgentClick?: (agent: LiveAgent) => void;
}

function agentStatusMeta(status: string | null): {
  color: string;
  Icon: React.ElementType;
  label: string;
} {
  const s = (status || "").toLowerCase();
  if (s === "available")
    return {
      color:
        "bg-[var(--accent-green-soft)] text-[var(--accent-green)] ring-[var(--accent-green-soft)]",
      Icon: Headphones,
      label: "Disponible",
    };
  if (s.includes("call") || s === "on call" || s === "busy")
    return {
      color:
        "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] ring-[var(--accent-cyan-soft)]",
      Icon: Phone,
      label: "En llamada",
    };
  if (s === "aftercallwork" || s === "acw")
    return {
      color:
        "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)] ring-[var(--accent-amber-soft)]",
      Icon: Phone,
      label: "ACW",
    };
  if (s.includes("break") || s === "lunch")
    return {
      color:
        "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)] ring-[var(--accent-amber-soft)]",
      Icon: Coffee,
      label: "Break",
    };
  if (s === "offline")
    return {
      color:
        "bg-[var(--bg-2)] text-[var(--text-3)] ring-[var(--border-2)]",
      Icon: UserX,
      label: "Offline",
    };
  return {
    color:
      "bg-[var(--bg-2)] text-[var(--text-2)] ring-[var(--border-2)]",
    Icon: AlertCircle,
    label: status || "—",
  };
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

interface ColumnProps {
  id: string;
  label: string;
  hint: string;
  Icon: React.ElementType;
  accentClass: string;
  headerRing: string;
  contacts: PipelineContact[];
  config: PipelineConfig;
  contactToCampaign?: BoardViewProps["contactToCampaign"];
  selectedIds?: string[];
  isPinned?: (id: string) => boolean;
  onBubbleClick?: BoardViewProps["onBubbleClick"];
  onTogglePin?: BoardViewProps["onTogglePin"];
  /** Called when a bubble is dropped on this column. If undefined, column is read-only. */
  onDrop?: (payload: BubbleDragPayload) => void;
  /** Validate whether the drop is allowed — show rose ring if not. */
  canDrop?: (payload: BubbleDragPayload) => boolean;
  /** Optional extra content rendered below the column header (e.g. agent list inside WITH_AGENT). */
  extra?: React.ReactNode;
}

function Column({
  id,
  label,
  hint,
  Icon,
  accentClass,
  headerRing,
  contacts,
  config,
  contactToCampaign,
  selectedIds,
  isPinned,
  onBubbleClick,
  onTogglePin,
  onDrop,
  canDrop,
  extra,
}: ColumnProps) {
  const [{ isOver, canAccept }, dropRef] = useDrop(
    () => ({
      accept: DND_BUBBLE,
      canDrop: (item: BubbleDragPayload) =>
        onDrop !== undefined && (canDrop ? canDrop(item) : true),
      drop: (item: BubbleDragPayload) => {
        if (onDrop) onDrop(item);
      },
      collect: (m) => ({
        isOver: m.isOver({ shallow: true }),
        canAccept: m.canDrop(),
      }),
    }),
    [onDrop, canDrop]
  );

  const readOnly = !onDrop;

  return (
    <motion.div
      ref={dropRef as unknown as React.Ref<HTMLDivElement>}
      data-board-column={id}
      layout
      className={`flex h-full min-h-[340px] min-w-[240px] max-w-[320px] flex-1 shrink-0 flex-col rounded-2xl border bg-card/70 backdrop-blur-sm transition ${
        isOver && canAccept
          ? "ring-2 ring-[var(--accent-green)] shadow-lg shadow-[var(--accent-green)]"
          : isOver && !canAccept
            ? "ring-2 ring-[var(--accent-red)]"
            : "ring-1 ring-border/60 hover:ring-border"
      }`}
    >
      {/* Column header */}
      <div
        className={`flex items-center gap-2 rounded-t-2xl border-b px-3 py-2.5 ${headerRing}`}
      >
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${accentClass} shadow-sm`}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{label}</span>
            {readOnly && (
              <span
                className="text-[10px] text-muted-foreground"
                title="Columna de solo lectura — el sistema la maneja automáticamente"
              >
                · auto
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {hint}
          </div>
        </div>
        <Badge
          variant="secondary"
          className="tabular-nums text-xs font-semibold"
        >
          {contacts.length}
        </Badge>
      </div>

      {extra && <div className="border-b px-3 py-2">{extra}</div>}

      {/* Column body — scrollable contact list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {contacts.length === 0 ? (
          <div className="flex h-full min-h-[80px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-6 text-center">
            <span className="text-[11px] italic text-muted-foreground/70">
              {readOnly ? "sin contactos" : "arrastrá aquí"}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-start gap-1.5">
            <AnimatePresence mode="popLayout" initial={false}>
              {contacts.map((c) => (
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
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Per-agent mini drop-zone used inside the "Con agente" column and in the
 * right-side agent dock. Only accepts IN_QUEUE or WITH_AGENT contacts, and
 * only when the agent is Available and idle.
 */
function AgentDropChip({
  agent,
  onContactDroppedOnAgent,
  onAgentClick,
  compact,
}: {
  agent: LiveAgent;
  onContactDroppedOnAgent?: BoardViewProps["onContactDroppedOnAgent"];
  onAgentClick?: BoardViewProps["onAgentClick"];
  compact?: boolean;
}) {
  const canReceive =
    agent.statusName?.toLowerCase() === "available" && !agent.activeContact;
  const [{ isOver, canAccept }, dropRef] = useDrop(
    () => ({
      accept: DND_BUBBLE,
      canDrop: (item: BubbleDragPayload) =>
        canReceive &&
        (item.fromStage === "IN_QUEUE" || item.fromStage === "WITH_AGENT"),
      drop: (item: BubbleDragPayload) => {
        if (canReceive) onContactDroppedOnAgent?.(agent, item);
      },
      collect: (m) => ({
        isOver: m.isOver({ shallow: true }),
        canAccept: m.canDrop(),
      }),
    }),
    [agent.userId, canReceive, onContactDroppedOnAgent]
  );

  const meta = agentStatusMeta(agent.statusName);
  const Icon = meta.Icon;

  return (
    <button
      ref={dropRef as unknown as React.Ref<HTMLButtonElement>}
      type="button"
      onClick={() => onAgentClick?.(agent)}
      className={`group flex w-full items-center gap-2 rounded-lg border bg-card/80 ${
        compact ? "px-1.5 py-1" : "px-2 py-1.5"
      } text-left transition-all hover:border-primary/40 hover:shadow-sm ${
        isOver && canAccept
          ? "ring-2 ring-[var(--accent-green)] shadow-md shadow-[var(--accent-green)] scale-[1.02]"
          : isOver && !canAccept
            ? "ring-2 ring-[var(--accent-red)]"
            : canReceive
              ? "ring-1 ring-[var(--accent-green-soft)]"
              : ""
      }`}
      title={
        canReceive
          ? `Arrastrá una llamada aquí para transferir a ${agent.username}`
          : `${agent.username} · ${meta.label}`
      }
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ${meta.color}`}
      >
        <Icon className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium">{agent.username}</div>
        <div className="truncate text-[10px] text-muted-foreground">
          {meta.label}
        </div>
      </div>
      {canReceive && (
        <span className="text-[9px] italic text-[var(--accent-green)] opacity-0 transition-opacity group-hover:opacity-100">
          drop ↓
        </span>
      )}
    </button>
  );
}

/**
 * Right-side dock: compact agent list grouped by status. Each "Available &
 * idle" row is a precise drop target that transfers the dragged contact
 * directly. The dock is collapsible to make room on narrow screens.
 */
function AgentDock({
  agents,
  onContactDroppedOnAgent,
  onAgentClick,
}: {
  agents: LiveAgent[];
  onContactDroppedOnAgent?: BoardViewProps["onContactDroppedOnAgent"];
  onAgentClick?: BoardViewProps["onAgentClick"];
}) {
  const [collapsed, setCollapsed] = useState(false);

  const grouped = useMemo(() => {
    const buckets: Record<string, LiveAgent[]> = {
      available: [],
      busy: [],
      acw: [],
      break: [],
      offline: [],
      other: [],
    };
    for (const a of agents) {
      const s = (a.statusName || "").toLowerCase();
      if (s === "available" && !a.activeContact) buckets.available.push(a);
      else if (s === "available" && a.activeContact) buckets.busy.push(a);
      else if (s.includes("call") || s === "on call" || s === "busy")
        buckets.busy.push(a);
      else if (s === "aftercallwork" || s === "acw") buckets.acw.push(a);
      else if (s.includes("break") || s === "lunch") buckets.break.push(a);
      else if (s === "offline") buckets.offline.push(a);
      else buckets.other.push(a);
    }
    return buckets;
  }, [agents]);

  const total = agents.length;
  const availableCount = grouped.available.length;

  return (
    <div
      className={`sticky top-2 flex shrink-0 flex-col self-start rounded-2xl border bg-card/70 backdrop-blur-sm transition-all ${
        collapsed ? "w-12" : "w-56"
      }`}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-2 border-b px-3 py-2.5 text-left hover:bg-muted/40"
        title={collapsed ? "Expandir panel de agentes" : "Colapsar panel"}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0" />
        )}
        {!collapsed && (
          <>
            <span className="text-sm font-semibold">Agentes</span>
            <Badge variant="secondary" className="ml-auto text-xs">
              {availableCount}/{total}
            </Badge>
          </>
        )}
      </button>
      {!collapsed && (
        <div className="max-h-[calc(100vh-12rem)] space-y-2 overflow-y-auto p-2">
          {(
            [
              ["available", "Disponibles", "text-[var(--accent-green)]"],
              ["busy", "En llamada", "text-[var(--accent-cyan)]"],
              ["acw", "ACW", "text-[var(--accent-amber)]"],
              ["break", "Break", "text-[var(--accent-amber)]"],
              ["offline", "Offline", "text-[var(--text-3)]"],
              ["other", "Otros", "text-[var(--text-3)]"],
            ] as const
          ).map(([key, label, cls]) => {
            const list = grouped[key];
            if (!list.length) return null;
            return (
              <div key={key}>
                <div
                  className={`mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
                >
                  <span>{label}</span>
                  <span className="text-muted-foreground">· {list.length}</span>
                </div>
                <div className="space-y-1">
                  {list.map((a) => (
                    <AgentDropChip
                      key={a.userId}
                      agent={a}
                      onContactDroppedOnAgent={onContactDroppedOnAgent}
                      onAgentClick={onAgentClick}
                      compact
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {total === 0 && (
            <div className="py-4 text-center text-[11px] italic text-muted-foreground">
              Sin agentes asignados
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BoardView({
  agents,
  activeLabel,
  arrived,
  inIvr,
  inQueue,
  finishedBuckets,
  config,
  contactToCampaign,
  selectedIds,
  isPinned,
  onBubbleClick,
  onTogglePin,
  onContactDroppedOnAgent,
  onContactDroppedOnFinished,
  onContactDroppedOnQueue,
  onAgentClick,
}: BoardViewProps) {
  // Flatten finished buckets into a single column's contact list, with
  // bucket labels inline so the admin still sees the disconnect-reason mix.
  const finishedFlat = useMemo(
    () => finishedBuckets.flatMap((b) => b.contacts),
    [finishedBuckets]
  );

  // Derive "Con agente" contacts from the agents' activeContact field.
  const withAgentContacts = useMemo(
    () =>
      agents
        .map(activeContactToBubble)
        .filter((c): c is PipelineContact => !!c),
    [agents]
  );

  // Available & idle agents — shown inline at the top of "Con agente" as
  // quick drop chips (same semantics as the dock, but proximate to the drop).
  const idleAgents = useMemo(
    () =>
      agents.filter(
        (a) =>
          (a.statusName || "").toLowerCase() === "available" && !a.activeContact
      ),
    [agents]
  );

  return (
    <div className="rounded-xl border bg-gradient-to-b from-background via-background/60 to-muted/20 p-3">
      {activeLabel && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="rounded-full bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-cyan-soft)] px-3 py-1 text-xs font-semibold text-white shadow-sm">
            {activeLabel}
          </span>
          <span className="text-[11px] text-muted-foreground">
            Arrastrá burbujas entre columnas · doble-click en una burbuja abre
            detalle
          </span>
        </div>
      )}

      <div className="flex items-stretch gap-3">
        {/* Columns row — horizontally scrollable on narrow screens */}
        <div className="flex flex-1 items-stretch gap-3 overflow-x-auto pb-2">
          {/* Marcando first = outbound flow direction (dialer initiates the
              call → Connect ARRIVED stage), which matches FlowView's data
              mapping. Earlier versions had Pendientes/Marcando swapped which
              caused bubbles to appear to "jump backwards" between columns. */}
          <Column
            id="ivr"
            label="Marcando"
            hint="Dialer llamando · iniciando contacto"
            Icon={PhoneIncoming}
            accentClass="bg-gradient-to-br from-[var(--accent-violet)] to-[var(--accent-violet-soft)] text-white"
            headerRing="bg-[var(--accent-violet-soft)]"
            contacts={arrived}
            config={config}
            contactToCampaign={contactToCampaign}
            selectedIds={selectedIds}
            isPinned={isPinned}
            onBubbleClick={onBubbleClick}
            onTogglePin={onTogglePin}
            /* read-only: dialer produces these */
          />

          {config.showIvr && (
            <Column
              id="arrived"
              label="Pendientes"
              hint="En flow / AMD · esperando ruteo"
              Icon={Clock}
              accentClass="bg-gradient-to-br from-[var(--accent-amber)] to-[var(--accent-amber-soft)] text-white"
              headerRing="bg-[var(--accent-amber-soft)]"
              contacts={inIvr}
              config={config}
              contactToCampaign={contactToCampaign}
              selectedIds={selectedIds}
              isPinned={isPinned}
              onBubbleClick={onBubbleClick}
              onTogglePin={onTogglePin}
              /* read-only */
            />
          )}

          <Column
            id="queue"
            label="En cola"
            hint="Esperando un agente"
            Icon={Clock}
            accentClass="bg-gradient-to-br from-[var(--accent-cyan)] to-[var(--accent-cyan-soft)] text-white"
            headerRing="bg-[var(--accent-cyan-soft)]"
            contacts={inQueue}
            config={config}
            contactToCampaign={contactToCampaign}
            selectedIds={selectedIds}
            isPinned={isPinned}
            onBubbleClick={onBubbleClick}
            onTogglePin={onTogglePin}
            onDrop={
              onContactDroppedOnQueue
                ? (p) => {
                    // Only accept bubbles that are currently WITH_AGENT (i.e.
                    // "devolver a cola"). IN_QUEUE → IN_QUEUE is a no-op.
                    if (p.fromStage === "WITH_AGENT")
                      onContactDroppedOnQueue(p);
                  }
                : undefined
            }
            canDrop={(p) => p.fromStage === "WITH_AGENT"}
          />

          <Column
            id="with-agent"
            label="Con agente"
            hint={
              idleAgents.length > 0
                ? `${idleAgents.length} agente(s) disponible(s)`
                : "Conversaciones en curso"
            }
            Icon={Headphones}
            accentClass="bg-gradient-to-br from-[var(--accent-green)] to-[var(--accent-green-soft)] text-white"
            headerRing="bg-[var(--accent-green-soft)]"
            contacts={withAgentContacts}
            config={config}
            contactToCampaign={contactToCampaign}
            selectedIds={selectedIds}
            isPinned={isPinned}
            onBubbleClick={onBubbleClick}
            onTogglePin={onTogglePin}
            onDrop={undefined /* precise drop only on agent chips */}
            canDrop={() => false}
            extra={
              idleAgents.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-green)]">
                    Drop rápido
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    {idleAgents.slice(0, 4).map((a) => (
                      <AgentDropChip
                        key={a.userId}
                        agent={a}
                        onContactDroppedOnAgent={onContactDroppedOnAgent}
                        onAgentClick={onAgentClick}
                        compact
                      />
                    ))}
                    {idleAgents.length > 4 && (
                      <div className="pt-0.5 text-center text-[10px] text-muted-foreground">
                        +{idleAgents.length - 4} en el panel →
                      </div>
                    )}
                  </div>
                </div>
              ) : null
            }
          />

          {config.showFinished && (
            <Column
              id="finished"
              label="Finalizados"
              hint="Completadas · abandonos · errores"
              Icon={CheckCircle2}
              accentClass="bg-gradient-to-br from-[var(--bg-3)] to-[var(--bg-3)] text-white"
              headerRing="bg-[var(--bg-2)]"
              contacts={finishedFlat}
              config={config}
              contactToCampaign={contactToCampaign}
              selectedIds={selectedIds}
              isPinned={isPinned}
              onBubbleClick={onBubbleClick}
              onTogglePin={onTogglePin}
              onDrop={
                onContactDroppedOnFinished
                  ? (p) => onContactDroppedOnFinished(p)
                  : undefined
              }
              canDrop={(p) =>
                p.fromStage === "IN_QUEUE" || p.fromStage === "WITH_AGENT"
              }
              extra={
                finishedBuckets.some((b) => b.contacts.length > 0) ? (
                  <div className="flex flex-wrap gap-1">
                    {finishedBuckets.map((b) =>
                      b.contacts.length > 0 ? (
                        <span
                          key={b.id}
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${b.color}`}
                          title={b.hint}
                        >
                          {b.label} · {b.contacts.length}
                        </span>
                      ) : null
                    )}
                  </div>
                ) : null
              }
            />
          )}
        </div>

        {/* Right-side agent dock */}
        <AgentDock
          agents={agents}
          onContactDroppedOnAgent={onContactDroppedOnAgent}
          onAgentClick={onAgentClick}
        />
      </div>
    </div>
  );
}
