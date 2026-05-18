import { useMemo } from "react";
import { FlowView } from "./FlowView";
import { BoardView } from "./BoardView";
import { useAgentQueueMap } from "@/hooks/useAgentQueueMap";
import { useFinishedBuckets } from "@/hooks/useFinishedBuckets";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import type { LiveAgent, LiveQueueData } from "@/hooks/useLiveQueue";
import type { PipelineContact } from "@/hooks/usePipelineStages";
import type { PipelineConfig } from "@/hooks/usePipelineConfig";
import type { BubbleDragPayload } from "./ContactBubble";

/**
 * Renders the pipeline for contacts that are NOT tied to any running
 * campaign (i.e. inbound calls, manual outbound, transferred contacts).
 * Shown on the "Todas" tab when there are live contacts but no running
 * campaign, so the supervisor still sees the live queue.
 */
interface Props {
  liveData: LiveQueueData;
  contactToCampaign: Map<
    string,
    { campaignId: string; campaignName: string }
  >;
  config: PipelineConfig;
  selectedIds: string[];
  isPinned: (id: string) => boolean;
  onBubbleClick: (c: PipelineContact, event: React.MouseEvent) => void;
  onTogglePin: (id: string) => void;
  onContactDroppedOnAgent: (
    agent: LiveAgent,
    payload: BubbleDragPayload
  ) => void;
  onContactDroppedOnQueue?: (payload: BubbleDragPayload) => void;
  onContactDroppedOnFinished?: (payload: BubbleDragPayload) => void;
  onAgentClick: (a: LiveAgent) => void;
}

export function GeneralPipelineCard({
  liveData,
  contactToCampaign,
  config,
  selectedIds,
  isPinned,
  onBubbleClick,
  onTogglePin,
  onContactDroppedOnAgent,
  onContactDroppedOnQueue,
  onContactDroppedOnFinished,
  onAgentClick,
}: Props) {
  const allAgents = liveData.agents || [];

  // Split agents: those that are "in play" (non-Offline or with an active
  // contact) show as columns in the fan-out; strictly-offline agents go to
  // a collapsed pool at the side so the graph doesn't drown in dormant
  // columns. There's no campaign-assignment concept in the general pipeline,
  // but separating by activity gives the supervisor a similar clean layout.
  const { activeAgents, offlineAgents } = useMemo(() => {
    const active: typeof allAgents = [];
    const offline: typeof allAgents = [];
    for (const a of allAgents) {
      const s = (a.statusName || "").toLowerCase();
      if (s === "offline" && !a.activeContact) offline.push(a);
      else active.push(a);
    }
    return { activeAgents: active, offlineAgents: offline };
  }, [allAgents]);

  // No campaign scoping — show everything, but respect user-level filters.
  const stages = usePipelineStages(
    liveData,
    {
      queueId: config.queueId === "ALL" ? null : config.queueId,
      channel: config.channel === "ALL" ? null : config.channel,
      query: config.query,
      hideFinished: !config.showFinished,
      hideIvr: !config.showIvr,
    },
    contactToCampaign
  );

  const arrivedContacts = stages.find((s) => s.id === "ARRIVED")?.contacts || [];
  const ivrContacts = stages.find((s) => s.id === "IN_IVR")?.contacts || [];
  const inQueueAll = stages.find((s) => s.id === "IN_QUEUE")?.contacts || [];
  const finishedContacts =
    stages.find((s) => s.id === "FINISHED")?.contacts || [];

  const agentQueueMap = useAgentQueueMap(activeAgents, inQueueAll);

  // Retry scheduled — everything (no campaign filter).
  const retryScheduled = useMemo(
    () => (liveData.retryScheduled || []) as PipelineContact[],
    [liveData.retryScheduled]
  );
  const finishedBuckets = useFinishedBuckets(finishedContacts, retryScheduled);

  if (config.viewMode === "board") {
    return (
      <BoardView
        agents={activeAgents}
        activeLabel="Pipeline general · sin campaña"
        arrived={arrivedContacts}
        inIvr={ivrContacts}
        inQueue={inQueueAll}
        finishedBuckets={finishedBuckets}
        config={config}
        contactToCampaign={contactToCampaign}
        selectedIds={selectedIds}
        isPinned={isPinned}
        onBubbleClick={onBubbleClick}
        onTogglePin={onTogglePin}
        onContactDroppedOnAgent={onContactDroppedOnAgent}
        onContactDroppedOnQueue={onContactDroppedOnQueue}
        onContactDroppedOnFinished={onContactDroppedOnFinished}
        onAgentClick={onAgentClick}
      />
    );
  }

  return (
    <FlowView
      agents={activeAgents}
      unassignedAgents={offlineAgents}
      activeLabel="Pipeline general · sin campaña"
      arrived={arrivedContacts}
      inIvr={ivrContacts}
      inQueueByAgent={agentQueueMap.inQueueByAgent}
      finishedBuckets={finishedBuckets}
      config={config}
      contactToCampaign={contactToCampaign}
      selectedIds={selectedIds}
      isPinned={isPinned}
      onBubbleClick={onBubbleClick}
      onTogglePin={onTogglePin}
      onContactDroppedOnAgent={onContactDroppedOnAgent}
      onAgentClick={onAgentClick}
    />
  );
}
