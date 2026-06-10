import { useEffect, useMemo, useState } from "react";
import { getApiEndpoints } from "@/lib/api";
import { useContacts } from "@/hooks/useContacts";
import { useUsers, UUID_RE } from "@/hooks/useUsers";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { useCampaigns } from "@/hooks/useCampaigns";
import { VALORACION_META, type Valoracion } from "@/lib/dispositions";
import type { useRealtimeMetrics } from "@/hooks/useRealtimeMetrics";
import { ExecutiveView } from "@/components/dashboard/exec/ExecutiveView";
import type {
  ExecData,
  ExecInsight,
  ExecPeriod,
  ExecSlice,
} from "@/components/dashboard/exec/execMock";

/**
 * InsightsPanel — contenedor del dashboard ejecutivo (Inicio para Admins/
 * Supervisors). Mantiene TODO el cableado de datos reales (contactos, métricas
 * en vivo, leads, citas, callbacks, HSM, campañas) y lo mapea a `ExecData`, que
 * consume `ExecutiveView` (la presentación premium — recreación del diseño
 * Claude Design v2, charts en ECharts). Reemplazó la capa recharts (brief P6).
 */

interface Lead { leadId: string; stageId?: string; source?: string; updatedAt?: string; montoEstimado?: number }
interface Appt { apptId?: string; whenISO?: string; status?: string; customerName?: string; phone?: string }
interface Callback { callbackId?: string; whenISO?: string; dueISO?: string; channel?: string; status?: string; customerName?: string; phone?: string; note?: string }
interface Slice { name: string; value: number; color?: string }

type Period = "today" | "yesterday" | "week" | "month";
const PERIOD_TO_EXEC: Record<Period, ExecPeriod> = { today: "hoy", yesterday: "ayer", week: "semana", month: "mes" };
const EXEC_TO_PERIOD: Record<ExecPeriod, Period> = { hoy: "today", ayer: "yesterday", semana: "week", mes: "month" };

const SOURCE_LABEL: Record<string, string> = {
  web_form: "Web", campaign: "Campaña", salesforce: "Salesforce", whatsapp: "WhatsApp", manual: "Manual",
};
// Paleta "infografía" del diseño v2 (decisión del usuario en Claude Design).
const DATA_PALETTE = ["#15485A", "#2E9D8E", "#92C73E", "#F2972E", "#1C97A6", "#F5A524"];

const CHIP_COLOR: Record<string, string> = {
  "chip--green": "var(--accent-green)", "chip--red": "var(--accent-red)",
  "chip--violet": "var(--accent-violet)", "chip--cyan": "var(--accent-cyan)",
  "chip--amber": "var(--accent-amber)", "chip--pink": "var(--accent-pink)",
};
const valColor = (v: Valoracion): string => CHIP_COLOR[VALORACION_META[v].chip] || "var(--accent-cyan)";

type ChannelKey = "voz" | "wa" | "chat" | "email" | "sms";
function normChannel(c?: string): ChannelKey {
  const k = (c || "").toUpperCase();
  if (k === "CHAT") return "chat";
  if (k === "EMAIL") return "email";
  if (k === "SMS") return "sms";
  if (k === "WHATSAPP" || k === "WA") return "wa";
  return "voz";
}
const CHANNEL_KEYS: ChannelKey[] = ["voz", "wa", "chat", "email", "sms"];
const SENTIMENT_META: { key: string; label: string; color: string }[] = [
  { key: "POSITIVE", label: "Positivo", color: "#2E9D8E" },
  { key: "NEUTRAL", label: "Neutral", color: "#15485A" },
  { key: "MIXED", label: "Mixto", color: "#92C73E" },
  { key: "NEGATIVE", label: "Negativo", color: "#F2972E" },
];

