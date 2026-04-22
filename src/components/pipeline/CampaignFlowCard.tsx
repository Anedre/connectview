import { useMemo } from "react";
import { toast } from "sonner";
import { FlowView } from "./FlowView";
import { useCampaignAgents } from "@/hooks/useCampaignAgents";
import { useAgentQueueMap } from "@/hooks/useAgentQueueMap";
import { useFinishedBuckets } from "@/hooks/useFinishedBuckets";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import type { LiveAgent, LiveQueueData } from "@/hooks/useLiveQueue";
import type { PipelineContact } from "@/hooks/usePipelineStages";
import type { PipelineConfig } from "@/hooks/usePipelineConfig";
import type { BubbleDragPayload } from "./ContactBubble";
import type { Campaign } from "@/hooks/useCampaigns";

interface Props {
  campaign: Campaign;
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
  onAgentClick: (a: LiveAgent) => void;
}

/**
 * One graph per active campaign. Filters arrived / IVR / queue / finished
 * contacts and agents down to just this campaign's scope, then renders the
 * sequential Llegada → IVR → fan-out flow using FlowView.
 */
export function CampaignFlowCard({
  campaign,
  liveData,
  contactToCampaign,
  config,
  selectedIds,
  isPinned,
  onBubbleClick,
  onTogglePin,
  onContactDroppedOnAgent,
  onAgentClick,
}: Props) {
  const { agents: assignedAgents, assign } = useCampaignAgents(
    campaign.campaignId
  );
  const assignedUserIds = useMemo(
    () => new Set(assignedAgents.map((a) => a.userId)),
    [assignedAgents]
  );

  // Split live agents: assigned to this campaign (in flow) vs unassigned (pool).
  const { flowAgents, poolAgents } = useMemo(() => {
    const all = liveData.agents || [];
    const inCampaign = all.filter((a) => assignedUserIds.has(a.userId));
    const outside = all.filter((a) => !assignedUserIds.has(a.userId));
    return { flowAgents: inCampaign, poolAgents: outside };
  }, [liveData.agents, assignedUserIds]);

  // Filter contact lists to only the ones belonging to this campaign.
  const belongsToCampaign = (c: PipelineContact): boolean => {
    // Direct attribute from Lambda (campaignId set explicitly).
    const direct = c.campaignId;
    if (direct && direct === campaign.campaignId) return true;
    // Fallback via contactToCampaign map.
    const meta = contactToCampaign.get(c.contactId);
    return meta?.campaignId === campaign.campaignId;
  };

  // Start from the full stage data, apply global user filters, then per-campaign.
  const stages = usePipelineStages(
    liveData,
    {
      queueId: config.queueId === "ALL" ? null : config.queueId,
      channel: config.channel === "ALL" ? null : config.channel,
      query: config.query,
      hideFinished: !config.showFinished,
      hideIvr: !config.showIvr,
      // Only this campaign's contacts:
      campaignId: campaign.campaignId,
    },
    contactToCampaign
  );

  const arrivedContacts = stages.find((s) => s.id === "ARRIVED")?.contacts || [];
  const ivrContacts = stages.find((s) => s.id === "IN_IVR")?.contacts || [];
  const inQueueForCampaign =
    stages.find((s) => s.id === "IN_QUEUE")?.contacts || [];
  const finishedContacts =
    stages.find((s) => s.id === "FINISHED")?.contacts || [];

  const agentQueueMap = useAgentQueueMap(flowAgents, inQueueForCampaign);

  // Retry-scheduled rows (campaign-specific filter via campaignId).
  const retryScheduled = ((liveData.retryScheduled || []) as PipelineContact[])
    .filter(belongsToCampaign);

  const finishedBuckets = useFinishedBuckets(finishedContacts, retryScheduled);

  const onAssignAgent = async (userId: string) => {
    try {
      await assign([userId], []);
      toast.success(`Agente asignado a ${campaign.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al asignar");
    }
  };
  const onUnassignAgent = async (userId: string) => {
    try {
      await assign([], [userId]);
      toast.success(`Agente removido de ${campaign.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al remover");
    }
  };

  return (
    <FlowView
      agents={flowAgents}
      unassignedAgents={poolAgents}
      activeLabel={`${campaign.name} · ${campaign.status}`}
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
      onAssignAgent={onAssignAgent}
      onUnassignAgent={onUnassignAgent}
      onAgentClick={onAgentClick}
    />
  );
}
