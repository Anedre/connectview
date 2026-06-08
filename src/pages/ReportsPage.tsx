import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useContacts } from "@/hooks/useContacts";
import { ContactFilters } from "@/components/reports/ContactFilters";
import { SentimentChart } from "@/components/reports/SentimentChart";
import { AgentPerformanceReport } from "@/components/reports/AgentPerformanceReport";
import { HsmOutboundReport } from "@/components/reports/HsmOutboundReport";
import { ContactsTable } from "@/components/reports/ContactsTable";
import { FeatureNotice } from "@/components/vox/FeatureNotice";
import { formatDurationSec } from "@/lib/utils";
import * as Icon from "@/components/vox/primitives";
import { Card, CardBody, CardHead, Kpi } from "@/components/vox/primitives";
import { PageHeader } from "@/components/vox/PageHeader";
import type { ContactRecord } from "@/types/monitoring";

type ChannelKey = "voice" | "wa" | "chat" | "email" | "sms" | "task";

const CHANNEL_COLOR: Record<ChannelKey, string> = {
  voice: "var(--accent-cyan)",
  wa: "#1FAE6C",
  chat: "var(--accent-violet)",
  email: "var(--accent-amber)",
  sms: "var(--accent-pink)",
  task: "var(--text-3)",
};

function normalizeChannel(c?: string): ChannelKey {
  const k = (c || "").toUpperCase();
  if (k === "VOICE" || k === "TELEPHONY") return "voice";
  if (k === "CHAT") return "chat";
  if (k === "EMAIL") return "email";
  if (k === "SMS") return "sms";
  if (k === "WHATSAPP" || k === "WA") return "wa";
  if (k === "TASK") return "task";
  return "voice";
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Stacked-bar chart aggregating real contacts by day and channel.
 */
function VolumeByChannelChart({ contacts }: { contacts: ContactRecord[] }) {
  const { dayLabels, segs } = useMemo(() => {
    if (contacts.length === 0) return { dayLabels: [] as string[], segs: [] as Array<Record<ChannelKey, number>> };
    const byDay = new Map<string, Record<ChannelKey, number>>();
    contacts.forEach((c) => {
      const k = dayKey(c.initiationTimestamp);
      if (!byDay.has(k)) {
        byDay.set(k, { voice: 0, wa: 0, chat: 0, email: 0, sms: 0, task: 0 });
      }
      const row = byDay.get(k)!;
      row[normalizeChannel(c.channel)] += 1;
    });
    const days = Array.from(byDay.keys()).sort();
    return {
      dayLabels: days,
      segs: days.map((d) => byDay.get(d)!),
    };
  }, [contacts]);

  if (dayLabels.length === 0) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: "center",
          color: "var(--text-3)",
        }}
      >
        <Icon.Chart size={26} style={{ opacity: 0.4 }} />
        <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>
          Sin contactos en el rango seleccionado
        </div>
        <div style={{ marginTop: 4, fontSize: 11.5 }}>
          Ajusta el rango de fechas para ver volumen por canal.
        </div>
      </div>
    );
  }

  const W = 700;
  const H = 200;
  const max = Math.max(
    1,
    ...segs.map((s) => s.voice + s.wa + s.chat + s.email + s.sms + s.task)
  );
  const bw = (W - dayLabels.length * 2) / dayLabels.length;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
        {segs.map((row, i) => {
          let y = H;
          const x = (i * (bw + 2));
          const channels: ChannelKey[] = ["voice", "wa", "chat", "email", "sms", "task"];
          return (
            <g key={i}>
              {channels.map((ch) => {
                const v = row[ch];
                if (!v) return null;
                const h = (v / max) * H;
                y -= h;
                return (
                  <rect
                    key={ch}
                    x={x}
                    y={y}
                    width={bw}
                    height={h}
                    fill={CHANNEL_COLOR[ch]}
                    opacity={0.85}
                    rx="1"
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="row" style={{ gap: 14, marginTop: 8, fontSize: 11, flexWrap: "wrap" }}>
        {(["voice", "wa", "chat", "email", "sms"] as ChannelKey[]).map((ch) => (
          <span key={ch}>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: CHANNEL_COLOR[ch],
                marginRight: 4,
              }}
            />
            {ch === "voice"
              ? "Voz"
              : ch === "wa"
              ? "WhatsApp"
              : ch === "chat"
              ? "Chat"
              : ch === "email"
              ? "Email"
              : "SMS"}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * AHT histogram derived from real contact durations (seconds).
 */
function AHTHistogram({ contacts }: { contacts: ContactRecord[] }) {
  const buckets = useMemo(() => {
    const labels = ["0-1", "1-2", "2-3", "3-4", "4-5", "5-6", "6-7", "7-8", "8-9", "9-10", "10+"];
    const counts = new Array(labels.length).fill(0);
    contacts.forEach((c) => {
      if (!c.duration) return;
      const min = Math.floor((c.duration ?? 0) / 60);
      const idx = Math.min(min, labels.length - 1);
      counts[idx] += 1;
    });
    return { labels, counts };
  }, [contacts]);

  const max = Math.max(...buckets.counts, 1);

  if (contacts.length === 0) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: "center",
          color: "var(--text-3)",
        }}
      >
        <Icon.Chart size={26} style={{ opacity: 0.4 }} />
        <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>
          Sin datos de duración
        </div>
        <div style={{ marginTop: 4, fontSize: 11.5 }}>
          Aparece al obtener contactos con duración registrada.
        </div>
      </div>
    );
  }

  const total = buckets.counts.reduce((a, b) => a + b, 0);
  const median = (() => {
    const target = total / 2;
    let acc = 0;
    for (let i = 0; i < buckets.counts.length; i++) {
      acc += buckets.counts[i];
      if (acc >= target) return buckets.labels[i];
    }
    return "—";
  })();

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 160 }}>
        {buckets.counts.map((b, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span className="mono muted" style={{ fontSize: 10 }}>
              {b}
            </span>
            <div
              style={{
                width: "100%",
                height: `${(b / max) * 120}px`,
                background: "var(--accent-cyan)",
                borderRadius: 3,
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {buckets.labels.map((l) => (
          <span
            key={l}
            className="muted mono"
            style={{ fontSize: 10, flex: 1, textAlign: "center" }}
          >
            {l}
          </span>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
        Mediana:{" "}
        <span className="mono" style={{ color: "var(--text-1)" }}>
          {median}
        </span>{" "}
        min
      </div>
    </div>
  );
}

/**
 * Bug #13 — the "Exportar" button used to be a silent no-op. We now
 * generate a CSV from the current contacts list, trigger a real browser
 * download, and confirm with a toast.
 */
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

export function ReportsPage() {
  const { contacts, loading, searchContacts } = useContacts();

  useEffect(() => {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const now = new Date().toISOString();
    searchContacts({ startDate: weekAgo, endDate: now });
  }, [searchContacts]);

  const kpis = useMemo(() => {
    const total = contacts.length;
    // Only voice/chat have meaningful durations — Bug #11: emails were
    // skewing the avg with cap-out-of-conversation timestamps.
    const durations = contacts
      .filter((c) => {
        const ch = (c.channel || "").toUpperCase();
        return ch === "VOICE" || ch === "TELEPHONY" || ch === "CHAT";
      })
      .map((c) => c.duration)
      .filter((d): d is number => typeof d === "number" && d > 0);
    const avgAht = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
    const sortedDur = durations.slice().sort((a, b) => a - b);
    const medianAht = sortedDur.length
      ? sortedDur[Math.floor(sortedDur.length / 2)]
      : 0;
    const pos = contacts.filter((c) => c.sentiment === "POSITIVE").length;
    const neg = contacts.filter((c) => c.sentiment === "NEGATIVE").length;
    const sentimentScore = total
      ? Math.round(((pos - neg) / total) * 100)
      : 0;
    return {
      total,
      // Bug #11 — switch to HH:MM:SS automatically for AHTs ≥ 1h.
      aht: avgAht ? formatDurationSec(avgAht) : "—",
      ahtMedian: medianAht ? formatDurationSec(medianAht) : "—",
      pos: total ? Math.round((pos / total) * 100) : 0,
      sentimentScore,
    };
  }, [contacts]);

  return (
    <div className="view">
      <PageHeader
        crumb="Crecimiento"
        title="Reportes"
        sub={`Periodo · últimos 7 días · Contact Lens · ${contacts.length} contactos`}
        filterPill="Todos"
        actions={
          <>
            <button className="btn">
              <Icon.Calendar size={14} /> Últimos 7 días
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
              <Icon.Download size={14} /> Exportar
            </button>
          </>
        }
      />

      <FeatureNotice feature="contactLens" />

      <div className="kpi-grid">
        <Kpi
          label="Volumen total"
          value={String(kpis.total)}
          delta="Contactos en el rango"
          deltaDir="flat"
        />
        <Kpi
          label="AHT promedio"
          value={kpis.aht}
          delta={
            kpis.aht === "—"
              ? "Sin datos"
              : `Mediana ${kpis.ahtMedian}`
          }
          deltaDir="flat"
        />
        <Kpi
          label="Sentimiento positivo"
          value={`${kpis.pos}%`}
          delta={kpis.pos > 0 ? "% de contactos" : "Sin datos de sentimiento"}
          deltaDir={kpis.pos > 50 ? "up" : "flat"}
        />
        <Kpi
          label="Score neto"
          value={`${kpis.sentimentScore >= 0 ? "+" : ""}${kpis.sentimentScore}`}
          delta="Pos − Neg / Total"
          deltaDir={
            kpis.sentimentScore > 0 ? "up" : kpis.sentimentScore < 0 ? "down" : "flat"
          }
        />
      </div>

      <div style={{ height: 16 }} />

      <div style={{ marginBottom: 16 }}>
        <ContactFilters onSearch={searchContacts} loading={loading} />
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <Card>
          <CardHead title="Volumen por canal" />
          <CardBody>
            <VolumeByChannelChart contacts={contacts} />
          </CardBody>
        </Card>
        <Card>
          <CardHead title="Distribución de AHT" />
          <CardBody>
            <AHTHistogram contacts={contacts} />
          </CardBody>
        </Card>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <CardHead title="Análisis de sentiment · Contact Lens" />
        <CardBody>
          <SentimentChart contacts={contacts} />
        </CardBody>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <CardHead
          title="Rendimiento de agente"
          right={
            <span className="muted" style={{ fontSize: 11 }}>
              click en columna para ordenar
            </span>
          }
        />
        <CardBody flush>
          <AgentPerformanceReport contacts={contacts} />
        </CardBody>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <CardHead title="WhatsApp · Reporte de plantillas (HSM Outbound)" />
        <CardBody>
          <HsmOutboundReport />
        </CardBody>
      </Card>

      <Card>
        <CardHead
          title="Historial de contactos"
          right={
            <span className="muted" style={{ fontSize: 11 }}>
              {contacts.length} contactos
            </span>
          }
        />
        <CardBody flush>
          <ContactsTable contacts={contacts} />
        </CardBody>
      </Card>
    </div>
  );
}
