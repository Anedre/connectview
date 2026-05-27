import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeMetrics } from "@/hooks/useRealtimeMetrics";
import { useRoles } from "@/hooks/useRoles";
import { useCampaigns } from "@/hooks/useCampaigns";
import { pluralES } from "@/lib/utils";
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

type Role = "Agents" | "Supervisors" | "Admins" | "";

function fmtWait(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface DashKpi {
  label: string;
  value: string;
  delta?: string;
  dir?: "up" | "down" | "flat";
  color?: string;
}

function buildKpis(
  role: Role,
  metrics: ReturnType<typeof useRealtimeMetrics>["metrics"]
): DashKpi[] {
  const queue = metrics?.summary.totalContactsInQueue ?? 0;
  const online = metrics?.summary.totalAgentsOnline ?? 0;
  const available = metrics?.summary.totalAgentsAvailable ?? 0;
  const longest = metrics?.summary.longestWaitSeconds ?? 0;

  if (role === "Admins" || role === "Supervisors") {
    return [
      {
        label: "Agentes activos",
        value: `${available} / ${online}`,
        delta: "en línea ahora",
        dir: "flat",
        color: "var(--accent-cyan)",
      },
      {
        label: "Cola global",
        value: String(queue),
        delta: queue === 0 ? "Sin contactos" : "Contactos esperando",
        dir: queue > 10 ? "up" : "flat",
        color: queue > 10 ? "var(--accent-red)" : "var(--accent-green)",
      },
      {
        label: "Espera más larga",
        value: fmtWait(longest),
        delta: longest === 0 ? "Sin espera" : longest > 120 ? "Sobre meta" : "Bajo meta",
        dir: longest > 120 ? "down" : "flat",
        color: longest > 120 ? "var(--accent-red)" : "var(--accent-green)",
      },
      {
        label: "Colas reportadas",
        value: String(metrics?.queues.length ?? 0),
        delta: "Activas",
        dir: "flat",
        color: "var(--accent-violet)",
      },
    ];
  }
  // Agent view — no per-agent metrics endpoint yet
  return [
    { label: "Cola global", value: String(queue), delta: "Contactos esperando", dir: "flat", color: "var(--accent-cyan)" },
    { label: "Agentes disponibles", value: String(available), delta: `de ${online} online`, dir: "flat", color: "var(--accent-green)" },
    { label: "Espera más larga", value: fmtWait(longest), delta: "En tiempo real", dir: "flat", color: "var(--accent-amber)" },
    { label: "Tu estado", value: "—", delta: "Cambia desde el topbar", dir: "flat", color: "var(--accent-violet)" },
  ];
}

function EmptyCardBody({
  icon: IconCmp,
  title,
  body,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        padding: 32,
        textAlign: "center",
        color: "var(--text-3)",
      }}
    >
      <IconCmp size={26} style={{ opacity: 0.4 }} />
      <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>
        {title}
      </div>
      <div style={{ marginTop: 4, fontSize: 11.5 }}>{body}</div>
    </div>
  );
}

