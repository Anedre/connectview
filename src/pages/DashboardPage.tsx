import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeMetrics } from "@/hooks/useRealtimeMetrics";
import { useRoles } from "@/hooks/useRoles";
import { useContacts } from "@/hooks/useContacts";
import { pluralES } from "@/lib/utils";
import * as Icon from "@/components/vox/primitives";
import { CustomWidgets } from "@/components/dashboard/CustomWidgets";
import { AgentDayHero } from "@/components/dashboard/AgentDayHero";
import { InsightsPanel } from "@/components/dashboard/InsightsPanel";
import { PageHeader } from "@/components/vox/PageHeader";
import {
  Avatar,
  Card,
  CardBody,
  CardHead,
} from "@/components/vox/primitives";

type Role = "Agents" | "Supervisors" | "Admins" | "";

function fmtWait(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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
  const agentsNeedingAttention = (metrics?.agents ?? []).filter(
    (a) => a.status === "AfterCallWork" || a.status === "MissedCallAgent"
  );

  return (
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
                <button className="btn btn--sm" onClick={() => navigate("/queue")}>
                  <Icon.Eye size={12} /> Ver
                </button>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
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

  // Vista de agente: su día (atendidos / AHT / sentiment) desde sus contactos
  // de HOY. Degradación elegante — sin permiso/sin match → 0 con nota honesta.
  const isAgentRole = role === "Agents";
  const { contacts: agentContacts, loading: agentLoading, searchContacts } = useContacts();
  useEffect(() => {
    if (!isAgentRole) return;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    searchContacts({ startDate: start.toISOString(), endDate: new Date().toISOString() });
  }, [isAgentRole, searchContacts]);
  const agentDay = useMemo(() => {
    const uname = (user?.username || "").toLowerCase();
    const mine = agentContacts.filter((c) => (c.agentUsername || "").toLowerCase() === uname);
    const durs = mine
      .map((c) => c.duration)
      .filter((d): d is number => typeof d === "number" && d > 0);
    const aht = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
    const pos = mine.filter((c) => c.sentiment === "POSITIVE").length;
    return {
      atendidos: mine.length,
      ahtSec: aht,
      sentimentPosPct: mine.length ? Math.round((pos / mine.length) * 100) : 0,
    };
  }, [agentContacts, user?.username]);
  // Friendlier first-name greeting for the agent home, matching the handoff.
  const firstName = (user?.username || "").trim().split(/\s+/)[0] || "Agente";
  const greeting =
    role === "Admins"
      ? "Vista ejecutiva"
      : role === "Supervisors"
      ? "Centro de operaciones"
      : `Hola, ${firstName}`;
  // Cross-page consistency: use pluralES + español puro (the rest of
  // the app says "agente activo", not "agente online").
  const agentsOnline = metrics?.summary.totalAgentsOnline ?? 0;
  const queueCount = metrics?.queues.length ?? 0;
  const contactsInQueue = metrics?.summary.totalContactsInQueue ?? 0;
  const longestWait = metrics?.summary.longestWaitSeconds ?? 0;
  const agentSub =
    contactsInQueue === 0
      ? "Sin contactos en cola · todo tranquilo por ahora."
      : `Hay ${contactsInQueue} ${pluralES(contactsInQueue, "contacto", "contactos")} en cola${longestWait > 0 ? ` · espera más larga ${fmtWait(longestWait)}` : ""}.`;
  const sub =
    role === "Admins"
      ? `${agentsOnline} ${pluralES(agentsOnline, "agente conectado", "agentes conectados")} · ${queueCount} ${pluralES(queueCount, "cola activa", "colas activas")}`
      : role === "Supervisors"
      ? `${agentsOnline} ${pluralES(agentsOnline, "agente conectado", "agentes conectados")} · ${contactsInQueue} ${pluralES(contactsInQueue, "en cola", "en cola")}`
      : agentSub;

  const isExec = role === "Admins" || role === "Supervisors";

  return (
    // El dashboard ejecutivo (.exec) trae su propio padding superior (26px);
    // con `view--exec` anulamos el padding-top de `.view` para no duplicarlo
    // (antes: 30+26 ≈ 56px de hueco bajo el top bar). Las tarjetas de manager
    // que van debajo conservan el padding lateral/inferior de `.view`.
    <div className={isExec ? "view view--exec" : "view"}>
      {/* Agents keep the standard PageHeader. Admins/Supervisors get a single
          fused Kommo-style header rendered INSIDE the InsightsPanel (title +
          context chips + control bar), so we don't stack two headers. */}
      {!isExec && (
        <PageHeader
          crumb="Inicio"
          title={greeting}
          sub={sub}
          actions={
            <>
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
              <button className="btn btn--primary" onClick={() => navigate("/agent")}>
                <Icon.PhoneIn size={14} /> Abrir Agent Desktop
              </button>
            </>
          }
        />
      )}

      {/* Inicio dashboard: Kommo-Insights dark panel + Chattigo-style
          reporting for managers; the design-handoff Kpi cards (label, big
          mono value, delta and inline sparkline) for agents. */}
      {isExec ? (
        <InsightsPanel
          metrics={metrics}
          title={greeting}
          agentsOnline={agentsOnline}
          queueCount={queueCount}
          lastRefresh={lastRefresh}
          onRefresh={refresh}
        />
      ) : (
        <AgentDayHero
          atendidos={agentDay.atendidos}
          ahtSec={agentDay.ahtSec}
          sentimentPosPct={agentDay.sentimentPosPct}
          enCola={contactsInQueue}
          loading={agentLoading && agentContacts.length === 0}
        />
      )}

      {/* Admins/Supervisors: la vista ejecutiva (InsightsPanel) YA trae campañas
          y colas en vivo. Aquí abajo solo van secciones que NO duplica: widgets
          del agente y, para supervisores, "agentes que requieren atención".
          (Antes ManagerDashSections/LiveQueuesCard duplicaban esos paneles.) */}
      {role === "Agents" && (
        <>
          <div style={{ height: 16 }} />
          {/* Configurable real-data widgets (roadmap #8) — agents only;
              managers/supervisors get the same data in the InsightsPanel. */}
          <CustomWidgets />
          <AgentDashSections navigate={navigate} />
        </>
      )}
      {role === "Supervisors" && (
        <>
          <div style={{ height: 16 }} />
          <SupervisorDashSections navigate={navigate} metrics={metrics} />
        </>
      )}
    </div>
  );
}
