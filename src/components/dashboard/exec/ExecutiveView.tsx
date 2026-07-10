import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUp,
  BarChart3,
  Calendar,
  ChevronRight,
  Clock,
  Filter,
  Headphones,
  Megaphone,
  Pause,
  RefreshCw,
  Sparkles,
  Target,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { ExecStat } from "./ExecStat";
import { ExecEmpty } from "./ExecEmpty";
// Phosphor: iconos para los KPIs en peso "duotone" (dos tonos) — otro estilo,
// distinto del outline de lucide, para dar jerarquía visual sin repetir.
import {
  IconContext as PhIconContext,
  Headset as PhHeadset,
  Smiley as PhSmiley,
  Timer as PhTimer,
  Lightning as PhLightning,
  CalendarDots as PhCalendar,
  ChatCircleDots as PhChat,
  UsersThree as PhUsers,
} from "@phosphor-icons/react";
import { ExecAreaEChart, ExecBarsEChart, ExecDonutEChart, ExecGaugeEChart } from "./ExecEcharts";
import {
  ExecCampaigns,
  ExecFunnel,
  ExecHeatmap,
  ExecLiveQueues,
  ExecPillBars,
  ExecRank,
} from "./ExecCharts";
import type { ExecData, ExecInsight, ExecPeriod, ExecSlice } from "./execMock";
import { useTopBarActions } from "@/components/layout/TopBarSlot";
import { initials } from "@/lib/initials";
import { Hint } from "@/components/ui/Hint";
import "@/styles/exec.css";

/**
 * ExecutiveView — dashboard ejecutivo (Inicio para Admins/Supervisors), recreación
 * del diseño Claude Design v2. PRESENTACIÓN PURA: recibe todos los datos por props,
 * sin hooks de negocio. El contenedor (`InsightsPanel`) arma el `ExecData` desde
 * datos reales; la ruta demo `/inicio-demo` lo arma desde el mock.
 */

const PERIODS: { id: ExecPeriod; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "ayer", label: "Ayer" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mes" },
];

