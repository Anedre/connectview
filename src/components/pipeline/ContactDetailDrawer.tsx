import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  ArrowRightLeft,
  Square,
  Headphones,
  User,
  Clock,
  Phone,
  Hash,
  Megaphone,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { PipelineContact } from "@/hooks/usePipelineStages";
import type { LiveAgent, QueueMeta } from "@/hooks/useLiveQueue";

interface Props {
  contact: PipelineContact | null;
  agents: LiveAgent[];
  queues: QueueMeta[];
  campaignInfo?: { campaignId: string; campaignName: string };
  open: boolean;
  onClose: () => void;
  onActionCompleted: () => void;
}

function formatWait(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function stageLabel(state: string): string {
  switch (state) {
    case "ARRIVED":
      return "Recién llegada";
    case "IN_IVR":
      return "Ejecutando IVR / flow";
    case "IN_QUEUE":
      return "Esperando en cola";
    case "WITH_AGENT":
      return "Con agente";
    case "FINISHED":
      return "Finalizada";
    default:
      return state;
  }
}

export function ContactDetailDrawer({
  contact,
  agents,
  queues,
  campaignInfo,
  open,
  onClose,
  onActionCompleted,
}: Props) {
  const { user } = useAuth();
  const { transferContact, stopContact, monitorContact, pending } =
    useAdminActions();
  const { confirm, confirmDialog } = useConfirm();
  const [targetAgent, setTargetAgent] = useState("");
  const [targetQueue, setTargetQueue] = useState("");

  if (!contact) return null;

  const isFinished = contact.state === "FINISHED";
  const availableAgents = agents.filter(
    (a) => a.statusName?.toLowerCase() === "available" && !a.activeContact
  );

  const handleTransferAgent = async () => {
    if (!targetAgent) return;
    try {
      await transferContact(contact.contactId, { userId: targetAgent });
      toast.success("Llamada transferida al agente");
      onActionCompleted();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error en transferencia");
    }
  };

  const handleTransferQueue = async () => {
    if (!targetQueue) return;
    try {
      await transferContact(contact.contactId, { queueId: targetQueue });
      toast.success("Llamada transferida a la cola");
      onActionCompleted();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error en transferencia");
    }
  };

  const handleStop = async () => {
    if (!(await confirm({ title: "¿Forzar disconnect de esta llamada?", description: "Fuerza el disconnect. Irreversible.", destructive: true, confirmLabel: "Forzar disconnect" }))) return;
    try {
      await stopContact(contact.contactId);
      toast.success("Llamada terminada");
      onActionCompleted();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const handleMonitor = async (
    monitorMode: "SILENT_MONITOR" | "BARGE"
  ) => {
    if (!user?.userId) {
      toast.error("No se detectó tu userId");
      return;
    }
    try {
      await monitorContact(contact.contactId, user.userId, monitorMode);
      toast.success(
        monitorMode === "SILENT_MONITOR"
          ? "Escucha iniciada — revisa tu CCP"
          : "Barge-in iniciado — revisa tu CCP"
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const displayName =
    contact.customerName ||
    contact.phone ||
    contact.contactId.slice(0, 8);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[420px] sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4" />
            {displayName}
          </SheetTitle>
          <SheetDescription className="font-mono text-xs">
            {contact.contactId}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-6 pb-6">
          {/* Status summary */}
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-xs">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-semibold">Estado actual</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="flex flex-col">
                <span className="text-muted-foreground">Etapa</span>
                <span className="font-semibold">{stageLabel(contact.state)}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">Canal</span>
                <Badge variant="outline" className="w-fit">
                  {contact.channel}
                </Badge>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">Tiempo en etapa</span>
                <span className="flex items-center gap-1 font-mono">
                  <Clock className="h-3 w-3" />
                  {formatWait(
                    contact.stageEnteredAt
                      ? Math.max(
                          0,
                          Math.floor(
                            (Date.now() -
                              new Date(contact.stageEnteredAt).getTime()) /
                              1000
                          )
                        )
                      : contact.waitingSeconds
                  )}
                </span>
              </div>
              {contact.queueName && (
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Cola</span>
                  <span className="truncate font-semibold">
                    {contact.queueName}
                  </span>
                </div>
              )}
              {contact.agentUsername && (
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Agente</span>
                  <span className="flex items-center gap-1 truncate font-semibold">
                    <User className="h-3 w-3" />
                    {contact.agentUsername}
                  </span>
                </div>
              )}
              {contact.initiationMethod && (
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Método</span>
                  <span className="font-mono">{contact.initiationMethod}</span>
                </div>
              )}
              {campaignInfo && (
                <div className="col-span-2 flex flex-col">
                  <span className="text-muted-foreground">Campaña</span>
                  <span className="flex items-center gap-1 truncate font-semibold text-[var(--accent-amber)]">
                    <Megaphone className="h-3 w-3" />
                    {campaignInfo.campaignName}
                  </span>
                </div>
              )}
              {contact.phone && (
                <div className="col-span-2 flex flex-col">
                  <span className="text-muted-foreground">Teléfono</span>
                  <span className="font-mono">{contact.phone}</span>
                </div>
              )}
              {contact.disconnectReason && (
                <div className="col-span-2 flex flex-col">
                  <span className="text-muted-foreground">Motivo fin</span>
                  <Badge variant="outline" className="w-fit">
                    {contact.disconnectReason}
                  </Badge>
                </div>
              )}
              <div className="col-span-2 flex flex-col">
                <span className="text-muted-foreground">Iniciada</span>
                <span className="font-mono">
                  <Hash className="mr-1 inline h-3 w-3" />
                  {contact.initiationTimestamp
                    ? new Date(contact.initiationTimestamp).toLocaleString()
                    : "—"}
                </span>
              </div>
            </div>
          </div>

          {!isFinished && (
            <>
              {/* Transfer to agent */}
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Transferir a agente</Label>
                  <span className="text-[10px] text-muted-foreground">
                    {availableAgents.length} disponibles
                  </span>
                </div>
                <div className="flex gap-2">
                  <Select
                    value={targetAgent}
                    onValueChange={(v) => setTargetAgent(v || "")}
                    disabled={availableAgents.length === 0}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue
                        placeholder={
                          availableAgents.length === 0
                            ? "Sin agentes"
                            : "Elegir…"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAgents.map((a) => (
                        <SelectItem key={a.userId} value={a.userId}>
                          {a.username} · {a.routingProfile || "—"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={handleTransferAgent}
                    disabled={!targetAgent || pending}
                  >
                    <ArrowRightLeft className="mr-1 h-3 w-3" />
                    Transferir
                  </Button>
                </div>
              </div>

              {/* Transfer to queue */}
              <div className="space-y-2 rounded-lg border p-3">
                <Label className="text-xs">Transferir a otra cola</Label>
                <div className="flex gap-2">
                  <Select
                    value={targetQueue}
                    onValueChange={(v) => setTargetQueue(v || "")}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Elegir cola" />
                    </SelectTrigger>
                    <SelectContent>
                      {queues.map((q) => (
                        <SelectItem key={q.id} value={q.id}>
                          {q.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleTransferQueue}
                    disabled={!targetQueue || pending}
                  >
                    <ArrowRightLeft className="mr-1 h-3 w-3" />
                    Transferir
                  </Button>
                </div>
              </div>

              {/* Monitor */}
              {contact.state === "WITH_AGENT" && (
                <div className="space-y-2 rounded-lg border p-3">
                  <Label className="text-xs">Supervisar llamada</Label>
                  <p className="text-[10px] text-muted-foreground">
                    La llamada aparece en tu CCP. Silent = solo escuchas ·
                    Barge = los 3 hablan.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleMonitor("SILENT_MONITOR")}
                      disabled={pending}
                    >
                      <Headphones className="mr-1 h-3 w-3" />
                      Silent
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleMonitor("BARGE")}
                      disabled={pending}
                    >
                      Barge
                    </Button>
                  </div>
                </div>
              )}

              {/* Stop */}
              <div className="space-y-2 rounded-lg border border-[var(--accent-red-soft)] bg-[var(--accent-red-soft)] p-3">
                <Label className="text-xs text-[var(--accent-red)]">
                  Terminar llamada
                </Label>
                <p className="text-[10px] text-[var(--accent-red)]">
                  Fuerza el disconnect. Irreversible.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleStop}
                  disabled={pending}
                >
                  <Square className="mr-1 h-3 w-3" />
                  Terminar
                </Button>
              </div>
            </>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={onClose}
          >
            Cerrar
          </Button>
        </div>
        {confirmDialog}
      </SheetContent>
    </Sheet>
  );
}
