import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserCheck, PhoneOff, Headphones, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { LiveAgent, AgentStatus } from "@/hooks/useLiveQueue";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Props {
  agent: LiveAgent | null;
  statuses: AgentStatus[];
  open: boolean;
  onClose: () => void;
  onActionCompleted: () => void;
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function fmtDur(iso?: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

const STATE_COLOR: Record<string, string> = {
  Available: "var(--accent-green)",
  Busy: "var(--accent-cyan)",
  AfterCallWork: "var(--accent-amber)",
  Offline: "var(--text-3)",
  MissedCallAgent: "var(--accent-red)",
};

export function AgentActionsDialog({ agent, statuses, open, onClose, onActionCompleted }: Props) {
  const { user } = useAuth();
  const { changeAgentStatus, stopContact, monitorContact, pending } = useAdminActions();
  const { confirm, confirmDialog } = useConfirm();
  const [targetStatus, setTargetStatus] = useState("");

  if (!agent) return null;

  // Reset selection + close (avoids stale status when reopening on another agent).
  const close = () => { setTargetStatus(""); onClose(); };

  const stateColor = STATE_COLOR[agent.statusName || ""] || "var(--accent-violet)";
  const live = agent.activeContact;

  const handleChangeStatus = async (statusId?: string) => {
    const id = statusId ?? targetStatus;
    if (!id) return;
    try {
      await changeAgentStatus(agent.userId, id);
      toast.success("Status actualizado");
      onActionCompleted();
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const handleStopCall = async () => {
    if (!live) return;
    if (!(await confirm({ title: `¿Terminar la llamada activa de ${agent.username}?`, destructive: true, confirmLabel: "Terminar llamada" }))) return;
    try {
      await stopContact(live.contactId);
      toast.success("Llamada terminada");
      onActionCompleted();
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const handleMonitor = async (mode: "SILENT_MONITOR" | "BARGE") => {
    if (!live) return;
    if (!user?.userId) { toast.error("No se detectó tu userId"); return; }
    try {
      await monitorContact(live.contactId, user.userId, mode);
      toast.success("Monitoreo iniciado — usa la barra inferior para escuchar o intervenir");
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  // Quick-pick the most common routable statuses as chips; rest go in the menu.
  const quick = statuses.filter((s) => /available|disponible|break|descanso|lunch|almuerzo|offline/i.test(s.name)).slice(0, 4);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[560px] gap-0 overflow-hidden rounded-2xl border p-0"
        style={{ background: "var(--bg-1)", borderColor: "var(--border-2)" }}
      >
        {/* Hero */}
        <DialogHeader className="space-y-0 p-0">
          <div
            style={{
              display: "flex", alignItems: "center", gap: 14, padding: "20px 22px",
              background: `linear-gradient(135deg, ${stateColor}1f, transparent 70%), var(--bg-1)`,
              borderBottom: "1px solid var(--border-1)",
            }}
          >
            <div style={{ position: "relative", flex: "0 0 auto" }}>
              <span style={{
                width: 52, height: 52, borderRadius: "50%", display: "grid", placeItems: "center",
                fontSize: 18, fontWeight: 700, color: "#fff", background: "var(--accent-violet)",
              }}>{initials(agent.username)}</span>
              <span style={{
                position: "absolute", right: -1, bottom: -1, width: 15, height: 15, borderRadius: "50%",
                background: stateColor, border: "2.5px solid var(--bg-1)",
              }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <DialogTitle style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)" }}>{agent.username}</DialogTitle>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, fontSize: 12.5, color: "var(--text-2)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 600, color: stateColor }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: stateColor }} />
                  {agent.statusName || "Offline"}
                </span>
                <span style={{ color: "var(--text-4)" }}>·</span>
                <span>{fmtDur(agent.statusStartTimestamp)} en estado</span>
              </div>
            </div>
            <button onClick={onClose} className="rounded-md p-1.5" style={{ color: "var(--text-3)" }} title="Cerrar">
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Mini stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={statCard}>
              <div style={statLabel}>Perfil de enrutamiento</div>
              <div style={statValue}>{agent.routingProfile || "—"}</div>
            </div>
            <div style={statCard}>
              <div style={statLabel}>{live ? "En llamada con" : "Estado de llamada"}</div>
              <div style={statValue}>{live ? (live.phone || "Cliente") : "Sin llamada activa"}</div>
            </div>
          </div>

          {/* Active call — highlighted */}
          {live && (
            <div style={{ borderRadius: 12, border: "1px solid var(--accent-cyan-soft)", background: "var(--accent-cyan-soft)", padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--accent-cyan)" }}>
                  Llamada activa · {live.state}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>
                  {live.queueName ? `${live.queueName} · ` : ""}{fmtDur(live.connectedToAgentTimestamp)}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button onClick={() => handleMonitor("SILENT_MONITOR")} disabled={pending} className="btn btn--sm" style={{ flex: 1 }}>
                  {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Headphones className="mr-1 h-3.5 w-3.5" />}
                  Escuchar
                </button>
                <button onClick={() => handleMonitor("BARGE")} disabled={pending} className="btn btn--sm" style={{ flex: 1 }}>
                  <UserCheck className="mr-1 h-3.5 w-3.5" /> Intervenir
                </button>
                <button onClick={handleStopCall} disabled={pending} className="btn btn--danger btn--sm" style={{ flex: 1 }}>
                  {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PhoneOff className="mr-1 h-3.5 w-3.5" />}
                  Colgar
                </button>
              </div>
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8, marginBottom: 0 }}>
                Empieza escuchando en silencio; desde la barra inferior puedes pasar a intervenir o salir.
              </p>
            </div>
          )}

          {/* Change status */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-3)", marginBottom: 8 }}>
              Cambiar estado del agente
            </div>
            {quick.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {quick.map((s) => (
                  <button key={s.id} className="btn btn--sm" onClick={() => handleChangeStatus(s.id)} disabled={pending}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={targetStatus}
                onChange={(e) => setTargetStatus(e.target.value)}
                style={{
                  flex: 1, height: 34, padding: "0 10px", fontSize: 13,
                  border: "1px solid var(--border-2)", borderRadius: 8,
                  background: "var(--bg-2)", color: "var(--text-1)",
                }}
              >
                <option value="">Otro estado…</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.type === "ROUTABLE" ? " · Routable" : ""}</option>
                ))}
              </select>
              <button className="btn btn--primary" onClick={() => handleChangeStatus()} disabled={!targetStatus || pending}>
                <UserCheck className="mr-1 h-4 w-4" /> Aplicar
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
      {confirmDialog}
    </Dialog>
  );
}

const statCard: React.CSSProperties = {
  padding: "10px 12px", borderRadius: 10,
  background: "var(--bg-2)", border: "1px solid var(--border-1)",
};
const statLabel: React.CSSProperties = {
  fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-3)", fontWeight: 600,
};
const statValue: React.CSSProperties = {
  fontSize: 13.5, fontWeight: 600, color: "var(--text-1)", marginTop: 3,
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};
