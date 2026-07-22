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
import { BusinessHoursPreview } from "@/components/campaigns/BusinessHoursPreview";
import {
  formatInZone,
  parseDays,
  parseScheduleSnapshot,
  scheduleFromWindow,
  utcIsoToZonedInputs,
  zonedInputsToUtcIso,
} from "@/lib/callWindow";
import { useHoursOfOperation } from "@/hooks/useHoursOfOperation";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Save,
  Search,
  Check,
  AlertTriangle,
  Users,
  UserCheck,
  Headphones,
} from "lucide-react";
import { toast } from "sonner";
import { useContactFlows, useSourcePhones } from "@/hooks/useContactFlows";
import { useQueues } from "@/hooks/useQueues";
import { useFlowQueues } from "@/hooks/useFlowQueues";
import { useCampaignMutations } from "@/hooks/useCampaignMutations";
import { RadioCards } from "@/components/ui/radio-cards";
import { Switch } from "@/components/ui/switch";
import type { Campaign } from "@/hooks/useCampaigns";

// Solo modos POR AGENTE (la operación no usa marcación por pool/agentless). El
// modelo pool sigue soportado en el backend pero no se ofrece en el UI.
const DIAL_MODES = [
  { value: "progressive", label: "Progresivo (1 llamada por agente libre)" },
  { value: "manual", label: "Manual (el agente inicia cada llamada)" },
];

