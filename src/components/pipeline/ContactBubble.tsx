import { useDrag } from "react-dnd";
import { motion } from "framer-motion";
import {
  Phone,
  MessageSquare,
  Mail,
  CheckSquare,
  Megaphone,
  Star,
  Check,
  RotateCw,
} from "lucide-react";
import type { PipelineContact } from "@/hooks/usePipelineStages";

export const DND_BUBBLE = "pipeline-contact";

export interface BubbleDragPayload {
  contactId: string;
  phone: string | null;
  fromStage: string;
  agentUserId: string | null;
  /** If true the drop-target should apply to every bubble in this id list. */
  selection?: string[];
}

export interface ContactBubbleProps {
  contact: PipelineContact;
  compact?: boolean;
  warnSeconds: number;
  urgentSeconds: number;
  campaignInfo?: { campaignId: string; campaignName: string };
  pinned?: boolean;
  selected?: boolean;
  /** Glow outline when related to the currently-hovered agent. */
  highlighted?: boolean;
  /** Fade out when an unrelated hover is happening. */
  dimmed?: boolean;
  onClick?: (c: PipelineContact, event: React.MouseEvent) => void;
  onTogglePin?: (contactId: string) => void;
  onHoverChange?: (contactId: string | null) => void;
  /** When selected, react-dnd will carry the full selection instead of just this one. */
  selectionIds?: string[];
}

const CHANNEL_ICON: Record<string, React.ElementType> = {
  VOICE: Phone,
  CHAT: MessageSquare,
  EMAIL: Mail,
  TASK: CheckSquare,
};

const CHANNEL_COLOR: Record<
  string,
  { bg: string; ring: string; text: string; glow: string }
> = {
  VOICE: {
    bg: "bg-gradient-to-br from-sky-400 to-blue-600",
    ring: "ring-sky-300",
    text: "text-white",
    glow: "shadow-[0_0_0_4px_rgba(14,165,233,0.15)]",
  },
  CHAT: {
    bg: "bg-gradient-to-br from-emerald-400 to-teal-600",
    ring: "ring-emerald-300",
    text: "text-white",
    glow: "shadow-[0_0_0_4px_rgba(16,185,129,0.15)]",
  },
  EMAIL: {
    bg: "bg-gradient-to-br from-violet-400 to-purple-600",
    ring: "ring-violet-300",
    text: "text-white",
    glow: "shadow-[0_0_0_4px_rgba(139,92,246,0.15)]",
  },
  TASK: {
    bg: "bg-gradient-to-br from-amber-400 to-orange-600",
    ring: "ring-amber-300",
    text: "text-white",
    glow: "shadow-[0_0_0_4px_rgba(245,158,11,0.15)]",
  },
};

function secondsIn(c: PipelineContact): number {
  if (c.stageEnteredAt) {
    return Math.max(
      0,
      Math.round((Date.now() - new Date(c.stageEnteredAt).getTime()) / 1000)
    );
  }
  return c.waitingSeconds;
}

