import { useEffect, useMemo, useRef, useState } from "react";
import { DndProvider, useDragLayer } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Button } from "@/components/ui/button";
import { Loader2, X, Square, Megaphone, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useLiveQueue, type LiveAgent } from "@/hooks/useLiveQueue";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useActiveCampaigns } from "@/hooks/useActiveCampaigns";
import { usePipelineStages, type PipelineContact } from "@/hooks/usePipelineStages";
import { usePipelineConfig } from "@/hooks/usePipelineConfig";
import { usePipelineHistory } from "@/hooks/usePipelineHistory";
import { CampaignFlowCard } from "@/components/pipeline/CampaignFlowCard";
import { GeneralPipelineCard } from "@/components/pipeline/GeneralPipelineCard";
import { PinnedCampaignCard } from "@/components/pipeline/PinnedCampaignCard";
import { usePinnedCampaigns } from "@/hooks/usePinnedCampaigns";
import { TimelineStrip } from "@/components/pipeline/TimelineStrip";
import { ContactDetailDrawer } from "@/components/pipeline/ContactDetailDrawer";
import { PipelineSettings } from "@/components/pipeline/PipelineSettings";
import { QueueManagerHeader, type QueueKpis } from "@/components/pipeline/QueueManagerHeader";
import { AgentActionsDialog } from "@/components/queue/AgentActionsDialog";
import { AuditLogPanel } from "@/components/queue/AuditLogPanel";
import { ActiveCampaignsPanel } from "@/components/queue/ActiveCampaignsPanel";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { BubbleDragPayload } from "@/components/pipeline/ContactBubble";

export function QueueManagerPage() {
  // DndProvider must wrap any children that call useDragLayer / useDrag / useDrop.
  return (
    <DndProvider backend={HTML5Backend}>
      <QueueManagerInner />
    </DndProvider>
  );
}

