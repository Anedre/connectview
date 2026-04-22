import { useDrop } from "react-dnd";
import { Phone, Headphones, Coffee, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LiveAgent } from "@/hooks/useLiveQueue";
import { DND_CONTACT } from "./ContactCard";

export interface AgentCardProps {
  agent: LiveAgent;
  onClick?: (agent: LiveAgent) => void;
  onContactDropped?: (agent: LiveAgent, payload: { contactId: string; phone: string | null }) => void;
}

function statusColor(status: string | null): string {
  if (!status) return "bg-slate-100 text-slate-700";
  const s = status.toLowerCase();
  if (s === "available") return "bg-emerald-100 text-emerald-800";
  if (s.includes("call") || s === "on call" || s === "busy")
    return "bg-blue-100 text-blue-800";
  if (s.includes("break") || s === "lunch") return "bg-amber-100 text-amber-800";
  if (s === "offline") return "bg-slate-100 text-slate-500";
  if (s === "aftercallwork" || s === "acw")
    return "bg-orange-100 text-orange-800";
  return "bg-slate-100 text-slate-700";
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

export function AgentCard({ agent, onClick, onContactDropped }: AgentCardProps) {
  const canReceive =
    agent.statusName?.toLowerCase() === "available" && !agent.activeContact;

  const [{ isOver, canDrop }, dropRef] = useDrop(
    () => ({
      accept: DND_CONTACT,
      canDrop: () => canReceive,
      drop: (item: { contactId: string; phone: string | null }) => {
        if (canReceive) onContactDropped?.(agent, item);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [agent, canReceive, onContactDropped]
  );

  const Icon = statusIcon(agent.statusName);

  return (
    <div
      ref={dropRef as unknown as React.Ref<HTMLDivElement>}
      onClick={() => onClick?.(agent)}
      className={`group relative flex cursor-pointer flex-col gap-2 rounded-lg border bg-card p-3 transition-all hover:shadow-sm ${
        isOver && canDrop
          ? "border-emerald-500 ring-2 ring-emerald-500/30"
          : isOver && !canDrop
          ? "border-rose-500 ring-2 ring-rose-500/30"
          : canReceive
          ? "border-emerald-200 hover:border-emerald-500/60"
          : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${statusColor(
            agent.statusName
          )}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{agent.username}</div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Badge className={`${statusColor(agent.statusName)} text-[9px]`}>
              {agent.statusName || "Offline"}
            </Badge>
            {agent.statusStartTimestamp && (
              <span>{formatAgo(agent.statusStartTimestamp)}</span>
            )}
          </div>
        </div>
      </div>

      {agent.activeContact && (
        <div className="rounded-md bg-muted/50 px-2 py-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono">
              {agent.activeContact.phone || agent.activeContact.contactId.slice(0, 8)}
            </span>
            <Badge variant="outline" className="text-[9px]">
              {agent.activeContact.state}
            </Badge>
          </div>
          {agent.activeContact.queueName && (
            <div className="text-[10px] text-muted-foreground">
              {agent.activeContact.queueName}
            </div>
          )}
        </div>
      )}

      {agent.routingProfile && !agent.activeContact && (
        <div className="truncate text-[10px] text-muted-foreground">
          {agent.routingProfile}
        </div>
      )}
    </div>
  );
}