function formatTime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  // Long durations — show hours + minutes so "2342:32" doesn't happen on
  // zombie data. `Xh Ym` matches the KPI-bar formatter.
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatFinishedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ContactBubble({
  contact,
  compact,
  warnSeconds,
  urgentSeconds,
  campaignInfo,
  pinned,
  selected,
  highlighted,
  dimmed,
  onClick,
  onTogglePin,
  onHoverChange,
  selectionIds,
}: ContactBubbleProps) {
  const Icon = CHANNEL_ICON[contact.channel] || Phone;
  const palette = CHANNEL_COLOR[contact.channel] || CHANNEL_COLOR.VOICE;

  const sec = secondsIn(contact);
  const urgent = sec >= urgentSeconds;
  const warn = !urgent && sec >= warnSeconds;

  const [{ isDragging }, dragRef] = useDrag(
    () => ({
      type: DND_BUBBLE,
      item: (): BubbleDragPayload => ({
        contactId: contact.contactId,
        phone: contact.phone,
        fromStage: contact.state,
        agentUserId: contact.agentUserId || null,
        // If this bubble is part of a multi-select, carry the whole selection.
        selection:
          selected && selectionIds && selectionIds.length > 1
            ? selectionIds
            : undefined,
      }),
      canDrag:
        contact.state === "IN_QUEUE" || contact.state === "WITH_AGENT",
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [contact.contactId, contact.state, contact.agentUserId, selected, selectionIds]
  );

  // Amazon Connect's TransferContact API only accepts contacts in IN_QUEUE or
  // WITH_AGENT state. ARRIVED (pre-queue) and IN_IVR (dialer / flow-execution)
  // contacts are handled by the contact flow itself — attempting to transfer
  // them returns 500 from Connect. Disable drag on those so the UI matches
  // what the backend can actually do.
  const canDrag =
    contact.state === "IN_QUEUE" || contact.state === "WITH_AGENT";

  // Wrap the animated bubble in a plain draggable <div> so react-dnd's
  // HTML5 backend can reliably set draggable="true" and capture native
  // dragstart. Letting motion.div hold the dragRef has shown to race with
  // framer-motion's layout/whileTap pointer capture in some browsers and
  // silently break drag initiation.
  return (
    <div
      ref={dragRef as unknown as React.Ref<HTMLDivElement>}
      className={`inline-block ${canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-default"}`}
      onClick={(e) => onClick?.(contact, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        onTogglePin?.(contact.contactId);
      }}
      onMouseEnter={() => onHoverChange?.(contact.contactId)}
      onMouseLeave={() => onHoverChange?.(null)}
      title={
        (contact.customerName || contact.phone || "") +
        (contact.queueName ? ` · ${contact.queueName}` : "") +
        (contact.agentUsername ? ` · ${contact.agentUsername}` : "") +
        "\nClick: detalles · Click derecho: " +
        (pinned ? "desfijar" : "fijar") +
        (canDrag
          ? " · Ctrl/⌘-click: multi-selección · Arrastrar: transferir"
          : contact.state === "FINISHED"
            ? ""
            : " · No transferible (Connect maneja esta etapa automáticamente)")
      }
    >
    <motion.div
      // Layout animation: when a bubble moves from one Stage column to another
      // framer-motion will interpolate its position between renders.
      // Use campaignRowId when present so the "same customer" retains its
      // bubble identity across retry attempts (new connectContactId each
      // retry, but same row in DynamoDB).
      layout
      layoutId={contact.campaignRowId || contact.contactId}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: isDragging ? 0.4 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.4, filter: "blur(4px)" }}
      transition={{
        type: "spring",
        stiffness: 320,
        damping: 26,
        mass: 0.8,
      }}
      whileHover={{ scale: 1.04 }}
      className={`group relative inline-flex select-none items-center gap-1.5 rounded-full ${palette.bg} ${palette.text} ring-2 ${palette.ring} ${palette.glow} px-2.5 ${
        compact ? "py-0.5 text-[10px]" : "py-1 text-[11px]"
      } font-medium shadow-sm transition ${
        selected
          ? "ring-4 ring-indigo-400 shadow-[0_0_0_6px_rgba(99,102,241,0.3)]"
          : urgent
            ? "animate-pulse ring-rose-400 shadow-[0_0_0_6px_rgba(244,63,94,0.25)]"
            : warn
              ? "ring-amber-300 shadow-[0_0_0_4px_rgba(245,158,11,0.2)]"
              : ""
      } ${pinned ? "outline outline-2 outline-offset-2 outline-amber-400" : ""} ${
        contact.state === "FINISHED" ? "opacity-60 saturate-50" : ""
      } ${
        highlighted
          ? "ring-4 ring-cyan-400 scale-110 shadow-[0_0_12px_rgba(34,211,238,0.6)]"
          : ""
      } ${dimmed ? "opacity-30 saturate-50" : ""}`}
    >
      {pinned && (
        <span className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[8px] text-white shadow">
          <Star className="h-2.5 w-2.5 fill-white" />
        </span>
      )}
      {selected && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[8px] text-white shadow">
          <Check className="h-2.5 w-2.5" />
        </span>
      )}
      <Icon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      <span className="tabular-nums">
        {contact.state === "FINISHED"
          ? formatFinishedAt(contact.stageEnteredAt)
          : formatTime(sec)}
      </span>
      {!compact && campaignInfo && (
        <Megaphone className="h-3 w-3 opacity-90" />
      )}
      {(contact.retryCount || 0) > 1 && (
        <span
          className="ml-0.5 flex items-center gap-0.5 rounded-full bg-white/25 px-1 py-0 text-[9px] font-semibold backdrop-blur-sm"
          title={`Intento ${contact.retryCount}`}
        >
          <RotateCw
            className={`h-2.5 w-2.5 ${
              contact.state === "ARRIVED" || contact.state === "IN_IVR"
                ? "animate-spin [animation-duration:2s]"
                : ""
            }`}
          />
          {contact.retryCount}
        </span>
      )}
    </motion.div>
    </div>
  );
}