function QueueManagerInner() {
  // Pause live polling while the admin is actively dragging a bubble, so the
  // UI doesn't flicker when a stale snapshot arrives mid-transfer.
  const isDragging = useDragLayer((m) => m.isDragging());

  const { data, loading, error, refresh } = useLiveQueue(3000, isDragging);
  const { data: activeCampaigns, loading: campaignsLoading } = useActiveCampaigns(
    3000
  );
  const { transferContact, stopContact } = useAdminActions();
  const { confirm, confirmDialog } = useConfirm();
  const {
    config,
    update,
    reset,
    togglePin,
    isPinned,
    togglePinCampaign,
    isCampaignPinned,
  } = usePipelineConfig();

  // Pinned campaigns we need to render as historical cards when they're not
  // actively running. We only fetch stats for ids that are NOT already in
  // `runningCampaigns` — otherwise we'd double-poll the same data.
  const pinnedIdsNotRunning = useMemo(() => {
    const runningIds = new Set(
      (activeCampaigns?.campaigns || [])
        .filter(
          (c) =>
            c.campaign.status === "RUNNING" || c.campaign.status === "PAUSED"
        )
        .map((c) => c.campaign.campaignId)
    );
    return config.pinnedCampaignIds.filter((id) => !runningIds.has(id));
  }, [config.pinnedCampaignIds, activeCampaigns?.campaigns]);
  const { data: pinnedStats } = usePinnedCampaigns(pinnedIdsNotRunning);

  const [selectedContact, setSelectedContact] = useState<PipelineContact | null>(
    null
  );
  const [selectedAgent, setSelectedAgent] = useState<LiveAgent | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  /** Multi-selection of bubbles for bulk actions. */
  const [multiSelected, setMultiSelected] = useState<string[]>([]);

  // Click a bubble → open drawer. Ctrl/⌘/Shift-click → toggle multi-select.
  const onBubbleClick = (c: PipelineContact, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      setMultiSelected((prev) =>
        prev.includes(c.contactId)
          ? prev.filter((id) => id !== c.contactId)
          : [...prev, c.contactId]
      );
      return;
    }
    setSelectedContact(c);
  };

  // Running campaigns drive how many flow/board cards we render.
  const runningCampaigns = useMemo(() => {
    const list = activeCampaigns?.campaigns || [];
    return list.filter(
      (c) => c.campaign.status === "RUNNING" || c.campaign.status === "PAUSED"
    );
  }, [activeCampaigns]);

  // If the active tab is a specific campaign but that campaign is no longer
  // running, fall back to "ALL" so the user isn't stuck on a dead tab.
  useEffect(() => {
    if (config.activeCampaignTab === "ALL") return;
    const stillRunning = runningCampaigns.some(
      (c) => c.campaign.campaignId === config.activeCampaignTab
    );
    if (!stillRunning) update({ activeCampaignTab: "ALL" });
  }, [config.activeCampaignTab, runningCampaigns, update]);

  // Which campaigns actually render based on the active tab.
  const visibleCampaigns = useMemo(() => {
    if (config.activeCampaignTab === "ALL") return runningCampaigns;
    return runningCampaigns.filter(
      (c) => c.campaign.campaignId === config.activeCampaignTab
    );
  }, [runningCampaigns, config.activeCampaignTab]);

  // Derive the 5-stage pipeline (page-level, used for KPIs + alert sound).
  const stages = usePipelineStages(
    data,
    {
      queueId: config.queueId === "ALL" ? null : config.queueId,
      channel: config.channel === "ALL" ? null : config.channel,
      campaignId:
        config.activeCampaignTab !== "ALL"
          ? config.activeCampaignTab
          : config.campaignId || null,
      query: config.query,
      hideFinished: !config.showFinished,
      hideIvr: !config.showIvr,
    },
    activeCampaigns?.contactToCampaign
  );

  // Track pipeline history (last 15 min) for the timeline strip.
  const history = usePipelineHistory(data);

  // Alert sound when any bubble in the current view passes the urgent threshold.
  const alertedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!config.soundOnUrgent) return;
    for (const s of stages) {
      if (s.id === "FINISHED") continue;
      for (const c of s.contacts) {
        const sec = c.stageEnteredAt
          ? Math.round((Date.now() - new Date(c.stageEnteredAt).getTime()) / 1000)
          : c.waitingSeconds;
        if (sec >= config.urgentSeconds && !alertedRef.current.has(c.contactId)) {
          alertedRef.current.add(c.contactId);
          try {
            const ac = new (window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext })
                .webkitAudioContext)();
            const o = ac.createOscillator();
            const g = ac.createGain();
            o.connect(g);
            g.connect(ac.destination);
            o.frequency.value = 660;
            g.gain.value = 0.05;
            o.start();
            setTimeout(() => {
              o.stop();
              ac.close();
            }, 220);
          } catch {
            /* older browsers — ignore */
          }
        }
      }
    }
  }, [stages, config.soundOnUrgent, config.urgentSeconds]);

  // ── KPIs for the header ─────────────────────────────────────────────────
  // "Críticas" used to count every active contact whose wait passed the
  // urgent threshold — including the pool pendientes. That's misleading
  // because pool contacts are just leads sitting in the campaign DB
  // waiting to be dialed; their "age" isn't a wait-for-agent problem.
  // We restrict the urgency / avg / oldest tracking to the stages where
  // long waits are genuinely concerning: someone is on the line waiting
  // for someone (or something) to pick them up.
  const urgentStages = new Set(["ARRIVED", "IN_QUEUE", "WITH_AGENT"]);
  const kpis: QueueKpis = useMemo(() => {
    let total = 0;
    let critical = 0;
    let waitSum = 0;
    let waitCount = 0;
    let oldest = 0;
    for (const s of stages) {
      if (s.id === "FINISHED") continue;
      for (const c of s.contacts) {
        total += 1;
        // Only stages where waiting hurts contribute to urgency/avg/oldest.
        // The pool pendientes (IN_IVR slot) inflate the numbers without
        // representing a real wait-for-agent situation.
        if (!urgentStages.has(s.id)) continue;
        const sec = c.stageEnteredAt
          ? Math.round(
              (Date.now() - new Date(c.stageEnteredAt).getTime()) / 1000
            )
          : c.waitingSeconds;
        waitSum += sec;
        waitCount += 1;
        if (sec > oldest) oldest = sec;
        if (sec >= config.urgentSeconds) critical += 1;
      }
    }
    const allAgents = data?.agents || [];
    const agentsAvailable = allAgents.filter(
      (a) =>
        (a.statusName || "").toLowerCase() === "available" && !a.activeContact
    ).length;
    return {
      totalActive: total,
      critical,
      avgWaitSeconds: waitCount > 0 ? Math.round(waitSum / waitCount) : 0,
      oldestSeconds: oldest,
      agentsAvailable,
      agentsTotal: allAgents.length,
    };
  }, [stages, data?.agents, config.urgentSeconds]);

  // ── Drag handlers ───────────────────────────────────────────────────────
  const onContactDroppedOnAgent = async (
    agent: LiveAgent,
    payload: BubbleDragPayload
  ) => {
    try {
      await transferContact(payload.contactId, { userId: agent.userId });
      toast.success(
        `Transferida ${payload.phone || "llamada"} → ${agent.username}`
      );
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error en transferencia");
    }
  };

  // Board-only: drop a WITH_AGENT bubble back onto "En cola".
  const onContactDroppedOnQueue = async (payload: BubbleDragPayload) => {
    const queues = data?.queues || [];
    if (queues.length === 0) {
      toast.error("No hay colas configuradas");
      return;
    }
    if (queues.length === 1) {
      try {
        await transferContact(payload.contactId, { queueId: queues[0].id });
        toast.success(`Movida a cola "${queues[0].name}"`);
        refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error");
      }
      return;
    }
    // Multiple queues: open the drawer so the admin can pick explicitly.
    toast.info("Elegí la cola de destino en el panel");
    setSelectedContact({
      contactId: payload.contactId,
      phone: payload.phone,
      channel: "VOICE",
      queueId: null,
      queueName: null,
      initiationMethod: "",
      initiationTimestamp: null,
      state: "IN_QUEUE",
      waitingSeconds: 0,
    });
  };

  // Board-only: drop onto "Finalizados" → stopContact.
  const onContactDroppedOnFinished = async (payload: BubbleDragPayload) => {
    const ok = await confirm({
      title: `¿Forzar desconexión de ${payload.phone || "esta llamada"}?`,
      destructive: true,
      confirmLabel: "Forzar desconexión",
    });
    if (!ok) return;
    try {
      await stopContact(payload.contactId);
      toast.success("Llamada terminada");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al terminar");
    }
  };

  return (
    <div className="view col" style={{ gap: 16 }}>
      <QueueManagerHeader
        config={config}
        onConfigChange={update}
        kpis={kpis}
        activeCampaigns={activeCampaigns}
        onShowSettings={() => setShowSettings(true)}
        onToggleAudit={() => setShowAudit((v) => !v)}
        auditOpen={showAudit}
        onRefresh={refresh}
        loading={loading}
      />

      {loading && !data && (
        <div className="flex items-center justify-center rounded-lg border bg-card py-10 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Cargando live queue…
        </div>
      )}
      {error && !data && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      )}

      {showAudit && <AuditLogPanel />}

      {/* Active campaigns overview — only shown on the "All" tab AND when
          there are 2+ running campaigns to compare. With a single campaign
          the per-card CampaignProgressPanel below already covers the same
          info; rendering both is just visual noise. */}
      {config.activeCampaignTab === "ALL" && runningCampaigns.length >= 2 && (
        <ActiveCampaignsPanel
          data={activeCampaigns}
          loading={campaignsLoading}
        />
      )}

      {/* ── Flow or Board rendering ────────────────────────────────────
          Order on "Todas":
            1. Live cards (one per running campaign)
            2. Pinned historical cards (one per pinned-and-not-running)
            3. General pipeline card (inbound / unassigned) if no live cards
            4. Empty state if nothing at all
          Specific-campaign tab renders just that campaign's live card, or
          the empty state if the campaign isn't running anymore. */}
      {data && (
        <>
          {visibleCampaigns.map((c) => (
            <CampaignFlowCard
              key={c.campaign.campaignId}
              campaign={c.campaign}
              liveData={data}
              contactToCampaign={
                activeCampaigns?.contactToCampaign || new Map()
              }
              config={config}
              selectedIds={multiSelected}
              isPinned={isPinned}
              onBubbleClick={onBubbleClick}
              onTogglePin={togglePin}
              onContactDroppedOnAgent={onContactDroppedOnAgent}
              onContactDroppedOnQueue={onContactDroppedOnQueue}
              onContactDroppedOnFinished={onContactDroppedOnFinished}
              onAgentClick={setSelectedAgent}
              isCampaignPinned={isCampaignPinned(c.campaign.campaignId)}
              onTogglePinCampaign={togglePinCampaign}
              onToggleFeedSound={() =>
                update({ feedSoundEnabled: !config.feedSoundEnabled })
              }
            />
          ))}

          {config.activeCampaignTab === "ALL" &&
            Array.from(pinnedStats.values()).map((stats) => (
              <PinnedCampaignCard
                key={stats.campaign.campaignId}
                stats={stats}
                onUnpin={() => togglePinCampaign(stats.campaign.campaignId)}
              />
            ))}

          {visibleCampaigns.length === 0 &&
            config.activeCampaignTab === "ALL" &&
            (kpis.totalActive > 0 ||
              (data.finished?.length || 0) > 0) && (
              <GeneralPipelineCard
                liveData={data}
                contactToCampaign={
                  activeCampaigns?.contactToCampaign || new Map()
                }
                config={config}
                selectedIds={multiSelected}
                isPinned={isPinned}
                onBubbleClick={onBubbleClick}
                onTogglePin={togglePin}
                onContactDroppedOnAgent={onContactDroppedOnAgent}
                onContactDroppedOnQueue={onContactDroppedOnQueue}
                onContactDroppedOnFinished={onContactDroppedOnFinished}
                onAgentClick={setSelectedAgent}
              />
            )}

          {visibleCampaigns.length === 0 &&
            (config.activeCampaignTab !== "ALL" ||
              (pinnedStats.size === 0 &&
                kpis.totalActive === 0 &&
                (data.finished?.length || 0) === 0)) && (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-card/40 p-12 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-cyan-500 text-white shadow-md">
                  <Megaphone className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-base font-semibold">
                    {runningCampaigns.length === 0
                      ? "No hay tráfico activo"
                      : "No hay coincidencias para este filtro"}
                  </div>
                  <div className="mt-1 max-w-md text-sm text-muted-foreground">
                    {runningCampaigns.length === 0
                      ? "Sin campañas corriendo ni contactos en cola. Lanzá una campaña o esperá a que entre una llamada para ver el pipeline."
                      : "Probá cambiar el tab de campaña o los filtros."}
                  </div>
                </div>
                {runningCampaigns.length === 0 && (
                  <Link to="/campaigns">
                    <Button size="sm" className="mt-1">
                      Ir a Campañas
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>
                  </Link>
                )}
              </div>
            )}

          {/* 15-min timeline strip — secondary, historical context. Sits
              AFTER the campaign card so the admin sees the live state
              first and the recent history below. Only renders when there
              are actual events to draw. */}
          {config.showTimeline && history.events.length > 0 && (
            <TimelineStrip ticks={history.ticks} events={history.events} />
          )}
        </>
      )}

      {/* Drawers */}
      <ContactDetailDrawer
        contact={selectedContact}
        agents={data?.agents || []}
        queues={data?.queues || []}
        campaignInfo={
          selectedContact
            ? activeCampaigns?.contactToCampaign?.get(selectedContact.contactId)
            : undefined
        }
        open={!!selectedContact}
        onClose={() => setSelectedContact(null)}
        onActionCompleted={() => refresh()}
      />
      <AgentActionsDialog
        agent={selectedAgent}
        statuses={data?.statuses || []}
        open={!!selectedAgent}
        onClose={() => setSelectedAgent(null)}
        onActionCompleted={() => refresh()}
      />

      {/* Bulk-actions toolbar — floats at the bottom while multi-selecting */}
      {multiSelected.length > 0 && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 animate-in fade-in slide-in-from-bottom">
          <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-2 shadow-lg backdrop-blur-sm">
            <span className="text-sm font-semibold">
              {multiSelected.length} seleccionadas
            </span>
            <span className="h-4 w-px bg-border" />
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (
                  !(await confirm({
                    title: `¿Forzar disconnect de ${multiSelected.length} llamadas?`,
                    destructive: true,
                    confirmLabel: "Forzar disconnect",
                  }))
                )
                  return;
                for (const id of multiSelected) {
                  try {
                    await stopContact(id);
                  } catch (e) {
                    toast.error(
                      `Falla al terminar ${id.slice(0, 8)}: ${
                        e instanceof Error ? e.message : "error"
                      }`
                    );
                  }
                }
                toast.success(`${multiSelected.length} llamadas terminadas`);
                setMultiSelected([]);
                refresh();
              }}
            >
              <Square className="mr-1 h-3.5 w-3.5" />
              Terminar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMultiSelected([])}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Deseleccionar
            </Button>
          </div>
        </div>
      )}

      <PipelineSettings
        open={showSettings}
        onClose={() => setShowSettings(false)}
        config={config}
        update={update}
        reset={reset}
        queues={data?.queues || []}
        activeCampaigns={runningCampaigns.map((c) => ({
          campaignId: c.campaign.campaignId,
          campaignName: c.campaign.name,
        }))}
      />
      {confirmDialog}
    </div>
  );
}