function AgentDashSections({ navigate }: { navigate: (path: string) => void }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>
        <Card>
          <CardHead
            title="Mis casos asignados"
            right={
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => navigate("/agent")}
              >
                Abrir Agent Desktop <Icon.ChevRight size={12} />
              </button>
            }
          />
          <CardBody>
            <EmptyCardBody
              icon={Icon.Ticket}
              title="Los casos del cliente aparecen al recibir una llamada"
              body="Amazon Connect Cases sincroniza casos por contacto activo."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Resumen del día" />
          <CardBody>
            <EmptyCardBody
              icon={Icon.Calendar}
              title="Métricas personales aún no disponibles"
              body="La agregación por agente se habilitará con Contact Lens histórico."
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function SupervisorDashSections({
  navigate,
  metrics,
}: {
  navigate: (path: string) => void;
  metrics: ReturnType<typeof useRealtimeMetrics>["metrics"];
}) {
  const queues = (metrics?.queues ?? []).slice(0, 6);
  const agentsNeedingAttention = (metrics?.agents ?? []).filter(
    (a) => a.status === "AfterCallWork" || a.status === "MissedCallAgent"
  );

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card>
          <CardHead
            title="Colas en tiempo real"
            right={
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => navigate("/queue")}
              >
                Abrir supervisión <Icon.ChevRight size={12} />
              </button>
            }
          />
          <CardBody flush>
            {queues.length === 0 ? (
              <EmptyCardBody
                icon={Icon.Queue}
                title="Sin colas reportadas"
                body="Aparecerán cuando haya tráfico en Amazon Connect."
              />
            ) : (
              queues.map((q) => {
                const status =
                  q.contactsInQueue > 20
                    ? "alert"
                    : q.contactsInQueue > 5
                    ? "warn"
                    : "ok";
                return (
                  <div
                    key={q.queueId}
                    className={`queue-row ${
                      status === "alert"
                        ? "queue-row--alert"
                        : status === "warn"
                        ? "queue-row--warn"
                        : ""
                    }`}
                  >
                    <ChannelChip type="voice" />
                    <div className="grow truncate">{q.queueName}</div>
                    <div className="mono col-num">
                      <span className="muted" style={{ fontSize: 11 }}>cola </span>
                      {q.contactsInQueue}
                    </div>
                    <div className="mono col-num">
                      <span className="muted" style={{ fontSize: 11 }}>libres </span>
                      {q.agentsAvailable}
                    </div>
                    <div className="mono col-num">
                      <span className="muted" style={{ fontSize: 11 }}>esp </span>
                      {fmtWait(q.oldestContactAge ?? 0)}
                    </div>
                    <div>
                      <StatusPill
                        status={
                          status === "alert"
                            ? "En riesgo"
                            : status === "warn"
                            ? "Media"
                            : "OK"
                        }
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHead
            title="Agentes que requieren atención"
            right={
              agentsNeedingAttention.length > 0 ? (
                <span className="chip chip--amber">
                  {agentsNeedingAttention.length} alertas
                </span>
              ) : (
                <span className="chip chip--green">
                  <span className="dot" /> Sin alertas
                </span>
              )
            }
          />
          <CardBody>
            {agentsNeedingAttention.length === 0 ? (
              <EmptyCardBody
                icon={Icon.Sparkles}
                title="Sin alertas en este momento"
                body="Aparecerán agentes con ACW prolongado, llamadas perdidas o sentiment negativo."
              />
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {agentsNeedingAttention.map((a) => (
                  <div
                    key={a.agentId}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      padding: "10px 12px",
                      background: "var(--bg-2)",
                      borderRadius: 8,
                    }}
                  >
                    <Avatar name={a.username} />
                    <div className="grow">
                      <div
                        style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}
                      >
                        {a.username}
                      </div>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {a.status === "AfterCallWork"
                          ? "ACW · revisa wrap-up"
                          : "Llamada perdida"}
                      </div>
                    </div>
                    <button className="btn btn--sm">
                      <Icon.Eye size={12} /> Whisper
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function ManagerDashSections({
  metrics,
}: {
  metrics: ReturnType<typeof useRealtimeMetrics>["metrics"];
}) {
  const { campaigns, loading } = useCampaigns(15000);
  const active = campaigns.filter(
    (c) => c.status === "RUNNING" || c.status === "PAUSED"
  );
  const topActive = active.slice(0, 5);

  return (
    <>
      <div className="grid-2">
        <Card>
          <CardHead
            title="Campañas activas"
            right={
              <span className="chip">
                {active.length} de {campaigns.length}{" "}
                {active.length === 1 ? "activa" : "activas"}
              </span>
            }
          />
          <CardBody flush>
            {loading && campaigns.length === 0 ? (
              <EmptyCardBody
                icon={Icon.Megaphone}
                title="Cargando campañas…"
                body="Sincronizando con Amazon Connect."
              />
            ) : topActive.length === 0 ? (
              <EmptyCardBody
                icon={Icon.Megaphone}
                title="Sin campañas activas en este momento"
                body={
                  campaigns.length > 0
                    ? `Tienes ${campaigns.length} ${
                        campaigns.length === 1 ? "campaña" : "campañas"
                      } finalizadas o en borrador. Crea una nueva o relanza desde Campañas.`
                    : "Crea una nueva desde el menú Campañas."
                }
              />
            ) : (
              topActive.map((c) => {
                const total = Number(c.totalContacts || 0);
                const done = (c.doneCount || 0) + (c.failedCount || 0);
                const pct = total ? Math.round((done / total) * 100) : 0;
                return (
                  <div
                    key={c.campaignId}
                    style={{
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--border-1)",
                    }}
                  >
                    <div className="spread" style={{ marginBottom: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                        {c.name}
                      </span>
                      <span className="mono muted" style={{ fontSize: 11 }}>
                        {done} / {total}
                      </span>
                    </div>
                    <div className="bar">
                      <div
                        style={{
                          width: `${pct}%`,
                          background:
                            c.status === "PAUSED"
                              ? "var(--accent-amber)"
                              : "var(--accent-cyan)",
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Snapshot de operación" />
          <CardBody>
            <div className="col" style={{ gap: 14 }}>
              <SnapshotRow
                label="Contactos en cola"
                value={String(metrics?.summary.totalContactsInQueue ?? 0)}
                color="var(--accent-cyan)"
              />
              <SnapshotRow
                label="Agentes online"
                value={String(metrics?.summary.totalAgentsOnline ?? 0)}
                color="var(--accent-green)"
              />
              <SnapshotRow
                label="Agentes disponibles"
                value={String(metrics?.summary.totalAgentsAvailable ?? 0)}
                color="var(--accent-violet)"
              />
              <SnapshotRow
                label="Campañas totales"
                value={String(campaigns.length)}
                color="var(--accent-amber)"
              />
            </div>
            <div className="divider" />
            <div className="muted" style={{ fontSize: 11.5 }}>
              Refresca cada 15 s desde Amazon Connect.
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function SnapshotRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="spread">
      <div className="row" style={{ gap: 8 }}>
        <span
          style={{
            width: 6,
            height: 24,
            borderRadius: 999,
            background: color,
          }}
        />
        <span style={{ fontSize: 13 }}>{label}</span>
      </div>
      <span className="mono" style={{ fontSize: 16 }}>
        {value}
      </span>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { metrics, lastRefresh, refresh } = useRealtimeMetrics();
  const { isAtLeast } = useRoles();
  const navigate = useNavigate();

  const role: Role = isAtLeast("Admins")
    ? "Admins"
    : isAtLeast("Supervisors")
    ? "Supervisors"
    : isAtLeast("Agents")
    ? "Agents"
    : "";

  const kpis = buildKpis(role, metrics);
  const greeting =
    role === "Admins"
      ? "Vista ejecutiva"
      : role === "Supervisors"
      ? "Centro de operaciones"
      : `Hola, ${user?.username ?? "Agente"}`;
  // Cross-page consistency: use pluralES + español puro (the rest of
  // the app says "agente activo", not "agente online").
  const agentsOnline = metrics?.summary.totalAgentsOnline ?? 0;
  const queueCount = metrics?.queues.length ?? 0;
  const contactsInQueue = metrics?.summary.totalContactsInQueue ?? 0;
  const sub =
    role === "Admins"
      ? `${agentsOnline} ${pluralES(agentsOnline, "agente conectado", "agentes conectados")} · ${queueCount} ${pluralES(queueCount, "cola activa", "colas activas")}`
      : role === "Supervisors"
      ? `${agentsOnline} ${pluralES(agentsOnline, "agente conectado", "agentes conectados")} · ${contactsInQueue} ${pluralES(contactsInQueue, "en cola", "en cola")}`
      : `Conectado como ${user?.highestRole ?? "Agente"}`;

  return (
    <div className="view">
      <div className="view__head">
        <div>
          <div className="view__crumb">
            <span>Inicio</span>
          </div>
          <h1 className="view__title">{greeting}</h1>
          <div className="view__sub">{sub}</div>
        </div>
        <div className="view__actions">
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
          <button className="btn" onClick={refresh}>
            <Icon.Refresh size={14} /> Actualizar
          </button>
          {role === "Agents" && (
            <button
              className="btn btn--primary"
              onClick={() => navigate("/agent")}
            >
              <Icon.PhoneIn size={14} /> Abrir Agent Desktop
            </button>
          )}
        </div>
      </div>

      <div className="kpi-grid">
        {kpis.map((k) => (
          <Kpi
            key={k.label}
            label={k.label}
            value={k.value}
            delta={k.delta}
            deltaDir={k.dir}
            color={k.color}
          />
        ))}
      </div>

      <div style={{ height: 16 }} />

      {role === "Agents" && <AgentDashSections navigate={navigate} />}
      {role === "Supervisors" && (
        <SupervisorDashSections navigate={navigate} metrics={metrics} />
      )}
      {role === "Admins" && <ManagerDashSections metrics={metrics} />}
    </div>
  );
}