const dayMs = 86400000;
function periodDays(p: Period): number { return p === "today" || p === "yesterday" ? 1 : p === "week" ? 7 : 30; }
function dayStartOf(t: number): number { return new Date(new Date(t).setHours(0, 0, 0, 0)).getTime(); }
function fmtDur(sec: number): string {
  if (!sec) return "0:00";
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface InsightsPanelProps {
  metrics: ReturnType<typeof useRealtimeMetrics>["metrics"];
  title?: string;
  agentsOnline?: number;
  queueCount?: number;
  lastRefresh?: Date;
  onRefresh?: () => void;
}

export function InsightsPanel({ metrics, lastRefresh, onRefresh }: InsightsPanelProps) {
  const { tree } = useTaxonomy();
  const { contacts, searchContacts } = useContacts();
  const { userIdToName } = useUsers();
  const { campaigns } = useCampaigns(15000);
  const [period, setPeriod] = useState<Period>("week");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [hsmSent, setHsmSent] = useState(0);
  const [loading, setLoading] = useState(true);

  const days = periodDays(period);
  const start = period === "yesterday" ? dayStartOf(Date.now()) - dayMs : dayStartOf(Date.now()) - (days - 1) * dayMs;

  useEffect(() => {
    const ep = getApiEndpoints();
    const jobs: Promise<void>[] = [];
    if (ep?.manageLeads) jobs.push(fetch(ep.manageLeads).then((r) => r.json()).then((d) => setLeads(d.leads || [])).catch(() => {}));
    if (ep?.manageAppointment) jobs.push(fetch(ep.manageAppointment).then((r) => r.json()).then((d) => setAppts(d.appointments || [])).catch(() => {}));
    if (ep?.getHsmReport) jobs.push(fetch(ep.getHsmReport).then((r) => r.json()).then((d) => setHsmSent(d.totals?.total || 0)).catch(() => {}));
    if (ep?.listCallbacks) jobs.push(fetch(ep.listCallbacks).then((r) => r.json()).then((d) => setCallbacks(d.callbacks || d.items || [])).catch(() => {}));
    Promise.all(jobs).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const startDate = new Date(start - days * dayMs).toISOString().slice(0, 10);
    const endDate = new Date(dayStartOf(Date.now()) + dayMs).toISOString().slice(0, 10);
    searchContacts({ startDate, endDate });
  }, [period, start, days, searchContacts]);

  const { curContacts, prevContacts } = useMemo(() => {
    const cur: typeof contacts = [], prev: typeof contacts = [];
    for (const c of contacts) {
      const t = new Date(c.initiationTimestamp).getTime();
      if (t >= start) cur.push(c);
      else if (t >= start - days * dayMs) prev.push(c);
    }
    return { curContacts: cur, prevContacts: prev };
  }, [contacts, start, days]);

  const contactSpark = useMemo(() => {
    const b = new Array(days).fill(0);
    for (const c of curContacts) {
      const i = Math.round((dayStartOf(new Date(c.initiationTimestamp).getTime()) - start) / dayMs);
      if (i >= 0 && i < days) b[i] += 1;
    }
    return b;
  }, [curContacts, start, days]);

  const prevContactSpark = useMemo(() => {
    const b = new Array(days).fill(0);
    const prevStart = start - days * dayMs;
    for (const c of prevContacts) {
      const i = Math.round((dayStartOf(new Date(c.initiationTimestamp).getTime()) - prevStart) / dayMs);
      if (i >= 0 && i < days) b[i] += 1;
    }
    return b;
  }, [prevContacts, start, days]);

  const trend = useMemo(
    () => contactSpark.map((actual, i) => ({
      label: `${new Date(start + i * dayMs).getDate()}/${new Date(start + i * dayMs).getMonth() + 1}`,
      actual,
      anterior: prevContactSpark[i] ?? 0,
    })),
    [contactSpark, prevContactSpark, start]
  );

  const aht = useMemo(() => {
    const w = curContacts.filter((c) => (c.duration ?? 0) > 0);
    return w.length ? Math.round(w.reduce((a, c) => a + (c.duration || 0), 0) / w.length) : 0;
  }, [curContacts]);

  const sentiment = useMemo<Slice[]>(() => {
    const m = new Map<string, number>();
    for (const c of curContacts) m.set((c.sentiment || "NEUTRAL").toUpperCase(), (m.get((c.sentiment || "NEUTRAL").toUpperCase()) || 0) + 1);
    return SENTIMENT_META.filter((sm) => (m.get(sm.key) || 0) > 0).map((sm) => ({ name: sm.label, value: m.get(sm.key) || 0, color: sm.color }));
  }, [curContacts]);
  const posPct = useMemo(() => {
    if (!curContacts.length) return 0;
    return Math.round((curContacts.filter((c) => (c.sentiment || "").toUpperCase() === "POSITIVE").length / curContacts.length) * 100);
  }, [curContacts]);
  const negPct = useMemo(() => {
    if (!curContacts.length) return 0;
    return Math.round((curContacts.filter((c) => (c.sentiment || "").toUpperCase() === "NEGATIVE").length / curContacts.length) * 100);
  }, [curContacts]);

  const volumeByChannel = useMemo(() => {
    const rows: Array<{ label: string; voz: number; wa: number; chat: number; email: number; sms: number }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start + i * dayMs);
      rows.push({ label: `${d.getDate()}/${d.getMonth() + 1}`, voz: 0, wa: 0, chat: 0, email: 0, sms: 0 });
    }
    for (const c of curContacts) {
      const i = Math.round((dayStartOf(new Date(c.initiationTimestamp).getTime()) - start) / dayMs);
      if (i >= 0 && i < days) { const k = normChannel(c.channel); rows[i][k] += 1; }
    }
    return rows;
  }, [curContacts, start, days]);

  const resolveAgent = (raw: string): string => {
    const r = (raw || "").trim();
    if (!r) return "—";
    if (UUID_RE.test(r)) return userIdToName.get(r) || `Agente ${r.slice(0, 4)}`;
    return r;
  };
  const queueIdToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const q of metrics?.queues ?? []) if (q.queueId && q.queueName) m.set(q.queueId, q.queueName);
    return m;
  }, [metrics]);
  const resolveQueue = (raw: string): string => {
    const r = (raw || "").trim();
    if (!r) return "Sin cola";
    if (queueIdToName.has(r)) return queueIdToName.get(r)!;
    if (UUID_RE.test(r)) return `Cola ${r.slice(0, 4)}`;
    return r;
  };

  const agentRank = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of curContacts) {
      if (!c.agentUsername) continue;
      const a = resolveAgent(c.agentUsername);
      m.set(a, (m.get(a) || 0) + 1);
    }
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curContacts, userIdToName]);
  const byQueue = useMemo<ExecSlice[]>(() => {
    const m = new Map<string, number>();
    for (const c of curContacts) { const q = resolveQueue(c.queueName); m.set(q, (m.get(q) || 0) + 1); }
    return [...m.entries()].map(([name, value], i) => ({ name, value, color: DATA_PALETTE[i % DATA_PALETTE.length] })).sort((a, b) => b.value - a.value).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curContacts, queueIdToName]);

  const periodLeads = useMemo(() => leads.filter((l) => !l.updatedAt || new Date(l.updatedAt).getTime() >= start), [leads, start]);
  const prevLeads = useMemo(() => leads.filter((l) => {
    if (!l.updatedAt) return false;
    const t = new Date(l.updatedAt).getTime();
    return t >= start - days * dayMs && t < start;
  }), [leads, start, days]);
  const leadSpark = useMemo(() => {
    const b = new Array(days).fill(0);
    for (const l of periodLeads) {
      if (!l.updatedAt) continue;
      const i = Math.round((dayStartOf(new Date(l.updatedAt).getTime()) - start) / dayMs);
      if (i >= 0 && i < days) b[i] += 1;
    }
    return b;
  }, [periodLeads, start, days]);

  const leadSources = useMemo<ExecSlice[]>(() => {
    const m = new Map<string, number>();
    for (const l of periodLeads) { const s = SOURCE_LABEL[l.source || "manual"] || l.source || "Manual"; m.set(s, (m.get(s) || 0) + 1); }
    return [...m.entries()].map(([name, value], i) => ({ name, value, color: DATA_PALETTE[i % DATA_PALETTE.length] }));
  }, [periodLeads]);

  // El embudo es un snapshot del PIPELINE (stock), no del período (flujo):
  // cuenta TODOS los leads por etapa, no solo los actualizados en el período
  // (si no, los leads viejos quedan fuera y el embudo se ve vacío).
  const funnel = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) m.set(l.stageId || "—", (m.get(l.stageId || "—") || 0) + 1);
    return tree
      .map((s) => ({ label: s.label, value: m.get(s.id) || 0, color: valColor(s.valoracion) }))
      .filter((s) => s.value > 0);
  }, [leads, tree]);

  const upcoming = appts.filter((a) => a.status !== "cancelled" && a.whenISO && new Date(a.whenISO).getTime() >= Date.now()).length;
  const apptTotal = appts.filter((a) => a.status !== "cancelled").length;
  const online = metrics?.summary.totalAgentsOnline ?? 0;
  const available = metrics?.summary.totalAgentsAvailable ?? 0;

  const insights = useMemo<ExecInsight[]>(() => {
    const out: ExecInsight[] = [];
    const qrisk = (metrics?.queues ?? [])
      .filter((q) => q.contactsInQueue > 0)
      .map((q) => ({ q, pressure: q.contactsInQueue / Math.max(1, q.agentsAvailable) }))
      .sort((a, b) => b.pressure - a.pressure)[0];
    if (qrisk && (qrisk.q.contactsInQueue >= 5 || qrisk.q.agentsAvailable === 0)) {
      const a = qrisk.q.agentsAvailable;
      out.push({
        tone: "crit", kicker: "SLA en riesgo",
        title: `${qrisk.q.queueName} · espera ${fmtDur(qrisk.q.oldestContactAge ?? 0)}`,
        sub: `${qrisk.q.contactsInQueue} en cola y ${a} ${a === 1 ? "agente libre" : "agentes libres"}.`,
        action: "Ver cola en vivo",
      });
    }
    const paused = campaigns.find((c) => c.status === "PAUSED");
    if (paused) {
      const total = Number(paused.totalContacts || 0);
      const done = (paused.doneCount || 0) + (paused.failedCount || 0);
      out.push({
        tone: "warn", kicker: "Campaña pausada", title: paused.name,
        sub: `${done}/${total} contactados — reanúdala para continuar.`,
        action: "Ir a campañas",
      });
    }
    if (periodLeads.length > 0 && periodLeads.length > prevLeads.length) {
      const d = periodLeads.length - prevLeads.length;
      out.push({
        tone: "info", kicker: "Oportunidad", title: `Leads al alza (+${d})`,
        sub: `${periodLeads.length} leads en el período vs ${prevLeads.length} en el anterior.`,
        action: "Ver leads",
      });
    }
    if (posPct >= 80 && curContacts.length > 0) {
      out.push({
        tone: "ok", kicker: "En máximo", title: "Sentiment en su mejor nivel",
        sub: `${posPct}% de contactos con sentiment positivo.`,
        action: "Ver reportes",
      });
    }
    return out.slice(0, 4);
  }, [metrics, campaigns, periodLeads, prevLeads, posPct, curContacts]);

  const execData = useMemo<ExecData>(() => ({
    kpis: {
      contactos: { value: curContacts.length, delta: curContacts.length - prevContacts.length, spark: contactSpark },
      sentimentPos: { value: posPct },
      aht: { seconds: aht },
      leads: { value: periodLeads.length, delta: periodLeads.length - prevLeads.length, spark: leadSpark },
      citas: { value: upcoming, total: apptTotal },
      plantillasWA: { value: hsmSent },
      agentes: { available, online },
    },
    volumeByChannel,
    volumeTrend: trend,
    sentiment: sentiment.map((s) => ({ name: s.name, value: s.value, color: s.color || "#15485A" })),
    agentRank,
    byQueue,
    leadSources,
    funnel,
    campaigns: campaigns
      .filter((c) => c.status === "RUNNING" || c.status === "PAUSED")
      .slice(0, 4)
      .map((c) => ({ name: c.name, done: (c.doneCount || 0) + (c.failedCount || 0), total: Number(c.totalContacts || 0), status: c.status })),
    liveQueues: (metrics?.queues ?? []).slice(0, 4).map((q) => ({
      name: q.queueName,
      enCola: q.contactsInQueue,
      libres: q.agentsAvailable,
      espera: fmtDur(q.oldestContactAge ?? 0),
      status: q.contactsInQueue > 5 || q.agentsAvailable === 0 ? "warn" : "ok",
    })),
    // Proxy de CSAT con sentiment positivo (no hay encuestas reales aún).
    csat: { value: posPct, meta: 85, encuestas: curContacts.length, promotores: posPct, detractores: negPct },
    agentsOnline: online,
    org: "",
    insights,
  }), [curContacts, prevContacts, contactSpark, posPct, negPct, aht, periodLeads, prevLeads, leadSpark, upcoming, apptTotal, hsmSent, available, online, volumeByChannel, trend, sentiment, agentRank, byQueue, leadSources, funnel, campaigns, metrics, insights]);

  return (
    <ExecutiveView
      data={execData}
      period={PERIOD_TO_EXEC[period]}
      onPeriod={(e) => setPeriod(EXEC_TO_PERIOD[e])}
      onRefresh={onRefresh}
      lastRefresh={lastRefresh}
      loading={loading && contacts.length === 0}
    />
  );
}
