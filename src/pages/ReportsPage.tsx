import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { EChartsOption } from "echarts";
import { Modal } from "@/components/ui/modal";
import { ScheduledExportsPanel } from "@/components/reports/ScheduledExportsPanel";
import { useContacts } from "@/hooks/useContacts";
import { getApiEndpoints } from "@/lib/api";
import { authedFetch } from "@/lib/authedFetch";
import { ContactFilters } from "@/components/reports/ContactFilters";
import { DateRangePicker, type DateRange } from "@/components/reports/DateRangePicker";
import { SentimentChart } from "@/components/reports/SentimentChart";
import { AgentPerformanceReport } from "@/components/reports/AgentPerformanceReport";
import { HsmOutboundReport } from "@/components/reports/HsmOutboundReport";
import { WhatsAppAnalyticsPanel } from "@/components/reports/WhatsAppAnalyticsPanel";
import { AttributionReport } from "@/components/reports/AttributionReport";
import { ProgramReport } from "@/components/reports/ProgramReport";
import { BotAnalyticsReport } from "@/components/reports/BotAnalyticsReport";
import { ContactsTable } from "@/components/reports/ContactsTable";
import { FeatureNotice } from "@/components/vox/FeatureNotice";
import { formatDurationSec } from "@/lib/utils";
import { ExecBarsEChart } from "@/components/dashboard/exec/ExecEcharts";
import type { ExecChannelDay } from "@/components/dashboard/exec/execMock";
import { EChart, useChartTokens } from "@/components/charts/EChart";
import { EmptyState } from "@/components/ui/empty-state";
import type { ContactRecord } from "@/types/monitoring";
import { Icon, Btn, Card, Stat, MiniBars, HeroBand, Num, type IconName } from "@/components/aria";

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
      label: "Crecimiento",
      icon: "trending",
      color: "var(--green)",
      hint: "Embudo y conversión por programa, y atribución de los golpes al cierre.",
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
      hint: "Exportá el detalle de conversaciones (Chat detail) y programá reportes por email.",
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

/** Chip ▲/▼ de comparación vs. el período previo. `invert` = subir es malo (AHT). */
function DeltaChip({ curr, prev, invert }: { curr: number; prev?: number; invert?: boolean }) {
  if (prev == null || prev === 0) return null;
  const pct = Math.round(((curr - prev) / Math.abs(prev)) * 100);
  if (pct === 0)
    return (
      <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>= vs. previo</span>
    );
  const good = invert ? pct < 0 : pct > 0;
  const color = good ? "var(--green)" : "var(--coral)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11.5,
        fontWeight: 700,
        color,
      }}
      title="Comparado con el período inmediatamente anterior del mismo largo"
    >
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
      <span style={{ color: "var(--text-3)", fontWeight: 500 }}>vs. previo</span>
    </span>
  );
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

  // El calendario de rango re-consulta el rango REAL elegido.
  useEffect(() => {
    searchContacts({ startDate: range.start.toISOString(), endDate: range.end.toISOString() });
  }, [range, searchContacts]);

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

      {/* Período (REAL: re-consulta queryContacts) — calendario de rango con presets. */}
      <div className="row" style={{ marginBottom: 16, alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 600 }}>Período</span>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {/* KPIs — familia ARIA (Stat + count-up). */}
      {initialLoading ? (
        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            marginBottom: 20,
          }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card" style={{ height: 116 }} />
          ))}
        </div>
      ) : (
        <div
          className="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <Stat
            icon="headset"
            color="var(--cyan)"
            label="Volumen total"
            value={<Num value={kpis.total} />}
            sub={
              <>
                <DeltaChip curr={kpis.total} prev={prevKpis?.total} />
                {volumeSpark.length > 1 ? (
                  <div style={{ marginTop: 6 }}>
                    <MiniBars data={volumeSpark} color="var(--cyan)" h={26} />
                  </div>
                ) : (
                  <div style={{ color: "var(--text-3)" }}>contactos en el período</div>
                )}
              </>
            }
          />
          <Stat
            icon="clock"
            color="var(--gold)"
            label="AHT promedio"
            value={kpis.avgAht ? formatDurationSec(Math.round(kpis.avgAht)) : "—"}
            sub={
              <>
                <DeltaChip curr={kpis.avgAht} prev={prevKpis?.avgAht} invert />
                <div style={{ color: "var(--text-3)" }}>
                  {kpis.medianAht ? `mediana ${formatDurationSec(kpis.medianAht)}` : "sin datos"}
                </div>
              </>
            }
          />
          <Stat
            icon="gauge"
            color="var(--green)"
            label="Sentiment positivo"
            value={<Num value={kpis.posPct} suffix="%" />}
            sub={
              <>
                <DeltaChip curr={kpis.posPct} prev={prevKpis?.posPct} />
                <div style={{ color: "var(--text-3)" }}>de los contactos analizados</div>
              </>
            }
          />
          <Stat
            icon="trending"
            color="var(--iris)"
            label="Score neto"
            value={`${kpis.score >= 0 ? "+" : ""}${Math.round(kpis.score)}`}
            sub={
              <>
                <DeltaChip curr={kpis.score} prev={prevKpis?.score} />
                <div style={{ color: "var(--text-3)" }}>(positivos − negativos) / total</div>
              </>
            }
          />
        </div>
      )}

      {/* Filtros finos (fecha custom / agente / cola / sentiment) */}
      <div style={{ marginBottom: 16 }}>
        <ContactFilters onSearch={searchContacts} loading={loading} />
      </div>

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
                    description="Ajustá el período o los filtros para ver volumen por canal."
                  />
                ) : (
                  <ExecBarsEChart data={volumeByChannel} height={264} />
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
                <AhtHistogramEChart contacts={contacts} />
              </Card>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <Card title="Sentiment por día · Contact Lens" icon="gauge">
              {initialLoading ? (
                <div className="card" style={{ height: 280 }} />
              ) : (
                <SentimentChart contacts={contacts} />
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
              <AgentPerformanceReport contacts={contacts} />
            </Card>
          </div>

          <Card
            title="Historial de contactos"
            icon="fileText"
            extra={
              <span className="dim" style={{ fontSize: 12 }}>
                {contacts.length} contactos
              </span>
            }
            pad={false}
          >
            <ContactsTable contacts={contacts} />
          </Card>
        </>
      )}

      {/* ── CRECIMIENTO · leads (Pilar 1 + Pilar 2) ── */}
      {tab === "crecimiento" && (
        <>
          <div style={{ marginBottom: 16 }}>
            <ProgramReport />
          </div>
          <div style={{ marginBottom: 16 }}>
            <AttributionReport />
          </div>
        </>
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
              title="Detalle de conversaciones · Chat detail"
              icon="fileText"
              extra={
                <span className="dim" style={{ fontSize: 12 }}>
                  {contacts.length} conversaciones
                </span>
              }
            >
              <div
                style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 14 }}
              >
                Exporta fila por conversación con todos los campos: agente, cola, canal, duración,
                sentiment, categorías, estado y motivo de cierre — sobre tus contactos reales del
                período seleccionado. Es el reporte que en Chattigo se descarga como «Chat detail».
              </div>
              <Btn
                variant="primary"
                size="sm"
                icon="download"
                disabled={contacts.length === 0}
                onClick={() => exportContactsToCsv(contacts)}
              >
                Descargar CSV · {contacts.length} conversaciones
              </Btn>
            </Card>
          </div>
          <Card title="Exports programados · XLSX por email" icon="calendar">
            <ScheduledExportsPanel />
          </Card>
        </>
      )}
    </div>
  );
}
