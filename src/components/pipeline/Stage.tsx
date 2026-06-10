import { useDrop } from "react-dnd";
import { AnimatePresence, motion } from "framer-motion";
import {
  Phone,
  FileStack,
  Clock,
  Headphones,
  CheckCircle2,
} from "lucide-react";
import { ContactBubble, DND_BUBBLE } from "./ContactBubble";
import type { BubbleDragPayload } from "./ContactBubble";
import type {
  PipelineStageId,
  PipelineStageView,
  PipelineContact,
} from "@/hooks/usePipelineStages";
import type { PipelineConfig } from "@/hooks/usePipelineConfig";

export interface StageProps {
  stage: PipelineStageView;
  config: PipelineConfig;
  contactToCampaign?: Map<
    string,
    { campaignId: string; campaignName: string }
  >;
  selectedIds?: string[];
  isPinned?: (contactId: string) => boolean;
  /** Per-bubble highlight/dim state from the hover hook. */
  isHighlighted?: (contactId: string) => boolean;
  isDimmed?: (contactId: string) => boolean;
  onHoverContact?: (contactId: string | null) => void;
  onBubbleClick?: (c: PipelineContact, event: React.MouseEvent) => void;
  onTogglePin?: (contactId: string) => void;
  /** Called when a bubble is dropped onto this stage header/column. */
  onDropOnStage?: (
    stageId: PipelineStageId,
    payload: BubbleDragPayload
  ) => void;
}

const STAGE_ICON: Record<PipelineStageId, React.ElementType> = {
  ARRIVED: Phone,
  IN_IVR: FileStack,
  IN_QUEUE: Clock,
  WITH_AGENT: Headphones,
  FINISHED: CheckCircle2,
};

const STAGE_COLOR: Record<
  PipelineStageId,
  { ring: string; dot: string; chip: string }
> = {
  ARRIVED: {
    ring: "ring-[var(--accent-amber-soft)] hover:ring-[var(--accent-amber)]",
    dot: "bg-[var(--accent-amber)]",
    chip: "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)]",
  },
  IN_IVR: {
    ring: "ring-[var(--accent-violet-soft)] hover:ring-[var(--accent-violet)]",
    dot: "bg-[var(--accent-violet)]",
    chip: "bg-[var(--accent-violet-soft)] text-[var(--accent-violet)]",
  },
  IN_QUEUE: {
    ring: "ring-[var(--accent-cyan-soft)] hover:ring-[var(--accent-cyan)]",
    dot: "bg-[var(--accent-cyan)]",
    chip: "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)]",
  },
  WITH_AGENT: {
    ring: "ring-[var(--accent-green-soft)] hover:ring-[var(--accent-green)]",
    dot: "bg-[var(--accent-green)]",
    chip: "bg-[var(--accent-green-soft)] text-[var(--accent-green)]",
  },
  FINISHED: {
    ring: "ring-[var(--border-2)]",
    dot: "bg-[var(--text-3)]",
    chip: "bg-[var(--bg-2)] text-[var(--text-2)]",
  },
};

function formatWait(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return `${m}m`;
}

export function Stage({
  stage,
  config,
  contactToCampaign,
  selectedIds,
  isPinned,
  isHighlighted,
  isDimmed,
  onHoverContact,
  onBubbleClick,
  onTogglePin,
  onDropOnStage,
}: StageProps) {
  // Pinned bubbles always sort to the top within the stage.
  const orderedContacts = isPinned
    ? [...stage.contacts].sort((a, b) => {
        const pa = isPinned(a.contactId) ? 0 : 1;
        const pb = isPinned(b.contactId) ? 0 : 1;
        return pa - pb;
      })
    : stage.contacts;
  const selectedSet = selectedIds ? new Set(selectedIds) : null;
  const palette = STAGE_COLOR[stage.id];
  const Icon = STAGE_ICON[stage.id];

  const [{ isOver, canDrop }, dropRef] = useDrop(
    () => ({
      accept: DND_BUBBLE,
      canDrop: (item: BubbleDragPayload) => {
        // FINISHED is never a valid drop target.
        if (stage.id === "FINISHED") return false;
        // Dropping on the same stage the bubble already is in is a no-op.
        if (item.fromStage === stage.id) return false;
        // Dropping onto IN_QUEUE from WITH_AGENT is "return to queue".
        // Dropping from any stage onto IN_QUEUE is "force-queue".
        return (
          stage.id === "IN_QUEUE" ||
          stage.id === "ARRIVED" ||
          stage.id === "IN_IVR"
        );
      },
      drop: (item: BubbleDragPayload) => {
        onDropOnStage?.(stage.id, item);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [stage.id, onDropOnStage]
  );

  return (
    <div
      ref={dropRef as unknown as React.Ref<HTMLDivElement>}
      className={`relative flex min-h-[260px] flex-1 min-w-0 flex-col rounded-xl border bg-card/60 p-3 backdrop-blur-sm transition-all ${
        isOver && canDrop
          ? "ring-4 ring-[var(--accent-green)] scale-[1.01]"
          : isOver && !canDrop
            ? "ring-4 ring-[var(--accent-red)]"
            : "ring-1 " + palette.ring
      }`}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${palette.chip}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-sm font-semibold">
              <span className="truncate">{stage.label}</span>
              <motion.span
                key={stage.contacts.length}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className={`ml-0.5 rounded-full px-1.5 py-0 text-[10px] tabular-nums ${palette.chip}`}
              >
                {stage.contacts.length}
              </motion.span>
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {stage.hint}
            </div>
          </div>
        </div>
        {stage.contacts.length > 0 && (
          <div className="text-right text-[10px] leading-tight text-muted-foreground">
            <div>
              avg <span className="font-mono">{formatWait(stage.avgSeconds)}</span>
            </div>
            <div>
              max <span className="font-mono">{formatWait(stage.maxSeconds)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Body: cloud of bubbles */}
      <div className="relative flex-1 overflow-y-auto rounded-lg bg-muted/30 p-2">
        {stage.contacts.length === 0 ? (
          <div className="flex h-full min-h-[160px] flex-col items-center justify-center text-[11px] text-muted-foreground/70">
            <Icon className="h-8 w-8 opacity-30" />
            <span className="mt-1 italic">vacío</span>
          </div>
        ) : (
          <div className="flex flex-wrap content-start gap-1.5">
            <AnimatePresence mode="popLayout" initial={false}>
              {orderedContacts.map((c) => (
                <ContactBubble
                  key={c.campaignRowId || c.contactId}
                  contact={c}
                  compact={config.compact}
                  warnSeconds={config.warnSeconds}
                  urgentSeconds={config.urgentSeconds}
                  campaignInfo={contactToCampaign?.get(c.contactId)}
                  pinned={isPinned?.(c.contactId)}
                  selected={selectedSet?.has(c.contactId)}
                  selectionIds={selectedIds}
                  highlighted={isHighlighted?.(c.contactId)}
                  dimmed={isDimmed?.(c.contactId)}
                  onClick={onBubbleClick}
                  onTogglePin={onTogglePin}
                  onHoverChange={onHoverContact}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