const ahtFmt = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.round(n) % 60).padStart(2, "0")}`;

const INSIGHT_TONE: Record<ExecInsight["tone"], string> = {
  ok: "var(--e-green)",
  info: "var(--e-violet)",
  warn: "var(--e-amber)",
  crit: "var(--e-red)",
};
const INSIGHT_ICON: Record<ExecInsight["tone"], LucideIcon> = {
  ok: ArrowUp,
  info: Sparkles,
  warn: Pause,
  crit: Activity,
};

/** Deriva la tira de "atención" desde los datos si no viene explícita. */
function deriveInsights(data: ExecData): ExecInsight[] {
  if (data.insights?.length) return data.insights;
  const out: ExecInsight[] = [];
  const warnQueue = data.liveQueues.find((q) => q.status === "warn");
  if (warnQueue)
    out.push({
      tone: "crit",
      kicker: "SLA en riesgo",
      title: `${warnQueue.name} · espera ${warnQueue.espera}`,
      sub: `${warnQueue.enCola} en cola y solo ${warnQueue.libres} agente libre.`,
      action: "Reasignar agentes",
    });
  const paused = data.campaigns.find((c) => c.status === "PAUSED");
  if (paused)
    out.push({
      tone: "warn",
      kicker: "Campaña pausada",
      title: paused.name,
      sub: `${paused.done}/${paused.total} contactados — detenida.`,
      action: "Reanudar campaña",
    });
  // Sin alertas reales → una única tarjeta de estado. NO inventamos métricas
  // (antes se hardcodeaban "Pico de leads +34%" y "CSAT 88%", que eran falsos).
  if (!out.length)
    out.push({
      tone: "ok",
      kicker: "Todo en orden",
      title: "Sin alertas en este momento",
      sub: "No hay colas en riesgo ni campañas detenidas. Te avisamos si algo cambia.",
      action: "",
    });
  return out.slice(0, 4);
}

/** Mapea la acción de un insight a la ruta a la que debería enlazar. */
function insightPath(action: string): string | null {
  const a = action.toLowerCase();
  if (!a) return null;
  if (a.includes("cola") || a.includes("agente")) return "/queue";
  if (a.includes("campaña") || a.includes("plantilla")) return "/campaigns";
  if (a.includes("lead")) return "/leads";
  if (a.includes("reporte") || a.includes("detalle")) return "/reports";
  return null;
}

function ExecInsightStrip({
  data,
  onNavigate,
}: {
  data: ExecData;
  onNavigate?: (path: string) => void;
}) {
  const items = deriveInsights(data);
  return (
    <div className="exec-insights">
      {items.map((it, i) => {
        const Icn = INSIGHT_ICON[it.tone];
        const path = insightPath(it.action);
        return (
          <button
            key={i}
            type="button"
            className="exec-ins exec-anim"
            onClick={path && onNavigate ? () => onNavigate(path) : undefined}
            style={
              {
                "--ins": INSIGHT_TONE[it.tone],
                animationDelay: `${i * 50}ms`,
                cursor: path ? "pointer" : "default",
              } as React.CSSProperties
            }
          >
            <div className="exec-ins__icon">
              <Icn style={{ width: 20, height: 20 }} />
            </div>
            <div className="exec-ins__body">
              <div className="exec-ins__kicker">{it.kicker}</div>
              <div className="exec-ins__title">{it.title}</div>
              <div className="exec-ins__sub">{it.sub}</div>
              {it.action && (
                <span className="exec-ins__action">
                  {it.action} <ChevronRight />
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ExecSkeleton() {
  // Refleja el layout REAL (sin bloque hero): barra de período + tira en vivo,
  // franja de insights, KPIs y charts. Antes dibujaba un .exec-head con título
  // grande + pill que parecía el bloque hero que ya se retiró.
  return (
    <div className="exec">
      <div className="exec-bar" style={{ marginBottom: 18 }}>
        <div className="exec-skel" style={{ width: 280, height: 40, borderRadius: 12 }} />
        <div
          className="exec-skel"
          style={{ flex: 1, maxWidth: 420, height: 22, borderRadius: 999, marginLeft: "auto" }}
        />
      </div>
      <div className="exec-row exec-row--main" style={{ marginBottom: 18 }}>
        <div className="exec-skel" style={{ height: 84, borderRadius: 16 }} />
        <div className="exec-skel" style={{ height: 84, borderRadius: 16 }} />
      </div>
      <div className="exec-kpis">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="exec-skel" style={{ height: 116, borderRadius: 14 }} />
        ))}
      </div>
      <div className="exec-row exec-row--main">
        <div className="exec-skel" style={{ height: 320, borderRadius: 16 }} />
        <div className="exec-skel" style={{ height: 320, borderRadius: 16 }} />
      </div>
    </div>
  );
}

function ExecPanel({
  title,
  titleTip,
  hint,
  right,
  onOpen,
  children,
}: {
  title: string;
  /** Ayuda en hover sobre el título del panel (aclara datos no obvios). */
  titleTip?: React.ReactNode;
  hint?: string;
  right?: React.ReactNode;
  /** Si se pasa, el header muestra un enlace "Ver →" que navega a la sección. */
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="exec-panel">
      <div className="exec-panel__head">
        {titleTip ? (
          <Hint label={titleTip}>
            <div className="exec-panel__title" style={{ cursor: "help" }}>
              {title}
            </div>
          </Hint>
        ) : (
          <div className="exec-panel__title">{title}</div>
        )}
        {(hint || right || onOpen) && <div className="exec-panel__spacer" />}
        {right}
        {hint && <span className="exec-panel__hint">{hint}</span>}
        {onOpen && (
          <button type="button" className="exec-panel__open" onClick={onOpen}>
            Ver <ChevronRight />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontSize: 16,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 9.5,
          color: "var(--e-t3)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          fontWeight: 600,
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function DonutLegend({ data, total }: { data: ExecSlice[]; total: number }) {
  return (
    <div className="exec-legend" style={{ flex: 1 }}>
      {data.map((s) => (
        <div key={s.name} className="exec-legend__item">
          <span className="exec-legend__sw" style={{ background: s.color }} />
          <span className="exec-legend__name">{s.name}</span>
          <span className="exec-legend__val">{s.value}</span>
          <span className="exec-legend__pct">{Math.round((s.value / total) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

export interface ExecutiveViewProps {
  data: ExecData;
  period: ExecPeriod;
  onPeriod: (p: ExecPeriod) => void;
  onRefresh?: () => void;
  lastRefresh?: Date;
  loading?: boolean;
  /** Navega a una sección al clickear KPIs/paneles/insights. Opcional: en la
   *  demo (sin router) se omite y los enlaces quedan inertes. */
  onNavigate?: (path: string) => void;
}

export function ExecutiveView({
  data,
  period,
  onPeriod,
  onRefresh,
  lastRefresh,
  loading = false,
  onNavigate,
}: ExecutiveViewProps) {
  const [now, setNow] = useState(() => new Date());
  const [mainChart, setMainChart] = useState<"compare" | "channel">("compare");

  // Reloj en vivo (UI, no dato de negocio).
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const clock = (lastRefresh ?? now).toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Estado en vivo + Actualizar → top bar (chrome conectado al sidebar).
  useTopBarActions(
    <>
      <span className="chip chip--green">
        <span className="dot" /> Live · {clock}
      </span>
      <button className="btn" onClick={onRefresh}>
        <RefreshCw size={14} /> Actualizar
      </button>
    </>,
    [clock, onRefresh],
  );

  if (loading) return <ExecSkeleton />;

  const k = data.kpis;
  const sentTotal = data.sentiment.reduce((s, d) => s + d.value, 0);
  const queueTotal = data.byQueue.reduce((s, d) => s + d.value, 0);
  const leadTotal = data.leadSources.reduce((s, d) => s + d.value, 0);
  const funnelTotal = data.funnel.reduce((s, f) => s + f.value, 0);
  // Estados vacíos por panel: cuando un período no tiene datos mostramos
  // <ExecEmpty> (arte + copy) en vez de un gráfico en cero — se ve intencional,
  // no roto. Cada panel decide su condición aquí.
  const volumeEmpty =
    !data.volumeTrend.some((d) => (d.actual || 0) > 0 || (d.anterior || 0) > 0) &&
    !data.volumeByChannel.some((d) => d.voz + d.wa + d.chat + d.email + d.sms > 0);
  // heatmap es opcional: si se omite (mock /inicio-demo) ExecHeatmap muestra su
  // patrón demo → NO es "vacío". Solo es vacío si viene con grid real todo en 0.
  const heatmapEmpty =
    !!data.heatmap && data.heatmap.grid.every((row) => row.every((c) => c === 0));

  // Tira "en vivo" (guía: mockup) — pulso operativo derivado de data real.
  const enCola = data.liveQueues.reduce((s, q) => s + q.enCola, 0);
  const toSec = (s: string) => {
    const [m, ss] = s.split(":").map(Number);
    return (m || 0) * 60 + (ss || 0);
  };
  const maxWait =
    [...data.liveQueues].sort((a, b) => toSec(b.espera) - toSec(a.espera))[0]?.espera || "0:00";
  // Avatares siempre visibles: el ranking del período si lo hay, si no los
  // agentes de Connect (poblado por el contenedor en `data.liveAgents`).
  const liveAgents = data.liveAgents?.length ? data.liveAgents : data.agentRank.map((a) => a.name);
  const topAgents = liveAgents.slice(0, 4);

  return (
    <div className="exec">
      {/* Barra de período + tira "en vivo" (guía: mockup de Claude Design). El
          estado del agente / Actualizar viven en el top bar; aquí el período a la
          izquierda y el pulso operativo a la derecha. */}
      <div className="exec-bar">
        <div className="tseg" role="tablist" aria-label="Período">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={period === p.id}
              className={`tseg-btn ${period === p.id ? "on" : ""}`}
              onClick={() => onPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="exec-live-strip">
          <Hint label="Métricas en tiempo real desde Amazon Connect. Se refrescan solas.">
            <span className="exec-live-tag">
              <span className="exec-live-pulse" /> EN VIVO
            </span>
          </Hint>
          {topAgents.length > 0 && (
            <>
              <span className="exec-ops-sep" />
              <div className="exec-avatars">
                {topAgents.map((name, i) => (
                  <Hint key={i} label={name}>
                    <span className="exec-avatar">{initials(name)}</span>
                  </Hint>
                ))}
              </div>
            </>
          )}
          <Hint label="Agentes conectados a Amazon Connect en este momento.">
            <span className="exec-live-stat">
              <b>{data.agentsOnline}</b> en línea
            </span>
          </Hint>
          <span className="exec-ops-sep" />
          <Hint label="Contactos esperando ser atendidos ahora mismo en las colas.">
            <span className={`exec-live-stat ${enCola > 0 ? "warn" : ""}`}>
              <Headphones size={14} /> <b>{enCola}</b> en cola
            </span>
          </Hint>
          <Hint label="La espera más larga entre los contactos que están en cola.">
            <span className="exec-live-stat">
              <Clock size={14} /> {maxWait} máx
            </span>
          </Hint>
          {data.sla != null && (
            <>
              <span className="exec-ops-sep" />
              <Hint label="Nivel de servicio: % de contactos del período efectivamente atendidos (duración > 0).">
                <span className={`exec-live-stat ${data.sla < 90 ? "warn" : "ok"}`}>
                  <Target size={14} /> SLA <b>{data.sla}%</b>
                </span>
              </Hint>
            </>
          )}
        </div>
      </div>

      {/* Tira de atención / insights */}
      <ExecInsightStrip data={data} onNavigate={onNavigate} />

      {/* KPI hero row — iconos Phosphor en peso "duotone" (el IconContext fija
          peso y tamaño para todos sin pasar props uno por uno). */}
      <PhIconContext.Provider value={{ weight: "duotone", size: 18 }}>
        <div className="exec-kpis">
          <ExecStat
            index={0}
            period={period}
            label="Contactos"
            icon={PhHeadset}
            accent="var(--e-cyan)"
            value={k.contactos.value}
            delta={k.contactos.delta}
            onClick={() => onNavigate?.("/reports")}
            tip="Total de contactos (llamadas, chats, etc.) del período. Clic para abrir Reportes."
          />
          <ExecStat
            index={1}
            period={period}
            label="Sentiment +"
            icon={PhSmiley}
            accent="var(--e-green)"
            value={k.sentimentPos.value}
            unit="%"
            note="del total analizado"
            onClick={() => onNavigate?.("/reports")}
            tip="% de contactos con tono positivo según Contact Lens, sobre el total analizado."
          />
          <ExecStat
            index={2}
            period={period}
            label="AHT promedio"
            icon={PhTimer}
            accent="var(--e-violet)"
            value={k.aht.seconds}
            note="meta 3:00 min"
            formatter={ahtFmt}
            onClick={() => onNavigate?.("/reports")}
            tip="Tiempo promedio de manejo (Average Handle Time) por contacto atendido. Meta: 3:00 min."
          />
          <ExecStat
            index={3}
            period={period}
            label="Leads"
            icon={PhLightning}
            accent="var(--e-amber)"
            value={k.leads.value}
            delta={k.leads.delta}
            onClick={() => onNavigate?.("/leads")}
            tip="Leads nuevos o actualizados en el período. Clic para ir a Leads."
          />
          <ExecStat
            index={4}
            period={period}
            label="Citas próximas"
            icon={PhCalendar}
            accent="var(--e-cyan)"
            value={k.citas.value}
            note={`de ${k.citas.total} agendadas`}
            onClick={() => onNavigate?.("/appointments")}
            tip="Citas agendadas a futuro (no canceladas). Clic para abrir la agenda."
          />
          <ExecStat
            index={5}
            period={period}
            label="Plantillas WA"
            icon={PhChat}
            accent="var(--e-green)"
            value={k.plantillasWA.value}
            note="envíos aprobados"
            onClick={() => onNavigate?.("/campaigns")}
            tip="Plantillas de WhatsApp (HSM) enviadas y aprobadas por Meta."
          />
          <ExecStat
            index={6}
            period={period}
            label="Agentes"
            icon={PhUsers}
            accent="var(--e-violet)"
            value={k.agentes.available}
            note={`${k.agentes.online} online`}
            onClick={() => onNavigate?.("/queue")}
            tip="Agentes disponibles para recibir contactos ahora, y total conectados a Connect."
          />
        </div>
      </PhIconContext.Provider>

      {/* Main row: volumen + sentiment */}
      <div className="exec-row exec-row--main">
        <ExecPanel
          onOpen={() => onNavigate?.("/reports")}
          title={mainChart === "compare" ? "Volumen de contactos" : "Volumen por canal"}
          titleTip={
            mainChart === "compare"
              ? "Contactos por día. La línea tenue es el período anterior, para comparar."
              : "Contactos por día desglosados por canal (voz, WhatsApp, chat, email, SMS)."
          }
          right={
            <div className="exec-toggle">
              <button
                className={`exec-toggle__opt ${mainChart === "compare" ? "exec-toggle__opt--active" : ""}`}
                onClick={() => setMainChart("compare")}
              >
                Comparación
              </button>
              <button
                className={`exec-toggle__opt ${mainChart === "channel" ? "exec-toggle__opt--active" : ""}`}
                onClick={() => setMainChart("channel")}
              >
                Por canal
              </button>
            </div>
          }
        >
          {volumeEmpty ? (
            <ExecEmpty
              icon={BarChart3}
              title="Sin contactos en este período"
              sub="El volumen por día y por canal aparecerá aquí cuando entren contactos."
              minHeight={240}
            />
          ) : mainChart === "compare" ? (
            <ExecAreaEChart data={data.volumeTrend} />
          ) : (
            <ExecBarsEChart data={data.volumeByChannel} />
          )}
        </ExecPanel>
        <ExecPanel title="Sentiment de contactos" onOpen={() => onNavigate?.("/reports")}>
          {sentTotal > 0 ? (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ flex: "0 0 176px" }}>
                <ExecDonutEChart
                  data={data.sentiment}
                  centerValue={sentTotal}
                  centerLabel="contactos"
                  height={196}
                />
              </div>
              <DonutLegend data={data.sentiment} total={sentTotal} />
            </div>
          ) : (
            <ExecEmpty
              variant="ring"
              icon={Activity}
              title="Sin análisis de sentimiento"
              sub="Se calcula con el tono de los contactos del período."
              minHeight={196}
            />
          )}
        </ExecPanel>
      </div>

      {/* Vivid row: CSAT gauge + ranking + por cola */}
      <div className="exec-row exec-row--vivid">
        <ExecPanel
          title="Satisfacción (CSAT)"
          titleTip="Proxy de CSAT: usamos el % de contactos con sentiment positivo (aún no hay encuestas de satisfacción integradas)."
          onOpen={() => onNavigate?.("/reports")}
        >
          {data.csat.encuestas > 0 ? (
            <div style={{ display: "grid", placeItems: "center", padding: "6px 0" }}>
              <div style={{ width: "100%", maxWidth: 220 }}>
                <ExecGaugeEChart value={data.csat.value} label="satisfacción" color="#1F8A5B" />
              </div>
              <div className="exec-gauge-meta">
                Meta {data.csat.meta}% ·{" "}
                <b>
                  {data.csat.value - data.csat.meta >= 0 ? "+" : ""}
                  {data.csat.value - data.csat.meta} pts{" "}
                  {data.csat.value - data.csat.meta >= 0 ? "por encima" : "por debajo"}
                </b>
              </div>
              <div style={{ display: "flex", gap: 20, marginTop: 12 }}>
                <MiniStat label="Encuestas" value={String(data.csat.encuestas)} />
                <MiniStat label="Promotores" value={`${data.csat.promotores}%`} />
                <MiniStat label="Detractores" value={`${data.csat.detractores}%`} />
              </div>
            </div>
          ) : (
            <ExecEmpty
              variant="ring"
              icon={Target}
              title="Sin encuestas todavía"
              sub="El CSAT se mostrará cuando haya contactos analizados en el período."
              minHeight={196}
            />
          )}
        </ExecPanel>
        <ExecPanel
          title="Ranking de agentes"
          titleTip="Agentes ordenados por cantidad de contactos atendidos en el período."
          hint={data.agentRank.length ? "por contactos" : undefined}
          onOpen={() => onNavigate?.("/queue")}
        >
          {data.agentRank.length > 0 ? (
            <ExecRank data={data.agentRank} />
          ) : (
            <ExecEmpty
              icon={Users}
              title="Sin actividad de agentes"
              sub="El ranking se arma con los contactos atendidos en el período."
            />
          )}
        </ExecPanel>
        <ExecPanel
          title="Contactos por cola"
          titleTip="Cómo se reparten los contactos entre las colas de atención de Amazon Connect."
          hint={queueTotal > 0 ? `${queueTotal} total` : undefined}
          onOpen={() => onNavigate?.("/queue")}
        >
          {data.byQueue.length > 0 ? (
            <ExecPillBars data={data.byQueue} />
          ) : (
            <ExecEmpty
              icon={Headphones}
              title="Sin contactos por cola"
              sub="Se reparten aquí cuando entran contactos a las colas de atención."
            />
          )}
        </ExecPanel>
      </div>

      {/* Growth row: fuentes + embudo */}
      <div className="exec-row exec-row--growth">
        <ExecPanel title="Fuentes de leads" onOpen={() => onNavigate?.("/leads")}>
          {leadTotal > 0 ? (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ flex: "0 0 160px" }}>
                <ExecDonutEChart
                  data={data.leadSources}
                  centerValue={leadTotal}
                  centerLabel="leads"
                  height={176}
                />
              </div>
              <DonutLegend data={data.leadSources} total={leadTotal} />
            </div>
          ) : (
            <ExecEmpty
              variant="ring"
              icon={Zap}
              title="Aún no hay leads"
              sub="Las fuentes (Web, WhatsApp, campañas…) se mostrarán al llegar leads."
              minHeight={176}
            />
          )}
        </ExecPanel>
        <ExecPanel
          title="Embudo de leads"
          hint={funnelTotal > 0 ? `${funnelTotal} leads` : undefined}
          onOpen={() => onNavigate?.("/leads")}
        >
          {funnelTotal > 0 ? (
            <ExecFunnel data={data.funnel} />
          ) : (
            <ExecEmpty
              icon={Filter}
              title="Embudo vacío"
              sub="Las etapas se llenan a medida que tus leads avanzan en el pipeline."
            />
          )}
        </ExecPanel>
      </div>

      {/* Bottom row: campañas + colas en vivo */}
      <div className="exec-row exec-row--bottom">
        <ExecPanel title="Campañas activas" onOpen={() => onNavigate?.("/campaigns")}>
          {data.campaigns.length > 0 ? (
            <ExecCampaigns data={data.campaigns} />
          ) : (
            <ExecEmpty
              icon={Megaphone}
              title="Sin campañas activas"
              sub="Crea o reanuda una campaña outbound para seguir su avance aquí."
            />
          )}
        </ExecPanel>
        <ExecPanel title="Colas en tiempo real" onOpen={() => onNavigate?.("/queue")}>
          {data.liveQueues.length > 0 ? (
            <ExecLiveQueues data={data.liveQueues} />
          ) : (
            <ExecEmpty
              icon={Headphones}
              title="Sin colas con tráfico"
              sub="Las colas aparecen aquí cuando hay contactos en vivo en Amazon Connect."
            />
          )}
        </ExecPanel>
      </div>

      {/* Heatmap */}
      <div className="exec-row" style={{ gridTemplateColumns: "1fr" }}>
        <ExecPanel
          title="Contactos por hora × día de semana"
          hint={heatmapEmpty ? undefined : "08:00 – 20:00"}
          onOpen={() => onNavigate?.("/reports")}
        >
          {heatmapEmpty ? (
            <ExecEmpty
              icon={Calendar}
              title="Sin actividad para el mapa de calor"
              sub="Se construye con la hora y el día de cada contacto del período."
            />
          ) : (
            <ExecHeatmap data={data.heatmap} />
          )}
        </ExecPanel>
      </div>
    </div>
  );
}
