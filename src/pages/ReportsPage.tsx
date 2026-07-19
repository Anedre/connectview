import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { EChartsOption } from "echarts";
import { Modal } from "@/components/ui/modal";
import { ScheduledExportsPanel } from "@/components/reports/ScheduledExportsPanel";
import { PowerBiFeedPanel } from "@/components/reports/PowerBiFeedPanel";
import { ReportDownloads } from "@/components/reports/ReportDownloads";
import { useContacts } from "@/hooks/useContacts";
import { useContactEvents } from "@/lib/contactEvents";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { ContactFilters } from "@/components/reports/ContactFilters";
import { type DateRange } from "@/components/reports/DateRangePicker";
import { SentimentChart } from "@/components/reports/SentimentChart";
import { AgentPerformanceReport } from "@/components/reports/AgentPerformanceReport";
import { HsmOutboundReport } from "@/components/reports/HsmOutboundReport";
import { WhatsAppAnalyticsPanel } from "@/components/reports/WhatsAppAnalyticsPanel";
import { TipificacionesReport } from "@/components/reports/TipificacionesReport";
import { BotAnalyticsReport } from "@/components/reports/BotAnalyticsReport";
import { ContactsTable } from "@/components/reports/ContactsTable";
import { FeatureNotice } from "@/components/vox/FeatureNotice";
import { ChannelTrendChart } from "@/components/reports/ChannelTrendChart";
import type { ExecChannelDay } from "@/components/dashboard/exec/execMock";
import { EChart, useChartTokens } from "@/components/charts/EChart";
import { EmptyState } from "@/components/ui/empty-state";
import { downloadCsv, type Column } from "@/lib/reportExport";
import type { ContactRecord } from "@/types/monitoring";
import { Icon, Btn, Card, HeroBand, type IconName } from "@/components/aria";
import { ReportsHero, type ChannelSlice } from "@/components/reports/ReportsHero";
import { AutoInsights } from "@/components/reports/AutoInsights";

/**
 * ReportsPage — analítica histórica sobre los contactos reales (queryContacts
 * + Contact Lens), re-skinneada al sistema ARIA: HeroBand premium, KPIs con
 * Stat + count-up, paneles como Card. El período es REAL (segmented 7/14/30
 * días re-consulta; los filtros finos siguen abajo). Los charts (ECharts) y
 * todos los sub-reportes reales quedan intactos.
 */

type ChannelKey = "voz" | "wa" | "chat" | "email" | "sms";

// task→voz: igual que el dashboard (normChannel del InsightsPanel) para que
// ambas pantallas cuenten el volumen por canal EXACTAMENTE igual.
function normalizeChannel(c?: string): ChannelKey {
  const k = (c || "").toUpperCase();
  if (k === "CHAT") return "chat";
  if (k === "EMAIL") return "email";
  if (k === "SMS") return "sms";
  if (k === "WHATSAPP" || k === "WA") return "wa";
  return "voz";
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Histograma de duración (AHT) en ECharts — barras cyan con mediana. */
function AhtHistogramEChart({ contacts }: { contacts: ContactRecord[] }) {
  const t = useChartTokens();
  const { labels, counts, median } = useMemo(() => {
    const labels = ["0-1", "1-2", "2-3", "3-4", "4-5", "5-6", "6-7", "7-8", "8-9", "9-10", "10+"];
    const counts = new Array(labels.length).fill(0);
    for (const c of contacts) {
      if (!c.duration) continue;
      const min = Math.floor((c.duration ?? 0) / 60);
      counts[Math.min(min, labels.length - 1)] += 1;
    }
    const total = counts.reduce((a, b) => a + b, 0);
    let median = "—";
    let acc = 0;
    for (let i = 0; i < counts.length; i++) {
      acc += counts[i];
      if (total && acc >= total / 2) {
        median = labels[i];
        break;
      }
    }
    return { labels, counts, median };
  }, [contacts]);

  if (counts.every((c) => c === 0)) {
    return (
      <EmptyState
        icon={<Icon name="clock" />}
        title="Sin datos de duración"
        description="Aparece al obtener contactos con duración registrada."
      />
    );
  }

  const option: EChartsOption = {
    animationDuration: 800,
    grid: { left: 34, right: 12, top: 18, bottom: 24 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: t.bg2,
      borderColor: t.border,
      borderWidth: 1,
      textStyle: { color: t.text1, fontSize: 12 },
      extraCssText: "border-radius:12px;",
      formatter: (ps: unknown) => {
        const p = (ps as Array<{ axisValue: string; value: number }>)[0];
        return `${p.axisValue} min<b style="margin-left:10px">${p.value}</b> contactos`;
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { lineStyle: { color: t.border } },
      axisTick: { show: false },
      axisLabel: { color: t.text3, fontSize: 10 },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: t.border, type: "dashed" } },
      axisLabel: { color: t.text3, fontSize: 10 },
    },
    series: [
      {
        type: "bar",
        data: counts,
        barWidth: "56%",
        itemStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: t.cyan },
              { offset: 1, color: `color-mix(in srgb, ${t.cyan} 60%, transparent)` },
            ],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          borderRadius: [3, 3, 0, 0],
        },
      },
    ],
  };
  return (
    <div>
      <EChart option={option} height={240} />
      <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 6 }}>
        Mediana:{" "}
        <span
          style={{ color: "var(--text-1)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}
        >
          {median}
        </span>{" "}
        min
      </div>
    </div>
  );
}

