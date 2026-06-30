import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { EChartsOption } from "echarts";
import { Activity, Download, Headphones, Timer, TrendingUp, CalendarClock } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ScheduledExportsPanel } from "@/components/reports/ScheduledExportsPanel";
import { useContacts } from "@/hooks/useContacts";
import { ContactFilters } from "@/components/reports/ContactFilters";
import { SentimentChart } from "@/components/reports/SentimentChart";
import { AgentPerformanceReport } from "@/components/reports/AgentPerformanceReport";
import { HsmOutboundReport } from "@/components/reports/HsmOutboundReport";
import { WhatsAppAnalyticsPanel } from "@/components/reports/WhatsAppAnalyticsPanel";
import { AttributionReport } from "@/components/reports/AttributionReport";
import { ProgramReport } from "@/components/reports/ProgramReport";
import { ContactsTable } from "@/components/reports/ContactsTable";
import { FeatureNotice } from "@/components/vox/FeatureNotice";
import { formatDurationSec } from "@/lib/utils";
import * as Icon from "@/components/vox/primitives";
import { PageHeader } from "@/components/vox/PageHeader";
import { ExecStat } from "@/components/dashboard/exec/ExecStat";
import { ExecBarsEChart } from "@/components/dashboard/exec/ExecEcharts";
import type { ExecChannelDay } from "@/components/dashboard/exec/execMock";
import { EChart, useChartTokens } from "@/components/charts/EChart";
import { EmptyState } from "@/components/ui/empty-state";
import type { ContactRecord } from "@/types/monitoring";
import "@/styles/exec.css";

