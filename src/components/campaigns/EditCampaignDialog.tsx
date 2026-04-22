import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useContactFlows, useSourcePhones } from "@/hooks/useContactFlows";
import { useQueues } from "@/hooks/useQueues";
import { useFlowQueues } from "@/hooks/useFlowQueues";
import { useCampaignMutations } from "@/hooks/useCampaignMutations";
import type { Campaign } from "@/hooks/useCampaigns";

const DIAL_MODES = [
  { value: "progressive", label: "Progressive (1 llamada por agente libre)" },
  { value: "power", label: "Power (2 llamadas por agente libre)" },
  { value: "agentless", label: "Agentless (IVR sin agente)" },
];

const TIMEZONES = [
  { value: "America/Lima", label: "Perú (Lima) — UTC-5" },
  { value: "America/Bogota", label: "Colombia — UTC-5" },
  { value: "America/Mexico_City", label: "México — UTC-6" },
  { value: "America/Santiago", label: "Chile — UTC-3" },
  { value: "America/Buenos_Aires", label: "Argentina — UTC-3" },
  { value: "America/New_York", label: "USA (Eastern) — UTC-5" },
  { value: "Europe/Madrid", label: "España — UTC+1" },
];

interface Props {
  campaign: Campaign | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function EditCampaignDialog({ campaign, open, onClose, onSaved }: Props) {
  const { flows, loading: flowsLoading } = useContactFlows();
  const { phones, loading: phonesLoading } = useSourcePhones();
  const { queues, loading: queuesLoading } = useQueues();
  const { update, pending } = useCampaignMutations();
  // Tracks whether the admin explicitly changed the queue picker (if so, don't auto-override)
  const [queueTouched, setQueueTouched] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourcePhoneNumber, setSourcePhoneNumber] = useState("");
  const [contactFlowId, setContactFlowId] = useState("");
  const [campaignQueueId, setCampaignQueueId] = useState("");
  const [dialMode, setDialMode] = useState("progressive");
  const [concurrency, setConcurrency] = useState(1);
  const [timezone, setTimezone] = useState("America/Lima");
  const [windowStartHour, setWindowStartHour] = useState(9);
  const [windowEndHour, setWindowEndHour] = useState(18);
  const [retryNoAnswerMinutes, setRetryNoAnswerMinutes] = useState(30);
  const [retryMaxAttempts, setRetryMaxAttempts] = useState(3);

  // Introspect the chosen flow: pulls every queue referenced in its JSON,
  // so we can offer an auto-pick for the admin.
  const { data: flowQueues, loading: flowQueuesLoading } = useFlowQueues(
    contactFlowId || null
  );

