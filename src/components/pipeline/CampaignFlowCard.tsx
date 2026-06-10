import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FlowView } from "./FlowView";
import { BoardView } from "./BoardView";
import { CampaignProgressPanel } from "./CampaignProgressPanel";
import { CampaignLiveFeed } from "./CampaignLiveFeed";
import { useCampaignAgents } from "@/hooks/useCampaignAgents";
import { useAgentQueueMap } from "@/hooks/useAgentQueueMap";
import { useFinishedBuckets } from "@/hooks/useFinishedBuckets";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { useCampaignStats } from "@/hooks/useCampaignStats";
import { useCampaignActivity } from "@/hooks/useCampaignActivity";
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
  /** Board-only: drop a WITH_AGENT bubble back onto "En cola". */
  onContactDroppedOnQueue?: (payload: BubbleDragPayload) => void;
  /** Board-only: drop onto "Finalizados" → stopContact. */
  onContactDroppedOnFinished?: (payload: BubbleDragPayload) => void;
  onAgentClick: (a: LiveAgent) => void;
  /** When true, the pin button is shown as "pinned" — clicking unpins. */
  isCampaignPinned?: boolean;
  onTogglePinCampaign?: (campaignId: string) => void;
  /** Toggle the soft chime that plays when a new event lands in the feed. */
  onToggleFeedSound?: () => void;
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
  onContactDroppedOnQueue,
  onContactDroppedOnFinished,
  onAgentClick,
  isCampaignPinned,
  onTogglePinCampaign,
  onToggleFeedSound,
}: Props) {
  const { agents: assignedAgents, assign } = useCampaignAgents(
    campaign.campaignId
  );

  // Stats + activity power the progress panel and live feed.
  const { data: campaignStats } = useCampaignStats(
    campaign.campaignId,
    3000
  );
  const { events, journeys, kpis } = useCampaignActivity(
    campaign.campaignId,
    campaignStats
  );

  // Soft chime each time the events list grows. We compare against the
  // previous length so we only beep on additions, not on filter or page-load.
  const prevEventCountRef = useRef(events.length);
  useEffect(() => {
    if (!config.feedSoundEnabled) {
      prevEventCountRef.current = events.length;
      return;
    }
    if (events.length > prevEventCountRef.current) {
      try {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ac = new Ctor();
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = "sine";
        o.frequency.value = 880;
        g.gain.value = 0.035;
        o.connect(g);
        g.connect(ac.destination);
        o.start();
        setTimeout(() => {
          o.stop();
          ac.close();
        }, 120);
      } catch {
        /* audio not available — silently ignore */
      }
    }
    prevEventCountRef.current = events.length;
  }, [events.length, config.feedSoundEnabled]);
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

  const agentQueueMap = useAgentQueueMap(
    flowAgents,
    inQueueForCampaign,
    ivrContacts
  );

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

  // Pin/unpin toolbar rendered above the Flow/Board so the admin can mark
  // the campaign as "keep visible after completion".
  const pinToolbar = onTogglePinCampaign ? (
    <div className="mb-2 flex items-center justify-end">
      <Button
        variant={isCampaignPinned ? "secondary" : "ghost"}
        size="sm"
        onClick={() => onTogglePinCampaign(campaign.campaignId)}
        title={
          isCampaignPinned
            ? "Esta campaña quedará visible como histórico cuando termine. Click para despinnear."
            : "Fijar esta campaña — al terminar se mantendrá visible como histórico hasta despinnear."
        }
        className={isCampaignPinned ? "gap-1.5" : "gap-1.5 text-muted-foreground"}
      >
        {isCampaignPinned ? (
          <>
            <Pin className="h-3.5 w-3.5 fill-current text-[var(--accent-amber)]" />
            Fijada
          </>
        ) : (
          <>
            <PinOff className="h-3.5 w-3.5" />
            Fijar
          </>
        )}
      </Button>
    </div>
  ) : null;

  // Single full-width column. Progress hero metrics at the top take the
  // whole row (no more cramped 360px sidebar), then the agent flow takes
  // the full width, and the live activity feed sits at the bottom.
  const mainView =
    config.viewMode === "board" ? (
      <BoardView
        agents={flowAgents}
        activeLabel={`${campaign.name} · ${campaign.status}`}
        arrived={arrivedContacts}
        inIvr={ivrContacts}
        inQueue={inQueueForCampaign}
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
    ) : (
      <FlowView
        agents={flowAgents}
        unassignedAgents={poolAgents}
        activeLabel={`${campaign.name} · ${campaign.status}`}
        arrived={arrivedContacts}
        inIvr={ivrContacts}
        inQueueByAgent={agentQueueMap.inQueueByAgent}
        pendingBucketByAgent={agentQueueMap.pendingBucketByAgent}
        unassignedPending={agentQueueMap.unassignedPending}
        maxContactsPerAgent={campaign.maxContactsPerAgent}
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

  return (
    <div className="space-y-12">
      {pinToolbar}
      {config.showCampaignProgress && (
        <CampaignProgressPanel
          campaign={campaign}
          stats={campaignStats}
          kpis={kpis}
        />
      )}
      {mainView}
      {config.showCampaignFeed && (
        <CampaignLiveFeed
          events={events}
          journeys={journeys}
          soundEnabled={config.feedSoundEnabled}
          onToggleSound={onToggleFeedSound}
        />
      )}
    </div>
  );
}