/**
 * ReportsPage — analítica histórica sobre los contactos reales (queryContacts
 * + Contact Lens), al nivel del dashboard ejecutivo: misma familia visual
 * (exec-vars: paneles, KPI tiles con count-up, skeleton shimmer) y un solo
 * motor de charts (ECharts, paleta diversa). El período es REAL (segmented
 * 7/14/30 días re-consulta; los filtros finos siguen abajo).
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

/** Panel con el chrome del dashboard (título con rail de acento + hint). */
function Panel({
  title,
  hint,
  flush,
  children,
}: {
  title: string;
  hint?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="exec-panel" style={flush ? { padding: "18px 0 0" } : undefined}>
      <div className="exec-panel__head" style={flush ? { padding: "0 20px" } : undefined}>
        <div className="exec-panel__title">{title}</div>
        {hint && (
          <>
            <div className="exec-panel__spacer" />
            <span className="exec-panel__hint">{hint}</span>
          </>
        )}
      </div>
      {children}
    </div>
  );
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
        icon={<Timer />}
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
              { offset: 0, color: "rgba(43,198,230,1)" },
              { offset: 1, color: "rgba(43,198,230,0.72)" },
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
      <div style={{ fontSize: 11.5, color: "var(--e-t3)", marginTop: 6 }}>
        Mediana:{" "}
        <span style={{ color: "var(--e-t1)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
          {median}
        </span>{" "}
        min
      </div>
    </div>
  );
}

function exportContactsToCsv(contacts: ContactRecord[]) {
  if (contacts.length === 0) {
    toast.info("No hay contactos para exportar");
    return;
  }
  const cols = [
    "contactId",
    "initiationTimestamp",
    "disconnectTimestamp",
    "agentUsername",
    "queueName",
    "channel",
    "duration",
    "sentiment",
    "categories",
    "status",
    "disconnectReason",
  ] as const;
  const escape = (raw: unknown): string => {
    if (raw == null) return "";
    const s = Array.isArray(raw) ? raw.join("|") : String(raw);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const c of contacts) {
    const row = c as unknown as Record<string, unknown>;
    lines.push(cols.map((k) => escape(row[k])).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `contacts-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast.success(`CSV descargado · ${contacts.length} contactos`);
}

const PERIODS = [
  { id: "7d", label: "7 días", days: 7 },
  { id: "14d", label: "14 días", days: 14 },
  { id: "30d", label: "30 días", days: 30 },
] as const;
type PeriodId = (typeof PERIODS)[number]["id"];

export function ReportsPage() {
  const { contacts, loading, searchContacts } = useContacts();
  const [period, setPeriod] = useState<PeriodId>("7d");
  const [showSchedule, setShowSchedule] = useState(false);
  const segRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ left: 4, width: 0 });

  // El segmented re-consulta el rango REAL (antes el botón era decorativo).
  useEffect(() => {
    const days = PERIODS.find((p) => p.id === period)?.days ?? 7;
    const start = new Date(Date.now() - days * 86400000).toISOString();
    searchContacts({ startDate: start, endDate: new Date().toISOString() });
  }, [period, searchContacts]);

  useEffect(() => {
    if (!segRef.current) return;
    const active = segRef.current.querySelector<HTMLElement>(".exec-seg__opt--active");
    if (active) setThumb({ left: active.offsetLeft, width: active.offsetWidth });
  }, [period]);

  const kpis = useMemo(() => {
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
  }, [contacts]);

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

  const initialLoading = loading && contacts.length === 0;

  return (
    <div className="view exec-vars">
      <PageHeader
        crumb="Crecimiento"
        title="Reportes"
        sub={`Contact Lens · ${contacts.length} contactos en el período`}
        actions={
          <>
            <button
              className="btn"
              onClick={() => setShowSchedule(true)}
              title="Programar el envío automático de un reporte por email (XLSX)"
            >
              <CalendarClock size={14} /> Programar
            </button>
            <button
              className="btn"
              disabled={contacts.length === 0}
              onClick={() => exportContactsToCsv(contacts)}
              title={
                contacts.length === 0
                  ? "No hay contactos para exportar"
                  : `Descargar ${contacts.length} contactos como CSV`
              }
            >
              <Download size={14} /> Exportar
            </button>
          </>
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

      {/* Período (REAL: re-consulta queryContacts) */}
      <div
        className="exec-seg"
        ref={segRef}
        role="tablist"
        aria-label="Período"
        style={{ marginBottom: 16 }}
      >
        <div className="exec-seg__thumb" style={{ left: thumb.left, width: thumb.width }} />
        {PERIODS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={period === p.id}
            className={`exec-seg__opt ${period === p.id ? "exec-seg__opt--active" : ""}`}
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* KPIs (familia del dashboard: count-up + sparkline + tabular) */}
      {initialLoading ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginBottom: 14,
          }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="exec-skel" style={{ height: 116, borderRadius: 14 }} />
          ))}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <ExecStat
            index={0}
            period={period}
            label="Volumen total"
            icon={Headphones}
            accent="#2BC6E6"
            value={kpis.total}
            note="contactos en el período"
            spark={volumeSpark.length > 1 ? volumeSpark : undefined}
            sparkColor="#2BC6E6"
          />
          <ExecStat
            index={1}
            period={period}
            label="AHT promedio"
            icon={Timer}
            accent="#F5A524"
            value={kpis.avgAht}
            formatter={(n) => (n ? formatDurationSec(Math.round(n)) : "—")}
            note={kpis.medianAht ? `mediana ${formatDurationSec(kpis.medianAht)}` : "sin datos"}
          />
          <ExecStat
            index={2}
            period={period}
            label="Sentiment positivo"
            icon={Activity}
            accent="#25B873"
            value={kpis.posPct}
            unit="%"
            note="de los contactos analizados"
          />
          <ExecStat
            index={3}
            period={period}
            label="Score neto"
            icon={TrendingUp}
            accent="#9B8CF0"
            value={kpis.score}
            formatter={(n) => `${n >= 0 ? "+" : ""}${Math.round(n)}`}
            note="(positivos − negativos) / total"
          />
        </div>
      )}

      {/* Filtros finos (fecha custom / agente / cola / sentiment) */}
      <div style={{ marginBottom: 16 }}>
        <ContactFilters onSearch={searchContacts} loading={loading} />
      </div>

      {initialLoading ? (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          <div className="exec-skel" style={{ height: 300, borderRadius: 16 }} />
          <div className="exec-skel" style={{ height: 300, borderRadius: 16 }} />
        </div>
      ) : (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          <Panel title="Volumen por canal" hint={`${contacts.length} contactos`}>
            {volumeByChannel.length === 0 ? (
              <EmptyState
                icon={<Icon.Chart size={20} />}
                title="Sin contactos en el rango"
                description="Ajustá el período o los filtros para ver volumen por canal."
              />
            ) : (
              <ExecBarsEChart data={volumeByChannel} height={264} />
            )}
          </Panel>
          <Panel title="Distribución de AHT" hint="minutos">
            <AhtHistogramEChart contacts={contacts} />
          </Panel>
        </div>
      )}

      {/* Pilar 9 — Dashboard por Programa (centerpiece, scopeado al switcher). */}
      <div style={{ marginBottom: 16 }}>
        <ProgramReport />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Panel title="Sentiment por día · Contact Lens">
          {initialLoading ? (
            <div className="exec-skel" style={{ height: 280, borderRadius: 12 }} />
          ) : (
            <SentimentChart contacts={contacts} />
          )}
        </Panel>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Panel title="Rendimiento de agente" hint="click en columna para ordenar" flush>
          <AgentPerformanceReport contacts={contacts} />
        </Panel>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Panel title="WhatsApp · Plantillas (HSM Outbound)">
          <HsmOutboundReport />
        </Panel>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Panel title="WhatsApp · Entrega directo de Meta (Cloud API)">
          <WhatsAppAnalyticsPanel />
        </Panel>
      </div>

      <div style={{ marginBottom: 16 }}>
        <AttributionReport />
      </div>

      <Panel title="Historial de contactos" hint={`${contacts.length} contactos`} flush>
        <ContactsTable contacts={contacts} />
      </Panel>
    </div>
  );
}
