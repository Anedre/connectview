import { useEffect, useState } from "react";
import { useRealtimeMetrics } from "@/hooks/useRealtimeMetrics";
import { useLiveQueue, type LiveAgent } from "@/hooks/useLiveQueue";
import { AgentActionsDialog } from "@/components/queue/AgentActionsDialog";
import { formatDurationSec, pluralES } from "@/lib/utils";
import * as Icon from "@/components/vox/primitives";
import {
  Avatar,
  Card,
  CardBody,
  CardHead,
  ChannelChip,
  Kpi,
  StatusPill,
} from "@/components/vox/primitives";

// Bug #11/#7 — delegate to the shared helper so durations consistently
// switch to HH:MM:SS once they cross the 1-hour mark.
const formatWait = formatDurationSec;

function SentimentEmpty() {
  return (
    <div
      style={{
        padding: 24,
        textAlign: "center",
        color: "var(--text-3)",
      }}
    >
      <Icon.Sparkles size={26} style={{ opacity: 0.4 }} />
      <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>
        Sin datos de sentiment todavía
      </div>
      <div style={{ marginTop: 4, fontSize: 11.5 }}>
        Aparecerá cuando Contact Lens procese llamadas en vivo.
      </div>
    </div>
  );
}

export function MonitoringPage() {
  const { metrics, loading, error, lastRefresh, usingLiveData, refresh } =
    useRealtimeMetrics();
  const { data: liveQueue, refresh: refreshLiveQueue } = useLiveQueue(5000);
  const [selectedAgent, setSelectedAgent] = useState<LiveAgent | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  if (loading && !metrics) {
    return (
      <div className="view" style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
        <div style={{ textAlign: "center" }}>
          <Icon.Activity size={28} style={{ color: "var(--accent-cyan)" }} />
          <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            Cargando métricas en tiempo real…
          </div>
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  const onCall = metrics.agents.filter((a) => a.status === "Busy").length;
  const available = metrics.summary.totalAgentsAvailable;
  const acw = metrics.agents.filter((a) => a.status === "AfterCallWork").length;

  return (
    <div className="view">
      <div className="view__head">
        <div>
          <div className="view__crumb">
            <span>Operación</span>
          </div>
          <h1 className="view__title">Cola en vivo · Supervisión</h1>
          <div className="view__sub">
            {metrics.summary.totalAgentsOnline}{" "}
            {pluralES(metrics.summary.totalAgentsOnline, "agente activo", "agentes activos")}
            {" · "}
            {metrics.summary.totalContactsInQueue}{" "}
            {pluralES(
              metrics.summary.totalContactsInQueue,
              "contacto en cola",
              "contactos en cola"
            )}
            {" · "}Refresca cada 15 s
          </div>
        </div>
        <div className="view__actions">
          {usingLiveData && (
            <span className="chip chip--green">
              <span
                className="pulse"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "currentColor",
                }}
              />
              Live · {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button className="btn" onClick={refresh}>
            <Icon.Refresh size={14} /> Actualizar
          </button>
          <button className="btn">
            <Icon.Sparkles size={14} /> Coach automático
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 8,
            background: "var(--accent-amber-soft)",
            color: "var(--accent-amber)",
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      )}

      <div className="kpi-grid">
        <Kpi
          label="En cola"
          value={metrics.summary.totalContactsInQueue + (tick % 1)}
          delta={
            metrics.summary.totalContactsInQueue === 0
              ? "Sin contactos"
              : pluralES(
                  metrics.summary.totalContactsInQueue,
                  "contacto esperando",
                  "contactos esperando"
                )
          }
          deltaDir={metrics.summary.totalContactsInQueue > 0 ? "up" : "flat"}
          color="var(--accent-red)"
        />
        <Kpi
          label="En conversación"
          value={onCall}
          delta={`${Math.round(
            (onCall / Math.max(1, metrics.summary.totalAgentsOnline)) * 100
          )}% utilización`}
          deltaDir="flat"
          color="var(--accent-cyan)"
        />
        <Kpi
          label="Disponibles"
          value={available}
          delta={`${Math.round(
            (available / Math.max(1, metrics.summary.totalAgentsOnline)) * 100
          )}% del staff`}
          deltaDir={available > 0 ? "up" : "flat"}
          color="var(--accent-green)"
        />
        <Kpi
          label="ACW"
          value={acw}
          delta={
            acw === 0
              ? "Sin wrap-up activo"
              : pluralES(acw, "agente en wrap-up", "agentes en wrap-up")
          }
          deltaDir="flat"
          color="var(--accent-amber)"
        />
      </div>

      <div style={{ height: 16 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card>
          <CardHead
            title="Estado de las colas"
            right={
              <span className="muted" style={{ fontSize: 11 }}>
                {metrics.queues.length} colas activas
              </span>
            }
          />
          <CardBody flush>
            {metrics.queues.length === 0 ? (
              <div
                style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}
              >
                Sin colas reportadas.
              </div>
            ) : (
              metrics.queues.map((q) => {
                const sl = q.contactsInQueue;
                const slaClass =
                  sl > 20 ? "queue-row--alert" : sl > 5 ? "queue-row--warn" : "";
                const slaLabel = sl > 20 ? "En riesgo" : sl > 5 ? "Media" : "OK";
                return (
                  <div key={q.queueId} className={`queue-row ${slaClass}`}>
                    <ChannelChip type="voice" />
                    <div className="grow truncate">
                      <div style={{ fontWeight: 500 }}>{q.queueName}</div>
                      <div className="muted mono" style={{ fontSize: 10.5 }}>
                        SL target 80% / 30s
                      </div>
                    </div>
                    <div className="mono col-num">
                      <span className="muted" style={{ fontSize: 10.5 }}>
                        cola
                      </span>
                      <br />
                      {q.contactsInQueue}
                    </div>
                    <div className="mono col-num">
                      <span className="muted" style={{ fontSize: 10.5 }}>
                        libres
                      </span>
                      <br />
                      {q.agentsAvailable}
                    </div>
                    <div className="mono col-num">
                      <span className="muted" style={{ fontSize: 10.5 }}>
                        longest
                      </span>
                      <br />
                      {formatWait(q.oldestContactAge ?? 0)}
                    </div>
                    <div>
                      <StatusPill status={slaLabel} />
                    </div>
                  </div>
                );
              })
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHead
            title="Sentiment global · Contact Lens"
            right={
              <span className="muted mono" style={{ fontSize: 11 }}>
                tiempo real
              </span>
            }
          />
          <CardBody>
            <SentimentEmpty />
            <div className="divider" />
            <div className="section-title">Coaching automático · alertas IA</div>
            <div
              style={{
                padding: 16,
                textAlign: "center",
                color: "var(--text-3)",
                fontSize: 12,
              }}
            >
              Sin alertas activas en este momento.
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHead
          title={`Agentes · ${metrics.agents.length} en operación`}
          right={
            <div className="row" style={{ gap: 6 }}>
              <span className="chip chip--green">
                <span className="dot" /> Disponible · {available}
              </span>
              <span className="chip chip--cyan">
                <span className="dot" /> En llamada · {onCall}
              </span>
              <span className="chip chip--amber">
                <span className="dot" /> ACW · {acw}
              </span>
            </div>
          }
        />
        <CardBody>
          <div className="agents">
            {metrics.agents.length === 0 ? (
              <div
                style={{
                  gridColumn: "1 / -1",
                  padding: 32,
                  textAlign: "center",
                  color: "var(--text-3)",
                  fontSize: 12,
                }}
              >
                Sin agentes activos en este momento.
              </div>
            ) : (
              metrics.agents.map((a) => {
                const stateColor =
                  a.status === "Available"
                    ? "var(--accent-green)"
                    : a.status === "Busy"
                    ? "var(--accent-cyan)"
                    : a.status === "AfterCallWork"
                    ? "var(--accent-amber)"
                    : a.status === "Offline"
                    ? "var(--text-3)"
                    : "var(--accent-violet)";
                // Bug #32 — find the matching LiveAgent so the
                // dialog has the routing profile + active contact info
                // it needs to expose monitor/barge/hangup actions.
                const liveAgent =
                  liveQueue?.agents.find((la) => la.userId === a.agentId) ||
                  null;
                const openDialog = () => {
                  if (liveAgent) {
                    setSelectedAgent(liveAgent);
                  }
                };
                return (
                  <div
                    key={a.agentId}
                    className="agent"
                    role="button"
                    tabIndex={0}
                    onClick={openDialog}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openDialog();
                      }
                    }}
                    style={{
                      cursor: liveAgent ? "pointer" : "default",
                      opacity: liveAgent ? 1 : 0.7,
                    }}
                    title={
                      liveAgent
                        ? "Click para acciones: cambiar estado, monitorear, colgar"
                        : "Datos del agente todavía sincronizando…"
                    }
                  >
                    <Avatar name={a.username} />
                    <div className="agent__meta">
                      <div className="agent__name">{a.username}</div>
                      <div className="row" style={{ gap: 6 }}>
                        <span
                          className="state-dot"
                          style={{ background: stateColor }}
                        />
                        <span className="agent__state">{a.status}</span>
                      </div>
                    </div>
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      title="Whisper"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDialog();
                      }}
                      disabled={!liveAgent}
                    >
                      <Icon.Headset size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </CardBody>
      </Card>

      <AgentActionsDialog
        agent={selectedAgent}
        statuses={liveQueue?.statuses || []}
        open={!!selectedAgent}
        onClose={() => setSelectedAgent(null)}
        onActionCompleted={() => {
          refresh();
          refreshLiveQueue();
        }}
      />
    </div>
  );
}
