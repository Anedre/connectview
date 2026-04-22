import { useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Headphones,
  Phone,
  Clock,
  Users,
  RefreshCw,
  ScrollText,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useLiveQueue, type LiveAgent, type QueuedContact } from "@/hooks/useLiveQueue";
import { useAdminActions } from "@/hooks/useAdminActions";
import { ContactCard } from "@/components/queue/ContactCard";
import { AgentCard } from "@/components/queue/AgentCard";
import { ContactActionsDialog } from "@/components/queue/ContactActionsDialog";
import { AgentActionsDialog } from "@/components/queue/AgentActionsDialog";
import { AuditLogPanel } from "@/components/queue/AuditLogPanel";

export function QueueManagerPage() {
  const { data, loading, error, refresh } = useLiveQueue(3000);
  const { transferContact } = useAdminActions();
  const [selectedContact, setSelectedContact] = useState<QueuedContact | null>(
    null
  );
  const [selectedAgent, setSelectedAgent] = useState<LiveAgent | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  const onContactDropOnAgent = async (
    agent: LiveAgent,
    payload: { contactId: string; phone: string | null }
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

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-md">
              <Headphones className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                Queue Manager
              </h2>
              <p className="text-sm text-muted-foreground">
                Live · auto-refresh cada 3s · drag a llamada sobre un agente
                disponible para transferirla
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAudit((v) => !v)}
            >
              <ScrollText className="mr-1 h-4 w-4" />
              {showAudit ? "Ocultar audit" : "Ver audit log"}
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
            Loading live queue...
          </div>
        )}
        {error && !data && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            {error}
          </div>
        )}

        {showAudit && <AuditLogPanel />}

        {data && (
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_2fr]">
            {/* Column 1 — Pre-queue (in IVR / connecting) */}
            <Card className="flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-amber-600" />
                    En IVR / conectando
                  </span>
                  <Badge variant="outline">{data.preQueue.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 space-y-2">
                {data.preQueue.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    Sin llamadas pre-cola.
                  </p>
                )}
                {data.preQueue.map((c) => (
                  <ContactCard
                    key={c.contactId}
                    contact={c}
                    onClick={setSelectedContact}
                  />
                ))}
              </CardContent>
            </Card>

            {/* Column 2 — In Queue */}
            <Card className="flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-blue-600" />
                    En cola esperando
                  </span>
                  <Badge variant="outline">{data.inQueue.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 space-y-2">
                {data.inQueue.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    Cola vacía.
                  </p>
                )}
                {data.inQueue.map((c) => (
                  <ContactCard
                    key={c.contactId}
                    contact={c}
                    onClick={setSelectedContact}
                  />
                ))}
              </CardContent>
            </Card>

            {/* Column 3 — Agents grid */}
            <Card className="flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-emerald-600" />
                    Agentes ({data.agents.length})
                  </span>
                  <div className="flex gap-1 text-[10px]">
                    <Badge className="bg-emerald-100 text-emerald-800">
                      {
                        data.agents.filter(
                          (a) =>
                            a.statusName?.toLowerCase() === "available" &&
                            !a.activeContact
                        ).length
                      }{" "}
                      disponibles
                    </Badge>
                    <Badge className="bg-blue-100 text-blue-800">
                      {data.agents.filter((a) => !!a.activeContact).length}{" "}
                      en llamada
                    </Badge>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {data.agents.map((a) => (
                  <AgentCard
                    key={a.userId}
                    agent={a}
                    onClick={setSelectedAgent}
                    onContactDropped={onContactDropOnAgent}
                  />
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {data && data.pendingTransfer.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                ⏳ En espera de transferencia ({data.pendingTransfer.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-3">
              {data.pendingTransfer.map((c) => (
                <ContactCard
                  key={c.contactId}
                  contact={c}
                  onClick={setSelectedContact}
                />
              ))}
            </CardContent>
          </Card>
        )}

        <ContactActionsDialog
          contact={selectedContact}
          agents={data?.agents || []}
          queues={data?.queues || []}
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
      </div>
    </DndProvider>
  );
}
