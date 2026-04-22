import { useDrop } from "react-dnd";
import { motion } from "framer-motion";
import {
  Phone,
  Coffee,
  UserX,
  Headphones,
  Megaphone,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DND_BUBBLE } from "./ContactBubble";
import type { BubbleDragPayload } from "./ContactBubble";
import type { LiveAgent } from "@/hooks/useLiveQueue";

export interface AgentRailProps {
  agents: LiveAgent[];
  contactToCampaign?: Map<
    string,
    { campaignId: string; campaignName: string }
  >;
  onContactDroppedOnAgent?: (
    agent: LiveAgent,
    payload: BubbleDragPayload
  ) => void;
  onAgentClick?: (agent: LiveAgent) => void;
}

function statusColor(status: string | null): string {
  if (!status) return "bg-slate-200 text-slate-700";
  const s = status.toLowerCase();
  if (s === "available") return "bg-emerald-200 text-emerald-900";
  if (s.includes("call") || s === "on call" || s === "busy")
    return "bg-blue-200 text-blue-900";
  if (s.includes("break") || s === "lunch") return "bg-amber-200 text-amber-900";
  if (s === "offline") return "bg-slate-200 text-slate-500";
  if (s === "aftercallwork" || s === "acw")
    return "bg-orange-200 text-orange-900";
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

function formatAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function AgentLane({
  agent,
  campaignInfo,
  onContactDropped,
  onClick,
}: {
  agent: LiveAgent;
  campaignInfo?: { campaignId: string; campaignName: string };
  onContactDropped?: (agent: LiveAgent, payload: BubbleDragPayload) => void;
  onClick?: (agent: LiveAgent) => void;
}) {
  const canReceive =
    agent.statusName?.toLowerCase() === "available" && !agent.activeContact;

  const [{ isOver, canDrop }, dropRef] = useDrop(
    () => ({
      accept: DND_BUBBLE,
      canDrop: () => canReceive,
      drop: (item: BubbleDragPayload) => {
        if (canReceive) onContactDropped?.(agent, item);
      },
      collect: (m) => ({ isOver: m.isOver(), canDrop: m.canDrop() }),
    }),
    [agent.userId, canReceive, onContactDropped]
  );

  const Icon = statusIcon(agent.statusName);

  return (
    <motion.div
      ref={dropRef as unknown as React.Ref<HTMLDivElement>}
      layout
      onClick={() => onClick?.(agent)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      className={`group relative flex cursor-pointer flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-[11px] transition-all ${
        isOver && canDrop
          ? "border-emerald-500 ring-4 ring-emerald-400/40"
          : isOver && !canDrop
            ? "border-rose-400 ring-4 ring-rose-400/30"
            : canReceive
              ? "border-emerald-200/70 hover:border-emerald-400 ring-1 ring-emerald-200/40"
              : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${statusColor(
            agent.statusName
          )}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{agent.username}</div>
          <div className="flex items-center gap-1">
            <Badge className={`${statusColor(agent.statusName)} text-[9px]`}>
              {agent.statusName || "Offline"}
            </Badge>
            {agent.statusStartTimestamp && (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {formatAgo(agent.statusStartTimestamp)}
              </span>
            )}
          </div>
        </div>
      </div>

      {agent.activeContact && (
        <div
          className={`rounded-md px-1.5 py-1 text-[10px] ${
            campaignInfo
              ? "bg-orange-50 dark:bg-orange-950/30"
              : "bg-muted/50"
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="truncate font-mono">
              {agent.activeContact.phone ||
                agent.activeContact.contactId.slice(0, 8)}
            </span>
            <Badge variant="outline" className="text-[9px]">
              {agent.activeContact.state}
            </Badge>
          </div>
          {campaignInfo && (
            <div className="mt-0.5 flex items-center gap-1 text-[9px] text-orange-800 dark:text-orange-300">
              <Megaphone className="h-2.5 w-2.5" />
              <span className="truncate font-semibold">
                {campaignInfo.campaignName}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Queue chips — colas asignadas a su routing profile */}
      {agent.queues && agent.queues.length > 0 && (
        <div className="flex flex-wrap items-center gap-0.5">
          <Layers className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
          {agent.queues.slice(0, 3).map((q) => (
            <span
              key={q.id}
              className="truncate rounded bg-sky-100 px-1 py-0 text-[9px] font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-200"
              title={q.name}
            >
              {q.name}
            </span>
          ))}
          {agent.queues.length > 3 && (
            <span className="text-[9px] text-muted-foreground">
              +{agent.queues.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Per-agent pipeline stats */}
      {agent.stats && (
        <div className="flex items-center justify-between gap-2 border-t pt-1 text-[9px]">
          <span
            className="flex items-center gap-0.5 text-sky-700 dark:text-sky-300"
            title="En cola para este agente ahora"
          >
            <Clock className="h-2.5 w-2.5" />
            <span className="font-mono font-semibold">
              {agent.stats.queuedForMe}
            </span>
          </span>
          <span
            className="flex items-center gap-0.5 text-emerald-700 dark:text-emerald-300"
            title="Completadas hoy"
          >
            <CheckCircle2 className="h-2.5 w-2.5" />
            <span className="font-mono font-semibold">
              {agent.stats.completedToday}
            </span>
          </span>
          <span
            className={`flex items-center gap-0.5 ${
              agent.stats.errorsToday > 0
                ? "text-rose-700 dark:text-rose-300"
                : "text-muted-foreground"
            }`}
            title="Errores / abandonadas hoy"
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            <span className="font-mono font-semibold">
              {agent.stats.errorsToday}
            </span>
          </span>
        </div>
      )}

      {canReceive && (
        <div className="absolute inset-x-0 -top-1.5 mx-auto w-fit rounded-full bg-emerald-500 px-1.5 py-0 text-[8px] font-semibold uppercase tracking-wide text-white opacity-0 transition-opacity group-hover:opacity-100">
          Disponible
        </div>
      )}
    </motion.div>
  );
}

export function AgentRail({
  agents,
  contactToCampaign,
  onContactDroppedOnAgent,
  onAgentClick,
}: AgentRailProps) {
  // Sort: available first, then in-call, then break, then offline.
  const sorted = [...agents].sort((a, b) => {
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
  });

  return (
    <div className="rounded-xl border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">
          Agentes <span className="text-muted-foreground">({agents.length})</span>
        </div>
        <div className="flex gap-1 text-[10px]">
          <Badge className="bg-emerald-100 text-emerald-800">
            {
              agents.filter(
                (a) =>
                  a.statusName?.toLowerCase() === "available" && !a.activeContact
              ).length
            }{" "}
            disponibles
          </Badge>
          <Badge className="bg-blue-100 text-blue-800">
            {agents.filter((a) => !!a.activeContact).length} en llamada
          </Badge>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {sorted.map((a) => (
          <AgentLane
            key={a.userId}
            agent={a}
            campaignInfo={
              a.activeContact?.contactId
                ? contactToCampaign?.get(a.activeContact.contactId)
                : undefined
            }
            onContactDropped={onContactDroppedOnAgent}
            onClick={onAgentClick}
          />
        ))}
      </div>
    </div>
  );
}
