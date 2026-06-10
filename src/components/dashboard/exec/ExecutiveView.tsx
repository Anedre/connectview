import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUp,
  BarChart3,
  Building2,
  Calendar,
  ChevronRight,
  Headphones,
  Layers,
  MessageCircle,
  Pause,
  Phone,
  RefreshCw,
  Sparkles,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { ExecStat } from "./ExecStat";
import {
  ExecAreaEChart,
  ExecBarsEChart,
  ExecDonutEChart,
  ExecGaugeEChart,
} from "./ExecEcharts";
import {
  ExecCampaigns,
  ExecFunnel,
  ExecHeatmap,
  ExecLiveQueues,
  ExecPillBars,
  ExecRank,
} from "./ExecCharts";
import type { ExecData, ExecInsight, ExecPeriod, ExecSlice } from "./execMock";
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
  const warnQueue = data.liveQueues.find((q) => q.status === "warn");
  const paused = data.campaigns.find((c) => c.status === "PAUSED");
  const out: ExecInsight[] = [];
  if (warnQueue)
    out.push({
      tone: "crit",
      kicker: "SLA en riesgo",
      title: `${warnQueue.name} · espera ${warnQueue.espera}`,
      sub: `${warnQueue.enCola} en cola y solo ${warnQueue.libres} agente libre.`,
      action: "Reasignar agentes",
    });
  if (paused)
    out.push({
      tone: "warn",
      kicker: "Campaña pausada",
      title: paused.name,
      sub: `${paused.done}/${paused.total} contactados — detenida.`,
      action: "Reanudar campaña",
    });
  out.push({
    tone: "info",
    kicker: "Oportunidad · Q",
    title: "Pico de leads vía WhatsApp",
    sub: "+34% de leads entrantes por WA vs. la semana anterior.",
    action: "Crear plantilla",
  });
  out.push({
    tone: "ok",
    kicker: "En máximo",
    title: "CSAT en su mejor nivel",
    sub: `${data.csat.value}% de satisfacción · ${data.csat.promotores}% promotores en ${data.csat.encuestas} encuestas.`,
    action: "Ver detalle",
  });
  return out.slice(0, 4);
}