  // When the flow changes and the admin hasn't manually picked a queue,
  // auto-select the primary queue detected in that flow.
  useEffect(() => {
    if (queueTouched) return;
    const primary = flowQueues?.primaryQueue;
    if (primary && !primary.isDynamic) {
      setCampaignQueueId(primary.queueId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowQueues?.primaryQueue?.queueId]);

  useEffect(() => {
    if (campaign && open) {
      setName(campaign.name || "");
      setDescription(campaign.description || "");
      setSourcePhoneNumber(campaign.sourcePhoneNumber || "");
      setContactFlowId(campaign.contactFlowId || "");
      setCampaignQueueId(
        (campaign as unknown as { campaignQueueId?: string })
          .campaignQueueId || ""
      );
      setQueueTouched(false);
      setDialMode(campaign.dialMode || "progressive");
      setConcurrency(Number(campaign.concurrency || 1));
      setTimezone(campaign.timezone || "America/Lima");
      setWindowStartHour(Number(campaign.windowStartHour ?? 9));
      setWindowEndHour(Number(campaign.windowEndHour ?? 18));
      setRetryNoAnswerMinutes(Number(campaign.retryNoAnswerMinutes ?? 30));
      setRetryMaxAttempts(Number(campaign.retryMaxAttempts ?? 3));
    }
    // Key on campaignId (not the whole object) so parent re-renders from the
    // 3s stats poll don't reset the form — only actual campaign switches do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.campaignId, open]);

  if (!campaign) return null;

  const terminalState =
    campaign.status === "COMPLETED" || campaign.status === "CANCELLED";

  const handleSave = async () => {
    try {
      const flow = flows.find((f) => f.id === contactFlowId);
      const queue = queues.find((q) => q.id === campaignQueueId);
      await update({
        campaignId: campaign.campaignId,
        name: name.trim(),
        description: description.trim(),
        sourcePhoneNumber,
        contactFlowId,
        contactFlowName: flow?.name,
        campaignQueueId: campaignQueueId || undefined,
        campaignQueueName: queue?.name,
        dialMode: dialMode as "progressive" | "power" | "agentless",
        concurrency,
        timezone,
        windowStartHour,
        windowEndHour,
        retryNoAnswerMinutes,
        retryMaxAttempts,
      });
      toast.success("Campaña actualizada");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo actualizar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar campaña</DialogTitle>
          <DialogDescription>
            {terminalState
              ? `No se puede editar una campaña ${campaign.status}. Clónala para modificarla.`
              : `Status actual: ${campaign.status} · los cambios se aplican al próximo tick del dialer.`}
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={terminalState} className="space-y-4 disabled:opacity-60">
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Descripción</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Número saliente</Label>
              <Select
                value={sourcePhoneNumber}
                onValueChange={(v) => setSourcePhoneNumber(v || "")}
                disabled={phonesLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Elegir número">
                    {sourcePhoneNumber || (phonesLoading ? "Cargando..." : "Elegir número")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {phones.map((p) => (
                    <SelectItem key={p.phoneNumberId} value={p.phoneNumber}>
                      {p.phoneNumber} · {p.countryCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Contact flow</Label>
              <Select
                value={contactFlowId}
                onValueChange={(v) => setContactFlowId(v || "")}
                disabled={flowsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Elegir flow">
                    {flows.find((f) => f.id === contactFlowId)?.name ||
                      campaign.contactFlowName ||
                      (flowsLoading ? "Cargando..." : "Elegir flow")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {flows.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Queue destino (para asignar agentes)</Label>
            <Select
              value={campaignQueueId}
              onValueChange={(v) => {
                setCampaignQueueId(v || "");
                setQueueTouched(true);
              }}
              disabled={queuesLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Opcional — elegir queue">
                  {queues.find((q) => q.id === campaignQueueId)?.name ||
                    (campaign as unknown as { campaignQueueName?: string })
                      .campaignQueueName ||
                    (queuesLoading ? "Cargando..." : "Opcional — elegir queue")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {queues.map((q) => (
                  <SelectItem key={q.id} value={q.id}>
                    {q.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Auto-detection hint */}
            {flowQueuesLoading && (
              <p className="text-xs text-muted-foreground">
                🔍 Analizando queues del flow...
              </p>
            )}
            {flowQueues?.primaryQueue && !flowQueues.primaryQueue.isDynamic && (
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                ✓ Detectada automáticamente del flow:{" "}
                <strong>{flowQueues.primaryQueue.queueName}</strong>
                {flowQueues.literalQueues.length > 1 && (
                  <span className="block text-amber-600">
                    El flow referencia {flowQueues.literalQueues.length}{" "}
                    queues. Elegimos la principal — puedes cambiarla.
                  </span>
                )}
              </p>
            )}
            {flowQueues &&
              flowQueues.literalQueues.length === 0 &&
              flowQueues.dynamicQueues.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  ⚠️ El flow usa queue dinámica (desde atributos) — elige
                  manualmente la que quieras usar.
                </p>
              )}
            {flowQueues &&
              flowQueues.literalQueues.length === 0 &&
              flowQueues.dynamicQueues.length === 0 &&
              contactFlowId && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  ⚠️ No se detectó ninguna queue en el flow. Elige manualmente.
                </p>
              )}
            <p className="text-xs text-muted-foreground">
              Esta queue se usará al asignar agentes. El sistema agregará
              automáticamente esta queue al routing profile de cada agente
              asignado, y la removerá cuando los desasignes.
            </p>
          </div>

          {/* AMD notice — currently blocked for PE */}
          <div className="rounded-lg border border-amber-300 bg-gradient-to-br from-amber-50/50 to-orange-50/50 p-3 dark:border-amber-900 dark:from-amber-950/20 dark:to-orange-950/20">
            <div className="flex items-start gap-2">
              <Badge className="mt-0.5 bg-amber-100 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                PRÓXIMAMENTE
              </Badge>
              <div className="flex-1 text-xs">
                <div className="font-semibold text-amber-900 dark:text-amber-200">
                  AMD bloqueado por AWS en Perú
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  AWS solo habilita Answer Machine Detection para destinos
                  US/MX/BR desde us-east-1. Cuando agreguen Perú se activa
                  automáticamente.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Dial mode</Label>
              <Select
                value={dialMode}
                onValueChange={(v) => setDialMode(v || "progressive")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIAL_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Concurrencia</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={concurrency}
                onChange={(e) => setConcurrency(parseInt(e.target.value) || 1)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Zona horaria</Label>
            <Select
              value={timezone}
              onValueChange={(v) => setTimezone(v || "America/Lima")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Ventana desde</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={windowStartHour}
                onChange={(e) =>
                  setWindowStartHour(parseInt(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Ventana hasta</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={windowEndHour}
                onChange={(e) =>
                  setWindowEndHour(parseInt(e.target.value) || 0)
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Retry no-answer (min)</Label>
              <Input
                type="number"
                min={1}
                max={1440}
                value={retryNoAnswerMinutes}
                onChange={(e) =>
                  setRetryNoAnswerMinutes(parseInt(e.target.value) || 30)
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Máx. intentos</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={retryMaxAttempts}
                onChange={(e) =>
                  setRetryMaxAttempts(parseInt(e.target.value) || 3)
                }
              />
            </div>
          </div>
        </fieldset>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending || terminalState || !name.trim()}
          >
            {pending ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="mr-1 h-4 w-4" />
                Guardar cambios
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
