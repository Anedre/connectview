import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeMetrics } from "@/hooks/useRealtimeMetrics";
import { useRoles } from "@/hooks/useRoles";
import { useContacts } from "@/hooks/useContacts";
import * as Ph from "@/components/vox/primitives";
import { CustomWidgets } from "@/components/dashboard/CustomWidgets";
import { InsightsPanel } from "@/components/dashboard/InsightsPanel";
import { Avatar, Card, CardBody, CardHead } from "@/components/vox/primitives";
import { Btn, Stat, HeroBand, Num } from "@/components/aria";
import { BlurText, SpotlightCard } from "@/components/fx";
import { EmptyState } from "@/components/ui/empty-state";

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
  // Delega al primitivo premium EmptyState (un solo patrón de "sin datos" en
  // toda la app) preservando la firma local (icon como componente + title + body).
  return <EmptyState icon={<IconCmp />} title={title} description={body} />;
}

function AgentDashSections({ navigate }: { navigate: (path: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>
      <Card>
        <CardHead
          title="Mis casos asignados"
          right={
            <button className="btn btn--ghost btn--sm" onClick={() => navigate("/agent")}>
              Abrir Agent Desktop <Ph.ChevRight size={12} />
            </button>
          }
        />
        <CardBody>
          <EmptyCardBody
            icon={Ph.Ticket}
            title="Los casos del cliente aparecen al recibir una llamada"
            body="Amazon Connect Cases sincroniza casos por contacto activo."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Resumen del día" />
        <CardBody>
          <EmptyCardBody
            icon={Ph.Calendar}
            title="Métricas personales aún no disponibles"
            body="La agregación por agente se habilitará con Contact Lens histórico."
          />
        </CardBody>
      </Card>
    </div>
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
    (a) => a.status === "AfterCallWork" || a.status === "MissedCallAgent",
  );

  return (
    <Card>
      <CardHead
        title="Agentes que requieren atención"
        right={
          agentsNeedingAttention.length > 0 ? (
            <span className="chip chip--amber">{agentsNeedingAttention.length} alertas</span>
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
            icon={Ph.Sparkles}
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
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>
                    {a.username}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {a.status === "AfterCallWork" ? "ACW · revisa wrap-up" : "Llamada perdida"}
                  </div>
                </div>
                <button className="btn btn--sm" onClick={() => navigate("/queue")}>
                  <Ph.Eye size={12} /> Ver
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

  const firstName = (user?.username || "").trim().split(/\s+/)[0] || "Agente";
  const greeting =
    role === "Admins"
      ? "Vista ejecutiva"
      : role === "Supervisors"
        ? "Centro de operaciones"
        : `Hola, ${firstName}`;

  const agentsOnline = metrics?.summary.totalAgentsOnline ?? 0;
  const queueCount = metrics?.queues.length ?? 0;
  const contactsInQueue = metrics?.summary.totalContactsInQueue ?? 0;

  const isExec = role === "Admins" || role === "Supervisors";

  return (
    <div className="page" style={{ maxWidth: 1720 }}>
      {/* ARIA hero band — greeting + live pulse + real actions. Reemplaza el
          PageHeader/InsightsPanel-header por el lenguaje premium de ARIA sin
          perder el reporting real que vive debajo. */}
      <HeroBand
        title={<BlurText text={role === "Agents" ? `Hola, ${firstName} 👋` : greeting} />}
        chip={
          <>
            <span className="dot dot--live" /> Live ·{" "}
            {lastRefresh.toLocaleTimeString("es-PE", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </>
        }
        chipIcon="live"
        chipTone="var(--green)"
        right={
          <div className="row gap10">
            <Btn variant="ghost" size="sm" icon="refresh" onClick={refresh}>
              Actualizar
            </Btn>
            {isAgentRole && (
              <Btn variant="primary" size="sm" icon="headset" onClick={() => navigate("/agent")}>
                Agent Desktop
              </Btn>
            )}
          </div>
        }
      />

      {/* Agent live KPI strip — real metrics. Managers skip this: the
          InsightsPanel below already carries the live-ops row + KPIs, so a
          second strip here would just duplicate it. */}
      {!isExec && (
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}
        >
          <SpotlightCard color="color-mix(in srgb, var(--cyan) 13%, transparent)">
            <Stat
              icon="phone"
              color="var(--cyan)"
              label="Atendidos hoy"
              value={<Num value={agentDay.atendidos} />}
              sub={agentLoading && agentContacts.length === 0 ? "cargando…" : "contactos de hoy"}
            />
          </SpotlightCard>
          <SpotlightCard color="color-mix(in srgb, var(--iris) 13%, transparent)">
            <Stat
              icon="clock"
              color="var(--iris)"
              label="Mi AHT"
              value={agentDay.ahtSec > 0 ? fmtWait(agentDay.ahtSec) : "—"}
              sub="promedio de manejo"
            />
          </SpotlightCard>
          <SpotlightCard color="color-mix(in srgb, var(--green) 13%, transparent)">
            <Stat
              icon="gauge"
              color="var(--green)"
              label="Sentiment +"
              value={<Num value={agentDay.sentimentPosPct} suffix="%" />}
              sub="llamadas positivas"
            />
          </SpotlightCard>
          <SpotlightCard color="color-mix(in srgb, var(--coral) 13%, transparent)">
            <Stat
              icon="headset"
              color="var(--coral)"
              label="En cola"
              value={<Num value={contactsInQueue} />}
              sub={contactsInQueue > 0 ? "esperando" : "cola vacía"}
            />
          </SpotlightCard>
        </div>
      )}

      {/* Deep reporting — preserva la funcionalidad real por rol. */}
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
        <>
          <CustomWidgets />
          <div style={{ height: 16 }} />
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