/** Columnas del "Chat detail" — MISMAS que ReportDownloads, para que el botón
 *  Exportar del topbar y la descarga del catálogo den el mismo CSV (español,
 *  con BOM + CRLF de reportExport.ts). Antes el botón usaba un CSV local aparte
 *  (columnas en inglés, sin BOM). */
const CONTACT_EXPORT_COLS: Column[] = [
  { key: "contactId", label: "Contact ID" },
  { key: "initiationTimestamp", label: "Inicio" },
  { key: "disconnectTimestamp", label: "Fin" },
  { key: "agentUsername", label: "Agente" },
  { key: "queueName", label: "Cola" },
  { key: "channel", label: "Canal" },
  { key: "duration", label: "Duración (s)" },
  { key: "sentiment", label: "Sentiment" },
  { key: "categories", label: "Categorías" },
  { key: "status", label: "Estado" },
  { key: "disconnectReason", label: "Motivo cierre" },
];

function exportContactsToCsv(contacts: ContactRecord[]) {
  if (contacts.length === 0) {
    toast.info("No hay contactos para exportar");
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  downloadCsv(
    `contactos-${stamp}`,
    CONTACT_EXPORT_COLS,
    contacts as unknown as Record<string, unknown>[],
  );
  toast.success(`CSV descargado · ${contacts.length} contactos`);
}

/** Categorías para segmentar los reportes en tabs por dominio (antes: una página larga). */
type ReportTab = "operacion" | "crecimiento" | "whatsapp" | "bot" | "descargas";
const REPORT_TABS: { id: ReportTab; label: string; icon: IconName; color: string; hint: string }[] =
  [
    {
      id: "operacion",
      label: "Operación",
      icon: "headset",
      color: "var(--accent)",
      hint: "Volumen, tiempos (AHT), rendimiento por agente y sentiment del contact center.",
    },
    {
      id: "crecimiento",
      label: "Pipeline",
      icon: "trending",
      color: "var(--green)",
      hint: "Embudo, conversión, origen, agente, tendencia y velocidad de gestión de los leads.",
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      icon: "wa",
      color: "var(--cyan)",
      hint: "Entrega de plantillas HSM y analítica directa de la Cloud API de Meta.",
    },
    {
      id: "bot",
      label: "Agente IA",
      icon: "sparkle",
      color: "var(--iris)",
      hint: "Resolución, derivación, confianza y herramientas del agente de IA.",
    },
    {
      id: "descargas",
      label: "Descargas",
      icon: "download",
      color: "var(--gold)",
      hint: "Exporta el detalle de conversaciones (Chat detail) y programa reportes por email.",
    },
  ];

/** KPIs del período (puro) — reusado para el período actual y el previo (comparación). */
function computeKpis(contacts: ContactRecord[]) {
  const total = contacts.length;
  const durations = contacts
    .filter((c) => {
      const ch = (c.channel || "").toUpperCase();
      return ch === "VOICE" || ch === "TELEPHONY" || ch === "CHAT";
    })
    .map((c) => c.duration)
    .filter((d): d is number => typeof d === "number" && d > 0);
  const avgAht = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  const sortedDur = durations.slice().sort((a, b) => a - b);
  const medianAht = sortedDur.length ? sortedDur[Math.floor(sortedDur.length / 2)] : 0;
  const pos = contacts.filter((c) => c.sentiment === "POSITIVE").length;
  const neg = contacts.filter((c) => c.sentiment === "NEGATIVE").length;
  return {
    total,
    avgAht,
    medianAht,
    posPct: total ? Math.round((pos / total) * 100) : 0,
    score: total ? Math.round(((pos - neg) / total) * 100) : 0,
  };
}

export function ReportsPage() {
  const { contacts, loading, searchContacts } = useContacts();
  const [range, setRange] = useState<DateRange>(() => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6),
      end: now,
      label: "Últimos 7 días",
    };
  });
  const [tab, setTab] = useState<ReportTab>("operacion");
  const [showSchedule, setShowSchedule] = useState(false);
  // Drill-down: canal seleccionado desde el hero → filtra el DETALLE de Operación
  // (AHT, sentimiento, agentes, tabla, insights). El hero y el chart de volumen
  // siguen mostrando todos los canales (panorama + navegador).
  const [channelFilter, setChannelFilter] = useState<ChannelKey | null>(null);

  // El calendario de rango re-consulta el rango REAL elegido.
  useEffect(() => {
    searchContacts({ startDate: range.start.toISOString(), endDate: range.end.toISOString() });
  }, [range, searchContacts]);

  // Auto-refresh: al terminar un contacto, re-corre la búsqueda del rango actual
  // (sin que el supervisor toque «Actualizar»).
  useContactEvents(() => {
    searchContacts({ startDate: range.start.toISOString(), endDate: range.end.toISOString() });
  }, ["contact:ended", "wrapup:saved"]);

  const kpis = useMemo(() => computeKpis(contacts), [contacts]);

  // Comparación vs. período previo: trae los contactos del rango inmediatamente
  // anterior (mismo largo) y calcula sus KPIs para los deltas ▲/▼ de los Stats.
  const [prevKpis, setPrevKpis] = useState<ReturnType<typeof computeKpis> | null>(null);
  useEffect(() => {
    const ep = getApiEndpoints();
    if (!ep?.queryContacts) return; // sin endpoint no hay comparación (prevKpis queda null)
    const len = range.end.getTime() - range.start.getTime();
    const prevStart = new Date(range.start.getTime() - len).toISOString();
    const prevEnd = range.start.toISOString();
    let cancelled = false;
    authedFetch(
      `${ep.queryContacts}?startDate=${encodeURIComponent(prevStart)}&endDate=${encodeURIComponent(prevEnd)}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setPrevKpis(computeKpis((d.contacts as ContactRecord[]) || []));
      })
      .catch(() => {
        if (!cancelled) setPrevKpis(null);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  // Spark del KPI de volumen + barras por canal: misma agregación diaria.
  const { volumeSpark, volumeByChannel } = useMemo(() => {
    const byDay = new Map<string, ExecChannelDay>();
    for (const c of contacts) {
      const k = dayKey(c.initiationTimestamp);
      if (!byDay.has(k)) {
        const d = new Date(c.initiationTimestamp);
        byDay.set(k, {
          label: `${d.getDate()}/${d.getMonth() + 1}`,
          voz: 0,
          wa: 0,
          chat: 0,
          email: 0,
          sms: 0,
        });
      }
      byDay.get(k)![normalizeChannel(c.channel)] += 1;
    }
    const days = Array.from(byDay.keys()).sort();
    const rows = days.map((d) => byDay.get(d)!);
    return {
      volumeSpark: rows.map((r) => r.voz + r.wa + r.chat + r.email + r.sms),
      volumeByChannel: rows,
    };
  }, [contacts]);

  // Mezcla de canales del período (para el hero) — tokens ARIA por canal.
  const channelMix = useMemo<ChannelSlice[]>(() => {
    const acc = { voz: 0, wa: 0, chat: 0, email: 0, sms: 0 };
    for (const c of contacts) acc[normalizeChannel(c.channel)] += 1;
    return [
      { key: "voz", label: "Llamadas", count: acc.voz, color: "var(--cyan)" },
      { key: "wa", label: "WhatsApp", count: acc.wa, color: "var(--green)" },
      { key: "chat", label: "Chat", count: acc.chat, color: "var(--iris)" },
      { key: "email", label: "Email", count: acc.email, color: "var(--gold)" },
      { key: "sms", label: "SMS", count: acc.sms, color: "var(--coral)" },
    ];
  }, [contacts]);

  // Contactos del DETALLE, filtrados por el canal del drill-down (o todos).
  const filteredContacts = useMemo(
    () =>
      channelFilter
        ? contacts.filter((c) => normalizeChannel(c.channel) === channelFilter)
        : contacts,
    [contacts, channelFilter],
  );
  const CHANNEL_LABEL: Record<ChannelKey, string> = {
    voz: "Llamadas",
    wa: "WhatsApp",
    chat: "Chat",
    email: "Email",
    sms: "SMS",
  };

  const initialLoading = loading && contacts.length === 0;

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      {/* ARIA hero band — reemplaza el PageHeader por el lenguaje premium de
          ARIA sin perder el reporting real que vive debajo. */}
      <HeroBand
        title="Reportes"
        chip={<>Contact Lens · {contacts.length} contactos en el período</>}
        chipIcon="chart"
        chipTone="var(--cyan)"
        right={
          <div className="row gap10">
            <Btn
              variant="ghost"
              size="sm"
              icon="calendar"
              onClick={() => setShowSchedule(true)}
              title="Programar el envío automático de un reporte por email (XLSX)"
            >
              Programar
            </Btn>
            <Btn
              variant="primary"
              size="sm"
              icon="download"
              disabled={contacts.length === 0}
              onClick={() => exportContactsToCsv(contacts)}
              title={
                contacts.length === 0
                  ? "No hay contactos para exportar"
                  : `Descargar ${contacts.length} contactos como CSV`
              }
            >
              Exportar
            </Btn>
          </div>
        }
      />

      {/* Exports programados (#7) */}
      <Modal
        open={showSchedule}
        onOpenChange={setShowSchedule}
        title="Exports programados · XLSX por email"
        className="max-w-3xl"
      >
        <div style={{ marginTop: 12, maxHeight: 560, overflow: "auto" }}>
          <ScheduledExportsPanel />
        </div>
      </Modal>

      <FeatureNotice feature="contactLens" />

      {/* Barra de control ÚNICA (rango premium + filtros finos) — reemplaza el
          período separado y los inputs de fecha nativos. Un solo control. */}
      <div style={{ marginBottom: 16 }}>
        <ContactFilters
          range={range}
          onRangeChange={setRange}
          onSearch={searchContacts}
          loading={loading}
        />
      </div>

      <ReportsHero
        kpis={kpis}
        prevKpis={prevKpis}
        volumeSpark={volumeSpark}
        channelMix={channelMix}
        periodLabel={range.label}
        loading={initialLoading}
        activeChannel={channelFilter}
        onChannelClick={(k) =>
          setChannelFilter((cur) => (cur === (k as ChannelKey) ? null : (k as ChannelKey)))
        }
      />

      {/* Tab bar de categorías — segmenta los reportes por dominio (Operación,
          Crecimiento, WhatsApp, Agente IA) en vez de una página larga apilada. */}
      <div
        className="row gap8 wrap"
        role="tablist"
        aria-label="Categoría de reportes"
        style={{ marginBottom: 6 }}
      >
        {REPORT_TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 15px",
                borderRadius: 10,
                cursor: "pointer",
                border: active ? `1.5px solid ${t.color}` : "1px solid var(--border-1)",
                background: active
                  ? `color-mix(in srgb, ${t.color} 12%, var(--bg-1))`
                  : "var(--bg-1)",
                color: active ? t.color : "var(--text-2)",
                fontWeight: active ? 750 : 600,
                fontSize: 13,
                transition: "border-color .12s, background .12s, color .12s",
              }}
            >
              <Icon name={t.icon} size={16} /> {t.label}
            </button>
          );
        })}
      </div>
      <div className="dim" style={{ fontSize: 12.5, marginBottom: 16, lineHeight: 1.5 }}>
        {REPORT_TABS.find((t) => t.id === tab)?.hint}
      </div>

      {/* ── OPERACIÓN · contact center ── */}
      {tab === "operacion" && (
        <>
          {channelFilter && (
            <div className="row gap8" style={{ marginBottom: 12, alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>
                Explorando el detalle de:
              </span>
              <button
                type="button"
                onClick={() => setChannelFilter(null)}
                title="Quitar el filtro de canal"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "4px 11px",
                  borderRadius: 99,
                  border: "1px solid var(--accent)",
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {CHANNEL_LABEL[channelFilter]} · {filteredContacts.length} contacto
                {filteredContacts.length === 1 ? "" : "s"}
                <span style={{ fontSize: 13 }}>✕</span>
              </button>
            </div>
          )}
          {!initialLoading && contacts.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Card title="Insights automáticos" icon="sparkle" accent="var(--iris)">
                <AutoInsights contacts={filteredContacts} />
              </Card>
            </div>
          )}
          {initialLoading ? (
            <div
              className="grid"
              style={{ gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}
            >
              <div className="card" style={{ height: 300 }} />
              <div className="card" style={{ height: 300 }} />
            </div>
          ) : (
            <div
              className="grid"
              style={{ gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}
            >
              <Card
                title="Volumen por canal"
                icon="layers"
                extra={
                  <span className="dim" style={{ fontSize: 12 }}>
                    {contacts.length} contactos
                  </span>
                }
              >
                {volumeByChannel.length === 0 ? (
                  <EmptyState
                    icon={<Icon name="chart" size={20} />}
                    title="Sin contactos en el rango"
                    description="Ajusta el período o los filtros para ver volumen por canal."
                  />
                ) : (
                  <ChannelTrendChart data={volumeByChannel} height={264} />
                )}
              </Card>
              <Card
                title="Distribución de AHT"
                icon="clock"
                extra={
                  <span className="dim" style={{ fontSize: 12 }}>
                    minutos
                  </span>
                }
              >
                <AhtHistogramEChart contacts={filteredContacts} />
              </Card>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <Card title="Sentiment por día · Contact Lens" icon="gauge">
              {initialLoading ? (
                <div className="card" style={{ height: 280 }} />
              ) : (
                <SentimentChart contacts={filteredContacts} />
              )}
            </Card>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Card
              title="Rendimiento de agente"
              icon="users"
              extra={
                <span className="dim" style={{ fontSize: 12 }}>
                  click en columna para ordenar
                </span>
              }
              pad={false}
            >
              <AgentPerformanceReport contacts={filteredContacts} />
            </Card>
          </div>

          <Card
            title="Historial de contactos"
            icon="fileText"
            extra={
              <span className="dim" style={{ fontSize: 12 }}>
                {filteredContacts.length} contactos
              </span>
            }
            pad={false}
          >
            <ContactsTable contacts={filteredContacts} />
          </Card>
        </>
      )}

      {/* ── PIPELINE · leads/tipificación ──
          El dashboard analítico de tipificación (antes página suelta /tipificaciones):
          KPIs + insights narrados + embudo + %estado×programa + origen + agente +
          tendencia + heatmap + velocidad. Todo desde manage-leads report=typifications. */}
      {tab === "crecimiento" && (
        <div style={{ marginBottom: 16 }}>
          <TipificacionesReport />
        </div>
      )}

      {/* ── WHATSAPP · outbound (Pilar 9C + Pilar 4C) ── */}
      {tab === "whatsapp" && (
        <>
          <div style={{ marginBottom: 16 }}>
            <Card title="WhatsApp · Plantillas (HSM Outbound)" icon="wa">
              <HsmOutboundReport />
            </Card>
          </div>
          <div style={{ marginBottom: 16 }}>
            <Card title="WhatsApp · Entrega directo de Meta (Cloud API)" icon="wa">
              <WhatsAppAnalyticsPanel />
            </Card>
          </div>
        </>
      )}

      {/* ── AGENTE IA · bot (Pilar 9B) ── */}
      {tab === "bot" && (
        <div style={{ marginBottom: 16 }}>
          <BotAnalyticsReport />
        </div>
      )}

      {/* ── DESCARGAS · exports (Chat detail + programados, estilo Chattigo) ── */}
      {tab === "descargas" && (
        <>
          <div style={{ marginBottom: 16 }}>
            <Card
              title="Descargar reportes"
              icon="download"
              extra={
                <span className="dim" style={{ fontSize: 12 }}>
                  {contacts.length} contactos en el período
                </span>
              }
            >
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--text-2)",
                  lineHeight: 1.6,
                  marginBottom: 14,
                }}
              >
                Descarga cualquier reporte como <strong>Excel</strong> o <strong>CSV</strong>. Los
                de contactos (chat detail, agentes, llamadas, canal) respetan el{" "}
                <strong>período</strong> elegido arriba; HSM, leads y conversaciones traen todo el
                histórico.
              </div>
              <ReportDownloads contacts={contacts} range={range} />
            </Card>
          </div>
          <Card title="Exports programados · XLSX por email" icon="calendar">
            <ScheduledExportsPanel />
          </Card>
          <div style={{ marginTop: 16 }}>
            <PowerBiFeedPanel />
          </div>
        </>
      )}
    </div>
  );
}