/** Valor centinela del selector: base-ui no admite un SelectItem con value "". */
const MANUAL_HOURS = "__manual__";

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
  const [windowDaysOfWeek, setWindowDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  // Horario de Connect vinculado. Vacío = la campaña usa su ventana propia.
  const [hoursOfOperationId, setHoursOfOperationId] = useState("");
  const [hoursOfOperationName, setHoursOfOperationName] = useState("");
  const { options: hoursOptions } = useHoursOfOperation(open);
  // Reprogramar el arranque. Solo se ofrece mientras la campaña no arrancó
  // (DRAFT / SCHEDULED / PAUSED); el backend rechaza reprogramar una RUNNING.
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  // Fin de vigencia. A diferencia del arranque, se puede mover en caliente:
  // adelantar o extender el cierre de una campaña que ya corre es legítimo.
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("18:00");
  const [retryNoAnswerMinutes, setRetryNoAnswerMinutes] = useState(30);
  const [retryMaxAttempts, setRetryMaxAttempts] = useState(3);
  // Control total — editable en caliente (el dialer re-lee cada tick).
  const [agentRouting, setAgentRouting] = useState<"shared" | "exclusive">("shared");
  const [directConnect, setDirectConnect] = useState(false);
  const [autoAccept, setAutoAccept] = useState(false);

  // Introspect the chosen flow: pulls every queue referenced in its JSON,
  // so we can offer an auto-pick for the admin.
  const { data: flowQueues, loading: flowQueuesLoading } = useFlowQueues(contactFlowId || null);

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
        (campaign as unknown as { campaignQueueId?: string }).campaignQueueId || "",
      );
      setQueueTouched(false);
      setDialMode(campaign.dialMode || "progressive");
      setConcurrency(Number(campaign.concurrency || 1));
      setTimezone(campaign.timezone || "America/Lima");
      setWindowStartHour(Number(campaign.windowStartHour ?? 9));
      setWindowEndHour(Number(campaign.windowEndHour ?? 18));
      setWindowDaysOfWeek(parseDays(campaign.windowDaysOfWeek));
      setHoursOfOperationId(campaign.hoursOfOperationId || "");
      setHoursOfOperationName(campaign.hoursOfOperationName || "");
      const sched = utcIsoToZonedInputs(
        campaign.scheduledStartAt,
        campaign.timezone || "America/Lima",
      );
      setScheduledDate(sched?.date || "");
      setScheduledTime(sched?.time || "09:00");
      const fin = utcIsoToZonedInputs(campaign.scheduledEndAt, campaign.timezone || "America/Lima");
      setEndDate(fin?.date || "");
      setEndTime(fin?.time || "18:00");
      setRetryNoAnswerMinutes(Number(campaign.retryNoAnswerMinutes ?? 30));
      setRetryMaxAttempts(Number(campaign.retryMaxAttempts ?? 3));
      setAgentRouting(campaign.agentRouting === "exclusive" ? "exclusive" : "shared");
      setDirectConnect(campaign.directConnect === true);
      setAutoAccept(campaign.autoAccept === true);
    }
    // Key on campaignId (not the whole object) so parent re-renders from the
    // 3s stats poll don't reset the form — only actual campaign switches do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.campaignId, open]);

  if (!campaign) return null;

  const terminalState = campaign.status === "COMPLETED" || campaign.status === "CANCELLED";

  const isVoice = (campaign?.campaignType || "voice") !== "whatsapp";
  const usesDirectFlow = isVoice && (directConnect || agentRouting === "exclusive");
  // El arranque solo se puede mover si todavía no ocurrió.
  const canReschedule =
    campaign.status === "DRAFT" || campaign.status === "SCHEDULED" || campaign.status === "PAUSED";
  const selectedHours = hoursOptions.find((h) => h.id === hoursOfOperationId) || null;
  const usingConnectHours = !!hoursOfOperationId && !!selectedHours?.schedule;
  // Con Connect elegido manda su horario; si el permiso falta y solo queda la
  // copia guardada, se usa esa; y si no, la ventana propia de la campaña.
  const effectiveSchedule =
    selectedHours?.schedule ||
    (hoursOfOperationId ? parseScheduleSnapshot(campaign.hoursOfOperationSnapshot) : null) ||
    scheduleFromWindow({ timezone, windowStartHour, windowEndHour, windowDaysOfWeek });
  const scheduledIso = canReschedule
    ? zonedInputsToUtcIso(scheduledDate, scheduledTime, effectiveSchedule.timezone)
    : null;
  const endIso = endDate ? zonedInputsToUtcIso(endDate, endTime, effectiveSchedule.timezone) : null;

  const handleSave = async () => {
    if (windowDaysOfWeek.length === 0) {
      toast.error("Marca al menos un día de atención o la campaña no volverá a marcar.");
      return;
    }
    if (canReschedule && scheduledDate && !scheduledIso) {
      toast.error("La fecha de inicio no es válida.");
      return;
    }
    if (scheduledIso && Date.parse(scheduledIso) <= Date.now()) {
      toast.error("La fecha de inicio ya pasó. Elige un momento futuro o quítala.");
      return;
    }
    if (endDate && !endIso) {
      toast.error("La fecha de cierre no es válida.");
      return;
    }
    if (endIso && Date.parse(endIso) <= Date.now()) {
      toast.error("La fecha de cierre ya pasó. Elige un momento futuro o quítala.");
      return;
    }
    if (endIso && scheduledIso && Date.parse(endIso) <= Date.parse(scheduledIso)) {
      toast.error("La campaña no puede cerrar antes de arrancar.");
      return;
    }
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
        // Control total — con direct/exclusive el backend fija el flow directo
        // del tenant (pisa contactFlowId), así que da igual lo elegido arriba.
        ...(isVoice ? { agentRouting, directConnect, autoAccept } : {}),
        campaignQueueId: campaignQueueId || undefined,
        campaignQueueName: queue?.name,
        dialMode: dialMode as "progressive" | "power" | "agentless",
        concurrency,
        timezone,
        windowStartHour,
        windowEndHour,
        windowDaysOfWeek,
        // "" desvincula el horario de Connect y devuelve la campaña a su ventana
        // propia; el backend limpia también el respaldo.
        hoursOfOperationId: usingConnectHours ? hoursOfOperationId : "",
        hoursOfOperationName: usingConnectHours ? selectedHours?.name || "" : "",
        hoursOfOperationSnapshot: usingConnectHours ? selectedHours?.schedule : "",
        // "" borra la programación (update-campaign lo traduce a NULL y devuelve
        // la campaña a borrador). undefined = no tocar.
        ...(canReschedule ? { scheduledStartAt: scheduledIso || "" } : {}),
        // El cierre sí se puede mover en caliente, incluso con la campaña
        // corriendo. "" lo quita.
        scheduledEndAt: endIso || "",
        retryNoAnswerMinutes,
        retryMaxAttempts,
      });
      toast.success(scheduledIso ? "Campaña actualizada y reprogramada" : "Campaña actualizada");
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
              <Label>Flujo de contacto</Label>
              <Select
                value={contactFlowId}
                onValueChange={(v) => setContactFlowId(v || "")}
                disabled={flowsLoading || usesDirectFlow}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Elegir flujo">
                    {usesDirectFlow
                      ? "ARIA-Outbound-Direct (auto)"
                      : flows.find((f) => f.id === contactFlowId)?.name ||
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
              {usesDirectFlow && (
                <p className="text-xs text-muted-foreground">
                  Con conexión directa / exclusivo, ARIA usa su flow directo automáticamente.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Cola destino (para asignar agentes)</Label>
            <Select
              value={campaignQueueId}
              onValueChange={(v) => {
                setCampaignQueueId(v || "");
                setQueueTouched(true);
              }}
              disabled={queuesLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Opcional — elegir cola">
                  {queues.find((q) => q.id === campaignQueueId)?.name ||
                    (campaign as unknown as { campaignQueueName?: string }).campaignQueueName ||
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
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Search size={13} className="shrink-0" /> Analizando queues del flow...
              </p>
            )}
            {flowQueues?.primaryQueue && !flowQueues.primaryQueue.isDynamic && (
              <p className="flex items-start gap-1.5 text-xs text-[var(--accent-green)]">
                <Check size={13} className="mt-0.5 shrink-0" />
                <span>
                  Detectada automáticamente del flow:{" "}
                  <strong>{flowQueues.primaryQueue.queueName}</strong>
                  {flowQueues.literalQueues.length > 1 && (
                    <span className="block text-[var(--accent-amber)]">
                      El flow referencia {flowQueues.literalQueues.length} queues. Elegimos la
                      principal — puedes cambiarla.
                    </span>
                  )}
                </span>
              </p>
            )}
            {flowQueues &&
              flowQueues.literalQueues.length === 0 &&
              flowQueues.dynamicQueues.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-[var(--accent-amber)]">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>
                    El flow usa queue dinámica (desde atributos) — elige manualmente la que quieras
                    usar.
                  </span>
                </p>
              )}
            {flowQueues &&
              flowQueues.literalQueues.length === 0 &&
              flowQueues.dynamicQueues.length === 0 &&
              contactFlowId && (
                <p className="flex items-start gap-1.5 text-xs text-[var(--accent-amber)]">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>No se detectó ninguna queue en el flow. Elige manualmente.</span>
                </p>
              )}
            <p className="text-xs text-muted-foreground">
              Esta queue se usará al asignar agentes. El sistema agregará automáticamente esta queue
              al routing profile de cada agente asignado, y la removerá cuando los desasignes.
            </p>
          </div>

          {/* Control total — ruteo exclusivo + conexión directa + auto-accept.
              Editable en caliente: el dialer re-lee la campaña cada tick. */}
          {isVoice && (
            <div className="space-y-2">
              <Label>Conexión y exclusividad</Label>
              <RadioCards
                value={agentRouting}
                onValueChange={(v) => setAgentRouting(v)}
                aria-label="Ruteo a agentes"
                options={[
                  {
                    value: "shared",
                    label: "Compartido",
                    description: "Contesta cualquier agente disponible de la cola.",
                    icon: <Users size={14} />,
                  },
                  {
                    value: "exclusive",
                    label: "Exclusivo por agente",
                    description:
                      "Cada llamada va SOLO al agente asignado. Sin respuesta en 25 s → se reintenta con otro.",
                    icon: <UserCheck size={14} />,
                    color: "var(--accent-iris, var(--accent))",
                  },
                ]}
              />
              <div className="flex items-center gap-2.5 pt-1 text-sm">
                <Switch checked={directConnect} onCheckedChange={setDirectConnect} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    <Headphones size={12} className="mr-1 inline -translate-y-px" />
                    Conexión directa
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Sin bienvenida ni música de espera.
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2.5 text-sm">
                <Switch checked={autoAccept} onCheckedChange={setAutoAccept} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Auto-contestar en los agentes</span>
                  <span className="block text-xs text-muted-foreground">
                    El softphone del asignado acepta solo; mientras corre la campaña también
                    auto-contesta sus entrantes. Requiere micrófono OK.
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* AMD notice — currently blocked for PE */}
          <div className="rounded-lg border border-[var(--accent-amber-soft)] bg-gradient-to-br from-[var(--accent-amber-soft)] to-[var(--accent-amber-soft)] p-3">
            <div className="flex items-start gap-2">
              <Badge className="mt-0.5 bg-[var(--accent-amber-soft)] text-[10px] text-[var(--accent-amber)]">
                PRÓXIMAMENTE
              </Badge>
              <div className="flex-1 text-xs">
                <div className="font-semibold text-[var(--accent-amber)]">
                  AMD bloqueado por AWS en Perú
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  AWS solo habilita Answer Machine Detection para destinos US/MX/BR desde us-east-1.
                  Cuando agreguen Perú se activa automáticamente.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Modo de marcado</Label>
            <Select value={dialMode} onValueChange={(v) => setDialMode(v || "progressive")}>
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
            {/* Progresivo: el discador marca 1 llamada por agente libre. Manual: el
                agente inicia cada llamada. El ritmo lo dan los agentes asignados —
                por eso ya no hay "concurrencia" que configurar aquí. */}
          </div>

          <div className="space-y-2">
            <Label>Zona horaria</Label>
            <Select value={timezone} onValueChange={(v) => setTimezone(v || "America/Lima")}>
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

          <div className="space-y-2">
            <Label>Horario de atención</Label>
            <Select
              value={hoursOfOperationId || MANUAL_HOURS}
              onValueChange={(v) => setHoursOfOperationId(v === MANUAL_HOURS ? "" : v || "")}
            >
              <SelectTrigger>
                <SelectValue>
                  {hoursOfOperationId
                    ? selectedHours?.name || hoursOfOperationName || "Horario de Connect"
                    : "Horario propio de la campaña"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MANUAL_HOURS}>Horario propio de la campaña</SelectItem>
                {hoursOptions.map((h) => (
                  <SelectItem key={h.id} value={h.id} disabled={!h.schedule}>
                    {h.name} (Amazon Connect){!h.schedule ? " — sin acceso" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!usingConnectHours && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Ventana desde</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={windowStartHour}
                  onChange={(e) => setWindowStartHour(parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label>Ventana hasta</Label>
                <Input
                  type="number"
                  min={0}
                  max={24}
                  value={windowEndHour}
                  onChange={(e) => setWindowEndHour(parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <BusinessHoursPreview
              schedule={effectiveSchedule}
              // Los días de un horario de Connect se cambian en Connect.
              onDaysChange={usingConnectHours ? undefined : setWindowDaysOfWeek}
              scheduledStartAt={scheduledIso}
              compact
            />
          </div>

          <div className="space-y-2">
            <Label>Cierre automático (opcional)</Label>
            <div className="grid grid-cols-[1fr_110px] gap-3">
              <Input
                type="date"
                value={endDate}
                min={scheduledDate || new Date().toISOString().slice(0, 10)}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={!endDate}
              />
            </div>
            <p style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.45 }}>
              {endIso ? (
                <>
                  Se cierra sola el{" "}
                  <strong>{formatInZone(endIso, effectiveSchedule.timezone)}</strong>, aunque queden
                  contactos sin llamar. Vacía la fecha para quitarlo.
                </>
              ) : (
                "Sin fecha de cierre, la campaña corre hasta terminar todos sus contactos."
              )}
            </p>
          </div>

          {canReschedule && (
            <div className="space-y-2">
              <Label>
                {campaign.status === "SCHEDULED" ? "Reprogramar inicio" : "Programar inicio"}
              </Label>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <Input
                  type="date"
                  value={scheduledDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
                <Input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                />
              </div>
              <p style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.45 }}>
                {scheduledIso ? (
                  <>
                    Arranca sola el <strong>{formatInZone(scheduledIso, timezone)}</strong>. Vacía
                    la fecha para volver la campaña a borrador.
                  </>
                ) : (
                  "Sin fecha: la campaña queda en borrador hasta que la inicies a mano."
                )}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Reintento sin respuesta (min)</Label>
              <Input
                type="number"
                min={1}
                max={1440}
                value={retryNoAnswerMinutes}
                onChange={(e) => setRetryNoAnswerMinutes(parseInt(e.target.value) || 30)}
              />
            </div>
            <div className="space-y-2">
              <Label>Máx. intentos</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={retryMaxAttempts}
                onChange={(e) => setRetryMaxAttempts(parseInt(e.target.value) || 3)}
              />
            </div>
          </div>
        </fieldset>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={pending || terminalState || !name.trim()}>
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
