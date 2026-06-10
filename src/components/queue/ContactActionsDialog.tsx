import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ArrowRightLeft, Square, Headphones, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { QueuedContact, LiveAgent, QueueMeta } from "@/hooks/useLiveQueue";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Props {
  contact: QueuedContact | null;
  agents: LiveAgent[];
  queues: QueueMeta[];
  open: boolean;
  onClose: () => void;
  onActionCompleted: () => void;
}

export function ContactActionsDialog({
  contact,
  agents,
  queues,
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
  const [mode, setMode] = useState<"transfer-agent" | "transfer-queue" | null>(
    null
  );

  if (!contact) return null;

  const availableAgents = agents.filter(
    (a) =>
      a.statusName?.toLowerCase() === "available" && !a.activeContact
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
    if (!(await confirm({ title: "¿Forzar disconnect de esta llamada?", description: "Fuerza el disconnect de la llamada. Acción irreversible.", destructive: true, confirmLabel: "Forzar disconnect" }))) return;
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
          ? "Escucha iniciada (silent) — revisa tu CCP"
          : "Barge-in iniciado — revisa tu CCP"
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Acciones sobre la llamada</DialogTitle>
          <DialogDescription className="font-mono">
            {contact.phone || contact.contactId}
            {contact.queueName ? ` · ${contact.queueName}` : ""} ·{" "}
            {contact.state}
          </DialogDescription>
        </DialogHeader>

        {/* Transfer to agent */}
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <Label>Transferir a agente disponible</Label>
            <span className="text-xs text-muted-foreground">
              {availableAgents.length} disponibles
            </span>
          </div>
          <div className="flex gap-2">
            <Select
              value={targetAgent}
              onValueChange={(v) => {
                setTargetAgent(v || "");
                setMode("transfer-agent");
              }}
              disabled={availableAgents.length === 0}
            >
              <SelectTrigger className="flex-1">
                <SelectValue
                  placeholder={
                    availableAgents.length === 0
                      ? "No hay agentes disponibles"
                      : "Elegir agente"
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
              onClick={handleTransferAgent}
              disabled={!targetAgent || pending}
            >
              <ArrowRightLeft className="mr-1 h-4 w-4" />
              Transferir
            </Button>
          </div>
        </div>

        {/* Transfer to queue */}
        <div className="space-y-2 rounded-lg border p-3">
          <Label>Transferir a otra cola</Label>
          <div className="flex gap-2">
            <Select
              value={targetQueue}
              onValueChange={(v) => {
                setTargetQueue(v || "");
                setMode("transfer-queue");
              }}
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
              variant="outline"
              onClick={handleTransferQueue}
              disabled={!targetQueue || pending}
            >
              <ArrowRightLeft className="mr-1 h-4 w-4" />
              Transferir
            </Button>
          </div>
        </div>

        {/* Monitor */}
        <div className="space-y-2 rounded-lg border p-3">
          <Label>Escuchar llamada (supervisión)</Label>
          <p className="text-xs text-muted-foreground">
            La llamada aparecerá en tu CCP. Silent = solo escuchas. Barge = los
            3 hablan.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleMonitor("SILENT_MONITOR")}
              disabled={pending}
            >
              <Headphones className="mr-1 h-4 w-4" />
              Silent
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleMonitor("BARGE")}
              disabled={pending}
            >
              Barge-in
            </Button>
          </div>
        </div>

        {/* Stop */}
        <div className="rounded-lg border border-[var(--accent-red-soft)] bg-[var(--accent-red-soft)] p-3">
          <Label className="text-[var(--accent-red)]">
            Terminar llamada
          </Label>
          <p className="mt-1 text-xs text-[var(--accent-red)]">
            Fuerza el disconnect de la llamada. Acción irreversible.
          </p>
          <Button
            variant="destructive"
            size="sm"
            className="mt-2"
            onClick={handleStop}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Square className="mr-1 h-4 w-4" />
            )}
            Terminar
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
        {/* Silence unused 'mode' warning */}
        <div className="hidden">{mode}</div>
      </DialogContent>
      {confirmDialog}
    </Dialog>
  );
}
