import { useEffect, useMemo, useRef, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Button } from "@/components/ui/button";
import {
  Headphones,
  RefreshCw,
  ScrollText,
  Loader2,
  Sliders,
  Search,
  Radio,
  X,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { useLiveQueue, type LiveAgent } from "@/hooks/useLiveQueue";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useActiveCampaigns } from "@/hooks/useActiveCampaigns";
import { usePipelineStages, type PipelineContact } from "@/hooks/usePipelineStages";
import { usePipelineConfig } from "@/hooks/usePipelineConfig";
import { usePipelineHistory } from "@/hooks/usePipelineHistory";
import { CampaignFlowCard } from "@/components/pipeline/CampaignFlowCard";
import { Megaphone, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { TimelineStrip } from "@/components/pipeline/TimelineStrip";
import { ContactDetailDrawer } from "@/components/pipeline/ContactDetailDrawer";
import { PipelineSettings } from "@/components/pipeline/PipelineSettings";
import { AgentActionsDialog } from "@/components/queue/AgentActionsDialog";
import { AuditLogPanel } from "@/components/queue/AuditLogPanel";
import { ActiveCampaignsPanel } from "@/components/queue/ActiveCampaignsPanel";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { BubbleDragPayload } from "@/components/pipeline/ContactBubble";
import type { PipelineStageId } from "@/hooks/usePipelineStages";

export function QueueManagerPage() {
  const { data, loading, error, refresh } = useLiveQueue(3000);
  const { data: activeCampaigns, loading: campaignsLoading } =
    useActiveCampaigns(3000);
  const { transferContact, stopContact } = useAdminActions();
  const { config, update, reset, togglePin, isPinned } = usePipelineConfig();

  const [selectedContact, setSelectedContact] =
    useState<PipelineContact | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<LiveAgent | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  /** Multi-selection of bubbles for bulk actions. */
  const [multiSelected, setMultiSelected] = useState<string[]>([]);

  // Handler: click a bubble → open detail drawer, or toggle multi-select
  // if the user holds Ctrl/⌘/Shift.
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

  // Active campaigns as a simpler array for the settings filter dropdown.
  const activeCampaignList = useMemo(() => {
    if (!activeCampaigns?.campaigns) return [];
    return activeCampaigns.campaigns.map((c) => ({
      campaignId: c.campaign.campaignId,
      campaignName: c.campaign.name,
    }));
  }, [activeCampaigns]);

  // Track pipeline history (last 15 min) for the timeline strip + retry animation.
  const history = usePipelineHistory(data);

  // Derive the 5-stage pipeline only for the alert-sound hook (no rendering here).
  const stages = usePipelineStages(
    data,
    {
      queueId: config.queueId === "ALL" ? null : config.queueId,
      channel: config.channel === "ALL" ? null : config.channel,
      campaignId: config.campaignId || null,
      query: config.query,
      hideFinished: !config.showFinished,
      hideIvr: !config.showIvr,
    },
    activeCampaigns?.contactToCampaign
  );

  // Running campaigns drive how many flow graphs we render — one per campaign.
  const runningCampaigns = useMemo(() => {
    const list = activeCampaigns?.campaigns || [];
    return list.filter(
      (c) => c.campaign.status === "RUNNING" || c.campaign.status === "PAUSED"
    );
  }, [activeCampaigns]);

  // Alert sound when any bubble in the current view passes the urgent threshold.
  const alertedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!config.soundOnUrgent) return;
    for (const s of stages) {
      if (s.id === "FINISHED") continue;
      for (const c of s.contacts) {
        const sec = c.stageEnteredAt
          ? Math.round(
              (Date.now() - new Date(c.stageEnteredAt).getTime()) / 1000
            )
          : c.waitingSeconds;
        if (sec >= config.urgentSeconds && !alertedRef.current.has(c.contactId)) {
          alertedRef.current.add(c.contactId);
          try {
            // tiny synthesized beep so we don't ship an audio file
            const ac = new (window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
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

  // Drag handlers ──────────────────────────────────────────────────────────
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

  // Kept for future re-integration if we bring back the pipeline-stage drop
  // targets. Currently unused because FlowView uses per-agent drop zones.
  // @ts-expect-error intentionally unused
  const _onDropOnStage = async (
    stageId: PipelineStageId,
    payload: BubbleDragPayload
  ) => {
    if (stageId === "IN_QUEUE") {
      // If there's only one queue in the system, pick it. Otherwise ask.
      const queues = data?.queues || [];
      if (queues.length === 1) {
        try {
          await transferContact(payload.contactId, { queueId: queues[0].id });
          toast.success(`Movida a cola "${queues[0].name}"`);
          refresh();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Error");
        }
      } else if (queues.length > 1) {
        // Open the detail drawer so the admin can pick a queue.
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
      }
    }
  };

  const headerCounts = useMemo(() => {
    const total = stages.reduce((n, s) => n + s.contacts.length, 0);
    const urgent = stages.reduce(
      (n, s) =>
        n +
        (s.id === "FINISHED"
          ? 0
          : s.contacts.filter((c) => {
              const sec = c.stageEnteredAt
                ? Math.round(
                    (Date.now() - new Date(c.stageEnteredAt).getTime()) /
                      1000
                  )
                : c.waitingSeconds;
              return sec >= config.urgentSeconds;
            }).length),
      0
    );
    return { total, urgent };
  }, [stages, config.urgentSeconds]);

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-md">
              <Headphones className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                Queue Manager
              </h2>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Radio className="h-3 w-3 animate-pulse text-emerald-500" />
                Live · refresh cada 3s · arrastrá una burbuja sobre un agente
                disponible para transferirla
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Quick search in header */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={config.query}
                onChange={(e) => update({ query: e.target.value })}
                placeholder="Buscar contacto…"
                className="h-9 w-48 pl-7 text-sm"
              />
            </div>

            {headerCounts.total > 0 && (
              <Badge className="bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200">
                {headerCounts.total} en pipeline
              </Badge>
            )}
            {headerCounts.urgent > 0 && (
              <Badge className="animate-pulse bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                {headerCounts.urgent} críticas
              </Badge>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSettings(true)}
            >
              <Sliders className="mr-1 h-4 w-4" />
              Personalizar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAudit((v) => !v)}
            >
              <ScrollText className="mr-1 h-4 w-4" />
              {showAudit ? "Ocultar audit" : "Audit log"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

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

        {/* Active campaigns strip */}
        <ActiveCampaignsPanel data={activeCampaigns} loading={campaignsLoading} />

        {/* 15-min timeline strip (optional, toggled in Settings) */}
        {data && config.showTimeline && (
          <TimelineStrip ticks={history.ticks} events={history.events} />
        )}

        {/* ── Per-campaign flow graphs ──────────────────────────────────
            One FlowView per RUNNING or PAUSED campaign. When there are
            no active campaigns we show a friendly empty state instead of
            the full dashboard. */}
        {data && runningCampaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-card/40 p-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-cyan-500 text-white shadow-md">
              <Megaphone className="h-6 w-6" />
            </div>
            <div>
              <div className="text-base font-semibold">
                No hay campañas activas
              </div>
              <div className="mt-1 max-w-md text-sm text-muted-foreground">
                El Queue Manager muestra un diagrama de flujo por cada
                campaña en ejecución. Cuando lances una campaña vas a ver
                aquí sus agentes asignados, contactos en cola y llamadas en
                curso.
              </div>
            </div>
            <Link to="/campaigns">
              <Button size="sm" className="mt-1">
                Ir a Campañas
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>
        ) : (
          data &&
          runningCampaigns.map((c) => (
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
              onAgentClick={setSelectedAgent}
            />
          ))
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
                    !confirm(
                      `¿Forzar disconnect de ${multiSelected.length} llamadas?`
                    )
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
          activeCampaigns={activeCampaignList}
        />
      </div>
    </DndProvider>
  );
}
