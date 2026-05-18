import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Eye,
  EyeOff,
  RotateCcw,
  Volume2,
  VolumeX,
  Search,
  Filter,
} from "lucide-react";
import type {
  PipelineConfig,
} from "@/hooks/usePipelineConfig";
import type { QueueMeta } from "@/hooks/useLiveQueue";

interface Props {
  open: boolean;
  onClose: () => void;
  config: PipelineConfig;
  update: (patch: Partial<PipelineConfig>) => void;
  reset: () => void;
  queues: QueueMeta[];
  activeCampaigns?: Array<{ campaignId: string; campaignName: string }>;
}

function ToggleRow({
  label,
  hint,
  active,
  onChange,
  OnIcon,
  OffIcon,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onChange: (v: boolean) => void;
  OnIcon?: React.ElementType;
  OffIcon?: React.ElementType;
}) {
  const Icon = active ? OnIcon || Eye : OffIcon || EyeOff;
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <Button
        type="button"
        size="sm"
        variant={active ? "default" : "outline"}
        onClick={() => onChange(!active)}
        className="shrink-0"
      >
        <Icon className="mr-1 h-3.5 w-3.5" />
        {active ? "Activo" : "Oculto"}
      </Button>
    </div>
  );
}

export function PipelineSettings({
  open,
  onClose,
  config,
  update,
  reset,
  queues,
  activeCampaigns = [],
}: Props) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[380px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Personalización
          </SheetTitle>
          <SheetDescription className="text-xs">
            Estos ajustes se guardan en este navegador para este admin.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-6 pb-6">
          {/* Search */}
          <div className="space-y-2">
            <Label className="text-xs">Búsqueda</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={config.query}
                onChange={(e) => update({ query: e.target.value })}
                placeholder="Teléfono, nombre, cola, agente…"
                className="pl-7"
              />
            </div>
          </div>

          {/* Filters */}
          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Filtros
            </Label>
            <div className="space-y-2">
              <Label className="text-xs">Cola</Label>
              <Select
                value={config.queueId}
                onValueChange={(v) => update({ queueId: v || "ALL" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas las colas</SelectItem>
                  {queues.map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Canal</Label>
              <Select
                value={config.channel}
                onValueChange={(v) => update({ channel: v || "ALL" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos</SelectItem>
                  <SelectItem value="VOICE">Voz</SelectItem>
                  <SelectItem value="CHAT">Chat</SelectItem>
                  <SelectItem value="EMAIL">Email</SelectItem>
                  <SelectItem value="TASK">Task</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {activeCampaigns.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs">Campaña</Label>
                <Select
                  value={config.campaignId || "ALL"}
                  onValueChange={(v) =>
                    update({ campaignId: !v || v === "ALL" ? "" : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todas las campañas</SelectItem>
                    {activeCampaigns.map((c) => (
                      <SelectItem key={c.campaignId} value={c.campaignId}>
                        {c.campaignName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Visibility */}
          <div className="space-y-1 rounded-lg border p-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Etapas visibles
            </Label>
            <ToggleRow
              label="En IVR / Flow"
              hint="Ocultar si tu instance no usa IVR"
              active={config.showIvr}
              onChange={(v) => update({ showIvr: v })}
            />
            <ToggleRow
              label="Finalizado"
              hint="Ventana de 10 min después de disconnect"
              active={config.showFinished}
              onChange={(v) => update({ showFinished: v })}
            />
            <ToggleRow
              label="Panel de agentes"
              hint="Muestra el grid de agentes debajo del pipeline"
              active={config.showAgents}
              onChange={(v) => update({ showAgents: v })}
            />
            <ToggleRow
              label="Línea de tiempo 15 min"
              hint="Tira arriba del pipeline con el histórico de transiciones"
              active={config.showTimeline}
              onChange={(v) => update({ showTimeline: v })}
            />
          </div>

          {/* Campaign detail panels */}
          <div className="space-y-1 rounded-lg border p-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Detalle de campaña
            </Label>
            <ToggleRow
              label="Panel de progreso"
              hint="KPIs ampliados: tasa éxito, llamadas/min, ETA, pendientes"
              active={config.showCampaignProgress}
              onChange={(v) => update({ showCampaignProgress: v })}
            />
            <ToggleRow
              label="Feed de llamadas en vivo"
              hint="Cards animados desde arriba mostrando cada llamada y su evolución"
              active={config.showCampaignFeed}
              onChange={(v) => update({ showCampaignFeed: v })}
            />
            <ToggleRow
              label="Chime al entrar llamada"
              hint="Beep suave cuando una nueva llamada aparece en el feed"
              active={config.feedSoundEnabled}
              onChange={(v) => update({ feedSoundEnabled: v })}
              OnIcon={Volume2}
              OffIcon={VolumeX}
            />
          </div>

          {/* Bubble style */}
          <div className="space-y-1 rounded-lg border p-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Estilo
            </Label>
            <ToggleRow
              label="Modo compacto"
              hint="Burbujas más pequeñas para ver muchas a la vez"
              active={config.compact}
              onChange={(v) => update({ compact: v })}
            />
            <ToggleRow
              label="Sonar alertas"
              hint="Beep cuando una llamada supera el umbral crítico"
              active={config.soundOnUrgent}
              onChange={(v) => update({ soundOnUrgent: v })}
              OnIcon={Volume2}
              OffIcon={VolumeX}
            />
          </div>

          {/* Thresholds */}
          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Umbrales
            </Label>
            <div className="space-y-2">
              <Label className="text-xs">
                Advertencia a los{" "}
                <span className="font-mono">{config.warnSeconds}s</span>
              </Label>
              <Input
                type="number"
                min={10}
                max={600}
                step={5}
                value={config.warnSeconds}
                onChange={(e) =>
                  update({
                    warnSeconds: Math.max(
                      10,
                      Math.min(600, Number(e.target.value) || 60)
                    ),
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">
                Crítico a los{" "}
                <span className="font-mono">{config.urgentSeconds}s</span>
              </Label>
              <Input
                type="number"
                min={config.warnSeconds + 5}
                max={1800}
                step={10}
                value={config.urgentSeconds}
                onChange={(e) =>
                  update({
                    urgentSeconds: Math.max(
                      config.warnSeconds + 5,
                      Math.min(1800, Number(e.target.value) || 120)
                    ),
                  })
                }
              />
            </div>
          </div>

          {/* Reset */}
          <div className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={reset}
              className="w-full"
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Restablecer valores por defecto
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
