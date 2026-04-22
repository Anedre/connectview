import { ChevronRight } from "lucide-react";
import { Stage, type StageProps } from "./Stage";
import type {
  PipelineContact,
  PipelineStageId,
  PipelineStageView,
} from "@/hooks/usePipelineStages";
import type { PipelineConfig } from "@/hooks/usePipelineConfig";
import type { BubbleDragPayload } from "./ContactBubble";

export interface PipelineProps {
  stages: PipelineStageView[];
  config: PipelineConfig;
  contactToCampaign?: Map<
    string,
    { campaignId: string; campaignName: string }
  >;
  selectedIds?: string[];
  isPinned?: (contactId: string) => boolean;
  isHighlighted?: (contactId: string) => boolean;
  isDimmed?: (contactId: string) => boolean;
  onHoverContact?: (contactId: string | null) => void;
  onBubbleClick?: StageProps["onBubbleClick"];
  onTogglePin?: (contactId: string) => void;
  onDropOnStage?: (
    stageId: PipelineStageId,
    payload: BubbleDragPayload
  ) => void;
  onDisconnectDrop?: (payload: BubbleDragPayload) => void;
}

export function Pipeline({
  stages,
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
}: PipelineProps) {
  return (
    <div className="flex w-full gap-2 overflow-x-auto pb-2">
      {stages.map((stage, i) => (
        <div key={stage.id} className="flex min-w-[220px] items-stretch gap-2 flex-1">
          <Stage
            stage={stage}
            config={config}
            contactToCampaign={contactToCampaign}
            selectedIds={selectedIds}
            isPinned={isPinned}
            isHighlighted={isHighlighted}
            isDimmed={isDimmed}
            onHoverContact={onHoverContact}
            onBubbleClick={onBubbleClick}
            onTogglePin={onTogglePin}
            onDropOnStage={onDropOnStage}
          />
          {i < stages.length - 1 && (
            <div className="flex shrink-0 items-center text-muted-foreground/40">
              <ChevronRight className="h-5 w-5" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Avoid "unused" warnings on PipelineContact re-export indirection.
export type { PipelineContact };
