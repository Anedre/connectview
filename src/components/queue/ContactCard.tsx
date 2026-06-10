import { useDrag } from "react-dnd";
import { Phone, MessageSquare, Mail, CheckSquare, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { QueuedContact } from "@/hooks/useLiveQueue";

export const DND_CONTACT = "queue-contact";

export interface ContactCardProps {
  contact: QueuedContact;
  onClick?: (c: QueuedContact) => void;
}

const CHANNEL_ICON: Record<string, React.ElementType> = {
  VOICE: Phone,
  CHAT: MessageSquare,
  EMAIL: Mail,
  TASK: CheckSquare,
};

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ContactCard({ contact, onClick }: ContactCardProps) {
  const Icon = CHANNEL_ICON[contact.channel] || Phone;
  const [{ isDragging }, dragRef] = useDrag(
    () => ({
      type: DND_CONTACT,
      item: { contactId: contact.contactId, phone: contact.phone },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [contact.contactId]
  );

  const waitSec = contact.waitingSeconds;
  const urgent = waitSec > 120;

  return (
    <div
      ref={dragRef as unknown as React.Ref<HTMLDivElement>}
      onClick={() => onClick?.(contact)}
      className={`group flex cursor-grab items-start gap-3 rounded-lg border bg-card p-3 transition-all active:cursor-grabbing ${
        isDragging ? "opacity-40" : "hover:border-primary/50 hover:shadow-sm"
      }`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          urgent
            ? "bg-[var(--accent-red-soft)] text-[var(--accent-red)]"
            : "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)]"
        }`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm font-medium">
            {contact.phone || contact.contactId.slice(0, 8)}
          </span>
          <Badge variant="outline" className="text-[9px] uppercase">
            {contact.channel}
          </Badge>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className={`h-3 w-3 ${urgent ? "text-[var(--accent-red)]" : ""}`} />
          <span className={urgent ? "font-semibold text-[var(--accent-red)]" : ""}>
            {formatWait(waitSec)}
          </span>
          {contact.queueName && (
            <span className="truncate">· {contact.queueName}</span>
          )}
        </div>
        {contact.initiationMethod && (
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {contact.initiationMethod}
          </div>
        )}
      </div>
    </div>
  );
}