function ExecInsightStrip({ data }: { data: ExecData }) {
  const items = deriveInsights(data);
  return (
    <div className="exec-insights">
      {items.map((it, i) => {
        const Icn = INSIGHT_ICON[it.tone];
        return (
          <button
            key={i}
            type="button"
            className="exec-ins exec-anim"
            style={
              { "--ins": INSIGHT_TONE[it.tone], animationDelay: `${i * 50}ms` } as React.CSSProperties
            }
          >
            <div className="exec-ins__icon">
              <Icn style={{ width: 15, height: 15 }} />
            </div>
            <div className="exec-ins__body">
              <div className="exec-ins__kicker">{it.kicker}</div>
              <div className="exec-ins__title">{it.title}</div>
              <div className="exec-ins__sub">{it.sub}</div>
              <span className="exec-ins__action">
                {it.action} <ChevronRight />
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ExecSkeleton() {
  return (
    <div className="exec">
      <div className="exec-head">
        <div>
          <div className="exec-skel" style={{ width: 60, height: 12, marginBottom: 10 }} />
          <div className="exec-skel" style={{ width: 240, height: 30 }} />
          <div className="exec-skel" style={{ width: 320, height: 13, marginTop: 10 }} />
        </div>
        <div className="exec-skel" style={{ width: 200, height: 32, borderRadius: 999 }} />
      </div>
      <div className="exec-skel" style={{ width: 280, height: 38, borderRadius: 11, marginBottom: 22 }} />
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
  hint,
  right,
  children,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="exec-panel">
      <div className="exec-panel__head">
        <div className="exec-panel__title">{title}</div>
        {(hint || right) && <div className="exec-panel__spacer" />}
        {right}
        {hint && <span className="exec-panel__hint">{hint}</span>}
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
          <span className="exec-legend__pct">
            {Math.round((s.value / total) * 100)}%
          </span>
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
}

export function ExecutiveView({
  data,
  period,
  onPeriod,
  onRefresh,
  lastRefresh,
  loading = false,
}: ExecutiveViewProps) {
  const [now, setNow] = useState(() => new Date());
  const segRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ left: 4, width: 0 });
  const [mainChart, setMainChart] = useState<"compare" | "channel">("compare");

  // Reloj en vivo (UI, no dato de negocio).
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Posición del thumb del segmented según la opción activa.
  useEffect(() => {
    if (!segRef.current) return;
    const active = segRef.current.querySelector<HTMLElement>(".exec-seg__opt--active");
    if (active) setThumb({ left: active.offsetLeft, width: active.offsetWidth });
  }, [period, loading]);

  if (loading) return <ExecSkeleton />;

  const k = data.kpis;
  const clock = (lastRefresh ?? now).toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateLabel = now
    .toLocaleDateString("es-PE", { day: "2-digit", month: "short" })
    .replace(".", "");
  const sentTotal = data.sentiment.reduce((s, d) => s + d.value, 0);
  const queueTotal = data.byQueue.reduce((s, d) => s + d.value, 0);
  const leadTotal = data.leadSources.reduce((s, d) => s + d.value, 0);

  return (
    <div className="exec">
      {/* Header (hero band) */}
      <div className="exec-head">
        <div className="exec-head__id">
          <div className="exec-head__icon">
            <BarChart3 />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="exec-crumb">
              <span>Inicio</span>
              <ChevronRight />
              <span>Centro de operaciones</span>
            </div>
            <h1 className="exec-title">Vista ejecutiva</h1>
            <div className="exec-meta">
              <span className="exec-meta__chip">
                <Users />
                <b>{data.agentsOnline}</b> agentes
              </span>
              <span className="exec-meta__chip">
                <Layers />
                <b>{data.liveQueues.length}</b> colas activas
              </span>
              <span className="exec-meta__chip">
                <Building2 /> {data.org}
              </span>
            </div>
          </div>
        </div>
        <div className="exec-head-actions">
          <span className="exec-live" role="status" aria-live="polite">
            <span className="dot" /> Live · {clock}
          </span>
          <span className="exec-date-chip">
            <Calendar /> {dateLabel}
          </span>
          <button className="exec-btn" onClick={onRefresh}>
            <RefreshCw style={{ width: 14, height: 14 }} /> Actualizar
          </button>
        </div>
      </div>

      {/* Filtro de período */}
      <div className="exec-seg" ref={segRef} role="tablist" aria-label="Período">
        <div className="exec-seg__thumb" style={{ left: thumb.left, width: thumb.width }} />
        {PERIODS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={period === p.id}
            className={`exec-seg__opt ${period === p.id ? "exec-seg__opt--active" : ""}`}
            onClick={() => onPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Tira de atención / insights */}
      <ExecInsightStrip data={data} />

      {/* KPI hero row */}
      <div className="exec-kpis">
        <ExecStat index={0} period={period} label="Contactos" icon={Headphones} accent="#1C97A6" value={k.contactos.value} delta={k.contactos.delta} spark={k.contactos.spark} sparkColor="#1C97A6" />
        <ExecStat index={1} period={period} label="Sentiment +" icon={Activity} accent="var(--e-green)" value={k.sentimentPos.value} unit="%" note="del total analizado" />
        <ExecStat index={2} period={period} label="AHT promedio" icon={Phone} accent="var(--e-amber)" value={k.aht.seconds} note="meta 3:00 min" formatter={ahtFmt} />
        <ExecStat index={3} period={period} label="Leads" icon={Zap} accent="#92C73E" value={k.leads.value} delta={k.leads.delta} spark={k.leads.spark} sparkColor="#92C73E" />
        <ExecStat index={4} period={period} label="Citas próximas" icon={Calendar} accent="#F2972E" value={k.citas.value} note={`de ${k.citas.total} agendadas`} />
        <ExecStat index={5} period={period} label="Plantillas WA" icon={MessageCircle} accent="var(--e-green)" value={k.plantillasWA.value} note="envíos aprobados" />
        <ExecStat index={6} period={period} label="Agentes" icon={Users} accent="var(--e-cyan)" value={k.agentes.available} note={`${k.agentes.online} online`} />
      </div>

      {/* Main row: volumen + sentiment */}
      <div className="exec-row exec-row--main">
        <ExecPanel
          title={mainChart === "compare" ? "Volumen de contactos" : "Volumen por canal"}
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
          {mainChart === "compare" ? (
            <ExecAreaEChart data={data.volumeTrend} />
          ) : (
            <ExecBarsEChart data={data.volumeByChannel} />
          )}
        </ExecPanel>
        <ExecPanel title="Sentiment de contactos">
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
        </ExecPanel>
      </div>

      {/* Vivid row: CSAT gauge + ranking + por cola */}
      <div className="exec-row exec-row--vivid">
        <ExecPanel title="Satisfacción (CSAT)">
          <div style={{ display: "grid", placeItems: "center", padding: "6px 0" }}>
            <div style={{ width: "100%", maxWidth: 220 }}>
              <ExecGaugeEChart value={data.csat.value} label="satisfacción" color="#2E9D8E" />
            </div>
            <div className="exec-gauge-meta">
              Meta {data.csat.meta}% ·{" "}
              <b>+{data.csat.value - data.csat.meta} pts por encima</b>
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 12 }}>
              <MiniStat label="Encuestas" value={String(data.csat.encuestas)} />
              <MiniStat label="Promotores" value={`${data.csat.promotores}%`} />
              <MiniStat label="Detractores" value={`${data.csat.detractores}%`} />
            </div>
          </div>
        </ExecPanel>
        <ExecPanel title="Ranking de agentes" hint="por contactos">
          <ExecRank data={data.agentRank} />
        </ExecPanel>
        <ExecPanel title="Contactos por cola" hint={`${queueTotal} total`}>
          <ExecPillBars data={data.byQueue} />
        </ExecPanel>
      </div>

      {/* Growth row: fuentes + embudo */}
      <div className="exec-row exec-row--growth">
        <ExecPanel title="Fuentes de leads">
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
        </ExecPanel>
        <ExecPanel title="Embudo de leads" hint="tasa de cierre 10.6%">
          <ExecFunnel data={data.funnel} />
        </ExecPanel>
      </div>

      {/* Bottom row: campañas + colas en vivo */}
      <div className="exec-row exec-row--bottom">
        <ExecPanel title="Campañas activas">
          <ExecCampaigns data={data.campaigns} />
        </ExecPanel>
        <ExecPanel title="Colas en tiempo real">
          <ExecLiveQueues data={data.liveQueues} />
        </ExecPanel>
      </div>

      {/* Heatmap */}
      <div className="exec-row" style={{ gridTemplateColumns: "1fr" }}>
        <ExecPanel title="Contactos por hora × día de semana" hint="08:00 – 20:00">
          <ExecHeatmap />
        </ExecPanel>
      </div>
    </div>
  );
}
