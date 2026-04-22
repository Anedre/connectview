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
import { UserCheck, PhoneOff, Headphones, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { LiveAgent, AgentStatus } from "@/hooks/useLiveQueue";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  agent: LiveAgent | null;
  statuses: AgentStatus[];
  open: boolean;
  onClose: () => void;
  onActionCompleted: () => void;
}

export function AgentActionsDialog({
  agent,
  statuses,
  open,
  onClose,
  onActionCompleted,
}: Props) {
  const { user } = useAuth();
  const { changeAgentStatus, stopContact, monitorContact, pending } =
    useAdminActions();
  const [targetStatus, setTargetStatus] = useState("");

  if (!agent) return null;

  const handleChangeStatus = async () => {
    if (!targetStatus) return;
    try {
      await changeAgentStatus(agent.userId, targetStatus);
      toast.success("Status actualizado");
      onActionCompleted();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const handleStopCall = async () => {
    if (!agent.activeContact) return;
    if (!confirm(`¿Terminar la llamada activa de ${agent.username}?`)) return;
    try {
      await stopContact(agent.activeContact.contactId);
      toast.success("Llamada terminada");
      onActionCompleted();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const handleMonitor = async (
    mode: "SILENT_MONITOR" | "BARGE" | "WHISPER"
  ) => {
    if (!agent.activeContact) return;
    if (!user?.userId) {
      toast.error("No se detectó tu userId");
      return;
    }
    try {
      await monitorContact(agent.activeContact.contactId, user.userId, mode);
      toast.success(`${mode} iniciado — revisa tu CCP`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{agent.username}</DialogTitle>
          <DialogDescription>
            Status actual: <strong>{agent.statusName || "Offline"}</strong>
            {agent.routingProfile ? ` · ${agent.routingProfile}` : ""}
          </DialogDescription>
        </DialogHeader>

        {/* Change status */}
        <div className="space-y-2 rounded-lg border p-3">
          <Label>Cambiar status del agente</Label>
          <div className="flex gap-2">
            <Select
              value={targetStatus}
              onValueChange={(v) => setTargetStatus(v || "")}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Elegir nuevo status" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} {s.type === "ROUTABLE" ? "· Routable" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={handleChangeStatus}
              disabled={!targetStatus || pending}
            >
              <UserCheck className="mr-1 h-4 w-4" />
              Aplicar
            </Button>
          </div>
        </div>

        {/* Active call actions */}
        {agent.activeContact && (
          <div className="space-y-2 rounded-lg border p-3">
            <Label>
              Llamada activa: {agent.activeContact.phone || "—"} (
              {agent.activeContact.state})
            </Label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleMonitor("SILENT_MONITOR")}
                disabled={pending}
              >
                <Headphones className="mr-1 h-4 w-4" />
                Escuchar (silent)
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleMonitor("WHISPER")}
                disabled={pending}
              >
                Whisper
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleMonitor("BARGE")}
                disabled={pending}
              >
                Barge-in
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleStopCall}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <PhoneOff className="mr-1 h-4 w-4" />
                )}
                Colgar llamada
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
