import { Fragment, useEffect, useMemo, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";
import { useNavigate } from "react-router-dom";
import { getApiEndpoints } from "@/lib/api";
import { useContacts } from "@/hooks/useContacts";
import { useUsers, UUID_RE } from "@/hooks/useUsers";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { useCampaigns } from "@/hooks/useCampaigns";
import { VALORACION_META, type Valoracion } from "@/lib/dispositions";
import { StatCard } from "@/components/dashboard/StatCard";
import { CustomCharts, type ChartData } from "@/components/dashboard/CustomCharts";
import { DashboardControls, type Period } from "@/components/dashboard/DashboardControls";
import { useGoals } from "@/hooks/useGoals";
import { Activity, Pause, Sparkles, ArrowUp, ChevRight, ChevDown, Users, Queue, Refresh, Chart, Building, Calendar, Settings } from "@/components/vox/primitives";
import { pluralES } from "@/lib/utils";
import type { useRealtimeMetrics } from "@/hooks/useRealtimeMetrics";

/**
 * InsightsPanel — the Inicio analytics dashboard. Contact-center-grade,
 * interactive, theme-aware (deep-black dark / clean light). Mix of Linear
 * (typography, restraint), Vercel/Stripe (density, sparklines, deltas) and
 * Chattigo (big vivid donuts + a radial gauge). All from REAL data: contacts
 * (useContacts), leads/citas (Lambdas), live metrics.
 */

interface Lead { leadId: string; stageId?: string; source?: string; updatedAt?: string; montoEstimado?: number }
interface Appt { apptId?: string; whenISO?: string; status?: string; customerName?: string; phone?: string }
interface Callback { callbackId?: string; whenISO?: string; dueISO?: string; channel?: string; status?: string; customerName?: string; phone?: string; note?: string }

const SOURCE_LABEL: Record<string, string> = {
  web_form: "Web", campaign: "Campaña", salesforce: "Salesforce", whatsapp: "WhatsApp", manual: "Manual",
};
// Handoff "infographic" palette (teal / emerald / lime / orange) agreed for
// the executive dashboard charts in the design handoff.
const EXEC_PALETTE = {
  teal: "#15485A",
  emerald: "#2E9D8E",
  lime: "#92C73E",
  orange: "#F2972E",
  cyan: "#1C97A6",
  amber: "#F5A524",
};
const DONUT_COLORS = [
  EXEC_PALETTE.teal, EXEC_PALETTE.emerald, EXEC_PALETTE.lime,
  EXEC_PALETTE.orange, EXEC_PALETTE.cyan, EXEC_PALETTE.amber,
];
// Comparative area chart series colors (actual vs previous period).
const AREA_ACTUAL = EXEC_PALETTE.orange;
const AREA_PREV = EXEC_PALETTE.emerald;
const CHIP_COLOR: Record<string, string> = {
  "chip--green": "var(--accent-green)", "chip--red": "var(--accent-red)",
  "chip--violet": "var(--accent-violet)", "chip--cyan": "var(--accent-cyan)",
  "chip--amber": "var(--accent-amber)", "chip--pink": "var(--accent-pink)",
};
const valColor = (v: Valoracion): string => CHIP_COLOR[VALORACION_META[v].chip] || "var(--accent-cyan)";

type ChannelKey = "voice" | "wa" | "chat" | "email" | "sms" | "task";
const CHANNEL_META: { key: ChannelKey; label: string; color: string }[] = [
  { key: "voice", label: "Voz", color: "#15485A" },
  { key: "wa", label: "WhatsApp", color: "#2E9D8E" },
  { key: "chat", label: "Chat", color: "#1C97A6" },
  { key: "email", label: "Email", color: "#F2972E" },
  { key: "sms", label: "SMS", color: "#92C73E" },
  { key: "task", label: "Tarea", color: "var(--text-3)" },
];
function normChannel(c?: string): ChannelKey {
  const k = (c || "").toUpperCase();
  if (k === "CHAT") return "chat";
  if (k === "EMAIL") return "email";
  if (k === "SMS") return "sms";
  if (k === "WHATSAPP" || k === "WA") return "wa";
  if (k === "TASK") return "task";
  return "voice";
}
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

/** Compact soles formatting for pipeline value (S/ 12.5k, S/ 1.2M). */
function fmtSoles(n: number): string {
  if (n >= 1_000_000) return `S/ ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `S/ ${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `S/ ${n}`;
}

const cardStyle: React.CSSProperties = {
  padding: 16, borderRadius: 14, background: "var(--bg-2)",
  border: "1px solid var(--border-1)", display: "flex", flexDirection: "column",
};
const sectionLabel: React.CSSProperties = {
  fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--text-3)", fontWeight: 700,
};

interface Slice { name: string; value: number; color?: string }

function DonutCard({ title, data, centerLabel, empty }: { title: string; data: Slice[]; centerLabel: string; empty: string }) {
  const total = data.reduce((a, s) => a + s.value, 0);
  return (
    <div style={{ ...cardStyle, minHeight: 220 }}>
      <div style={{ ...sectionLabel, marginBottom: 10 }}>{title}</div>
      {data.length === 0 || total === 0 ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 12 }}>{empty}</div>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ position: "relative", width: 140, height: 140, flex: "0 0 auto" }}>
            <PieChart width={140} height={140}>
              <Pie data={data} dataKey="value" nameKey="name" cx={69} cy={69} innerRadius={45} outerRadius={68} paddingAngle={2} stroke="none" isAnimationActive={false}>
                {data.map((s, i) => <Cell key={i} fill={s.color || DONUT_COLORS[i % DONUT_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 8, fontSize: 12 }} itemStyle={{ color: "var(--text-1)" }} />
            </PieChart>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: "var(--text-1)", lineHeight: 1, letterSpacing: -0.5 }}>{total}</span>
              <span style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{centerLabel}</span>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {data.map((s, i) => {
              const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
              return (
                <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-2)" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color || DONUT_COLORS[i % DONUT_COLORS.length], flex: "0 0 auto" }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <span style={{ fontWeight: 700, color: "var(--text-1)" }}>{s.value}</span>
                  <span style={{ fontSize: 10.5, color: "var(--text-3)", width: 32, textAlign: "right" }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Radial gauge (Chattigo-style) — a single % with a colored arc + a goal. */
function GaugeCard({ title, pct, color, caption, target }: { title: string; pct: number; color: string; caption: string; target?: number }) {
  const data = [{ name: title, value: pct, fill: color }];
  const diff = target != null ? pct - target : 0;
  return (
    <div style={{ ...cardStyle, minHeight: 220 }}>
      <div style={{ ...sectionLabel, marginBottom: 10 }}>{title}</div>
      <div style={{ flex: 1, display: "grid", placeItems: "center", minHeight: 160 }}>
        <div style={{ position: "relative", width: 180, height: 152 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart innerRadius="72%" outerRadius="100%" data={data} startAngle={90} endAngle={-270}>
              <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
              <RadialBar background={{ fill: "var(--border-1)" }} dataKey="value" cornerRadius={20} isAnimationActive={false} angleAxisId={0} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <span style={{ fontSize: 34, fontWeight: 800, color, lineHeight: 1, letterSpacing: -1 }}>{pct}%</span>
          </div>
        </div>
      </div>
      {target != null && (
        <div className="exec-gauge-meta">
          Meta {target}% ·{" "}
          <b style={{ color: diff >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
            {diff >= 0 ? "+" : ""}{diff} pts {diff >= 0 ? "por encima" : "por debajo"}
          </b>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--text-3)", textAlign: "center", marginTop: 6 }}>{caption}</div>
    </div>
  );
}

/** Actionable "Atención requerida" insight strip — operates by exception. */
type Severity = "crit" | "warn" | "info" | "good";
interface Insight {
  sev: Severity;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  kicker: string;
  title: string;
  sub: string;
  action: string;
  to: string;
}
const SEV_COLOR: Record<Severity, string> = {
  crit: "var(--accent-red)",
  warn: "var(--accent-amber)",
  info: "var(--accent-violet)",
  good: "var(--accent-green)",
};
function InsightsStrip({ items }: { items: Insight[] }) {
  const navigate = useNavigate();
  if (items.length === 0) return null;
  return (
    <div className="exec-insights">
      {items.map((it, i) => {
        const Icn = it.icon;
        return (
          <div
            key={i}
            className="exec-ins"
            style={{ ["--ins" as string]: SEV_COLOR[it.sev] }}
            onClick={() => navigate(it.to)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && navigate(it.to)}
          >
            <div className="exec-ins__icon"><Icn size={15} /></div>
            <div style={{ minWidth: 0 }}>
              <div className="exec-ins__kicker">{it.kicker}</div>
              <div className="exec-ins__title">{it.title}</div>
              <div className="exec-ins__sub">{it.sub}</div>
              <span className="exec-ins__action">{it.action} <ChevRight size={12} /></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Horizontal ranking bars (top agents / queues). */
function RankCard({ title, rows, color, empty }: { title: string; rows: { label: string; value: number }[]; color: string; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ ...cardStyle, minHeight: 220 }}>
      <div style={{ ...sectionLabel, marginBottom: 12 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 12 }}>{empty}</div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-around", gap: 8 }}>
          {rows.map((r, i) => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 18, fontSize: 11, fontWeight: 700, color: "var(--text-3)" }}>{i + 1}</span>
              <span style={{ width: 92, fontSize: 11.5, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
              <div style={{ flex: 1, height: 9, borderRadius: 5, background: "var(--border-1)", overflow: "hidden" }}>
                <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", background: color, borderRadius: 5, transition: "width .3s" }} />
              </div>
              <span style={{ width: 22, textAlign: "right", fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pill bars with a numbered ring-cap (handoff "Contactos por cola" style). */
function QueuePillCard({ title, data, empty }: { title: string; data: Slice[]; empty: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((a, s) => a + s.value, 0);
  return (
    <div style={{ ...cardStyle, minHeight: 220 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={sectionLabel}>{title}</div>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>{total} total</span>
      </div>
      {data.length === 0 ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 12 }}>{empty}</div>
      ) : (
        <div className="exec-pills" style={{ flex: 1, justifyContent: "space-around" }}>
          {data.map((d, i) => {
            const color = d.color || DONUT_COLORS[i % DONUT_COLORS.length];
            const pct = Math.round((d.value / max) * 100);
            return (
              <div key={d.name} className="exec-pill-row">
                <div className="exec-pill-cap" style={{ ["--pc" as string]: color }}>{d.value}</div>
                <div className="exec-pill-track">
                  <div className="exec-pill-fill" style={{ ["--pc" as string]: color, width: `${pct}%` }} />
                </div>
                <div className="exec-pill-name">{d.name}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** teal (cold) → orange (hot) ramp on the infographic palette. */
function heatColor(v: number): string {
  if (v <= 0) return "var(--bg-3)";
  if (v < 0.35) return `rgba(28,151,166,${0.18 + v})`;
  if (v < 0.7) return `rgba(46,157,142,${0.3 + v * 0.5})`;
  return `rgba(242,151,46,${0.45 + (v - 0.7) * 1.2})`;
}
const HEAT_DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const HEAT_HOURS = ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20"];
function ContactHeatmap({ grid, max }: { grid: number[][]; max: number }) {
  return (
    <div className="exec-heat">
      <div className="exec-heat__grid">
        <div />
        {HEAT_HOURS.map((h) => <div key={h} className="exec-heat__collabel">{h}</div>)}
        {HEAT_DAYS.map((d, r) => (
          <Fragment key={d}>
            <div className="exec-heat__rowlabel">{d}</div>
            {HEAT_HOURS.map((h, c) => {
              const count = grid[r]?.[c] ?? 0;
              return (
                <div
                  key={h}
                  className="exec-heat__cell"
                  style={{ background: heatColor(count / max) }}
                  title={`${d} ${h}:00 · ${count} ${count === 1 ? "contacto" : "contactos"}`}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="exec-heat__legend">
        <span>Menos</span>
        {[0.1, 0.35, 0.6, 0.85, 1].map((v) => <i key={v} style={{ background: heatColor(v) }} />)}
        <span>Más</span>
      </div>
    </div>
  );
}

interface InsightsPanelProps {
  metrics: ReturnType<typeof useRealtimeMetrics>["metrics"];
  /** Fused header (Kommo-style) — rendered inside the panel for Admin/Sup. */
  title?: string;
  agentsOnline?: number;
  queueCount?: number;
  lastRefresh?: Date;
  onRefresh?: () => void;
}

export function InsightsPanel({
  metrics,
  title,
  agentsOnline: agentsOnlineProp,
  queueCount: queueCountProp,
  lastRefresh,
  onRefresh,
}: InsightsPanelProps) {
  const navigate = useNavigate();
  const { tree } = useTaxonomy();
  const { contacts, searchContacts } = useContacts();
  const { userIdToName, users } = useUsers();
  const [period, setPeriod] = useState<Period>("week");
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [hsmSent, setHsmSent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mainChart, setMainChart] = useState<"compare" | "channel">("compare");
  // Progressive disclosure: secondary charts hidden behind "Ver más".
  const [showMore, setShowMore] = useState(false);
  const { campaigns } = useCampaigns(15000);
  const { goals, setMonthlyPipeline, goalForDays } = useGoals();
  const [editingGoal, setEditingGoal] = useState(false);

  const days = periodDays(period);
  const start = period === "yesterday" ? dayStartOf(Date.now()) - dayMs : dayStartOf(Date.now()) - (days - 1) * dayMs;

  useEffect(() => {
    const ep = getApiEndpoints();
    const jobs: Promise<void>[] = [];
    if (ep?.manageLeads) jobs.push(fetch(ep.manageLeads).then((r) => r.json()).then((d) => setLeads(d.leads || [])).catch(() => {}));
    if (ep?.manageAppointment) jobs.push(fetch(ep.manageAppointment).then((r) => r.json()).then((d) => setAppts(d.appointments || [])).catch(() => {}));
    if (ep?.getHsmReport) jobs.push(fetch(ep.getHsmReport).then((r) => r.json()).then((d) => setHsmSent(d.totals?.total || 0)).catch(() => {}));
    // Real callbacks/follow-ups for the "Tareas de hoy" pillar.
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
      // Per-agent filter (Kommo "Seleccionar usuario"): match the contact's
      // agent against the picked username, resolving UUIDs via the name map.
      if (selectedUser) {
        const raw = (c.agentUsername || "").trim();
        const name = UUID_RE.test(raw) ? userIdToName.get(raw) ?? raw : raw;
        if (name !== selectedUser) continue;
      }
      const t = new Date(c.initiationTimestamp).getTime();
      if (t >= start) cur.push(c);
      else if (t >= start - days * dayMs) prev.push(c);
    }
    return { curContacts: cur, prevContacts: prev };
  }, [contacts, start, days, selectedUser, userIdToName]);

  const contactSpark = useMemo(() => {
    const b = new Array(days).fill(0);
    for (const c of curContacts) {
      const i = Math.round((dayStartOf(new Date(c.initiationTimestamp).getTime()) - start) / dayMs);
      if (i >= 0 && i < days) b[i] += 1;
    }
    return b;
  }, [curContacts, start, days]);

  // Previous-period daily counts → comparative area chart.
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
    () =>
      contactSpark.map((actual, i) => ({
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

  const volume = useMemo(() => {
    const rows: Array<Record<string, number | string>> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start + i * dayMs);
      const row: Record<string, number | string> = { label: `${d.getDate()}/${d.getMonth() + 1}` };
      for (const ch of CHANNEL_META) row[ch.key] = 0;
      rows.push(row);
    }
    for (const c of curContacts) {
      const i = Math.round((dayStartOf(new Date(c.initiationTimestamp).getTime()) - start) / dayMs);
      if (i >= 0 && i < days) { const k = normChannel(c.channel); rows[i][k] = (rows[i][k] as number) + 1; }
    }
    return rows;
  }, [curContacts, start, days]);
  const activeChannels = useMemo(() => CHANNEL_META.filter((ch) => volume.some((r) => (r[ch.key] as number) > 0)), [volume]);

  // Resolve a raw agent id (often a UUID) → friendly username.
  const resolveAgent = (raw: string): string => {
    const r = (raw || "").trim();
    if (!r) return "—";
    if (UUID_RE.test(r)) return userIdToName.get(r) || `Agente ${r.slice(0, 4)}`;
    return r;
  };
  // Queue names on contacts often arrive as raw queueId UUIDs — map them to
  // the real queue name via the live metrics (which carry both id + name).
  const queueIdToName = useMemo(() => {
    const m = new Map<string, string>();
    for (const q of metrics?.queues ?? []) {
      if (q.queueId && q.queueName) m.set(q.queueId, q.queueName);
    }
    return m;
  }, [metrics]);
  const resolveQueue = (raw: string): string => {
    const r = (raw || "").trim();
    if (!r) return "Sin cola";
    if (queueIdToName.has(r)) return queueIdToName.get(r)!;
    if (UUID_RE.test(r)) return `Cola ${r.slice(0, 4)}`;
    return r;
  };

  // Agent ranking + queue breakdown (real contact data, friendly names)
  const agentRank = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of curContacts) {
      if (!c.agentUsername) continue; // skip unattended/system
      const a = resolveAgent(c.agentUsername);
      m.set(a, (m.get(a) || 0) + 1);
    }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curContacts, userIdToName]);
  const byQueue = useMemo<Slice[]>(() => {
    const m = new Map<string, number>();
    for (const c of curContacts) { const q = resolveQueue(c.queueName); m.set(q, (m.get(q) || 0) + 1); }
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curContacts, queueIdToName]);

  // Leads
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

  const sources = useMemo<Slice[]>(() => {
    const m = new Map<string, number>();
    for (const l of periodLeads) { const s = SOURCE_LABEL[l.source || "manual"] || l.source || "Manual"; m.set(s, (m.get(s) || 0) + 1); }
    return [...m.entries()].map(([name, value]) => ({ name, value }));
  }, [periodLeads]);

  // Pipeline value (real $) = sum of montoEstimado over the period's leads.
  const pipelineValue = useMemo(
    () => periodLeads.reduce((a, l) => a + (l.montoEstimado || 0), 0),
    [periodLeads]
  );
  const leadsWithAmount = useMemo(
    () => periodLeads.filter((l) => (l.montoEstimado || 0) > 0).length,
    [periodLeads]
  );
  const periodGoal = goalForDays(days);
  const goalPct = periodGoal > 0 ? Math.round((pipelineValue / periodGoal) * 100) : 0;

  const funnel = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of periodLeads) m.set(l.stageId || "—", (m.get(l.stageId || "—") || 0) + 1);
    return tree.map((s) => ({ label: s.label, count: m.get(s.id) || 0, color: valColor(s.valoracion) }));
  }, [periodLeads, tree]);
  const funnelMax = Math.max(1, ...funnel.map((f) => f.count));

  const upcoming = appts.filter((a) => a.status !== "cancelled" && a.whenISO && new Date(a.whenISO).getTime() >= Date.now()).length;
  const online = metrics?.summary.totalAgentsOnline ?? 0;
  const available = metrics?.summary.totalAgentsAvailable ?? 0;

  // "Mis tareas/actividades de hoy" — the #1 real gap for lead management.
  // Built from REAL data: scheduled callbacks/follow-ups (listCallbacks) +
  // appointments (manage-appointment) due today, merged and sorted by time.
  const todayTasks = useMemo(() => {
    const dayEnd = dayStartOf(Date.now()) + dayMs;
    type Task = { id: string; when: number; title: string; sub: string; kind: "callback" | "appt"; channel?: string };
    const out: Task[] = [];
    for (const c of callbacks) {
      if (c.status === "cancelled" || c.status === "done") continue;
      const iso = c.dueISO || c.whenISO;
      if (!iso) continue;
      const t = new Date(iso).getTime();
      if (t < dayStartOf(Date.now()) || t >= dayEnd) continue;
      out.push({
        id: c.callbackId || iso,
        when: t,
        title: c.customerName || c.phone || "Seguimiento",
        sub: c.note || `Follow-up${c.channel ? ` · ${c.channel}` : ""}`,
        kind: "callback",
        channel: c.channel,
      });
    }
    for (const a of appts) {
      if (a.status === "cancelled" || !a.whenISO) continue;
      const t = new Date(a.whenISO).getTime();
      if (t < dayStartOf(Date.now()) || t >= dayEnd) continue;
      out.push({
        id: a.apptId || a.whenISO,
        when: t,
        title: a.customerName || a.phone || "Cita",
        sub: "Cita agendada",
        kind: "appt",
      });
    }
    return out.sort((x, y) => x.when - y.when).slice(0, 6);
  }, [callbacks, appts]);

  // Contacts heat by weekday × 2-hour bucket (08–20) from real timestamps.
  const heatmap = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => new Array(13).fill(0));
    for (const c of curContacts) {
      const dt = new Date(c.initiationTimestamp);
      const dow = (dt.getDay() + 6) % 7; // Mon=0 … Sun=6
      let b = dt.getHours() - 8; // 08:00 → 0 … 20:00 → 12
      if (b < 0) b = 0;
      if (b > 12) b = 12;
      grid[dow][b] += 1;
    }
    return { grid, max: Math.max(1, ...grid.flat()) };
  }, [curContacts]);

  // Agent usernames for the Kommo-style "Seleccionar usuario" filter.
  const userNames = useMemo(
    () => [...new Set(users.map((u) => u.username).filter(Boolean))].sort(),
    [users]
  );
  // Human-readable range label for the control bar (e.g. "25/5 – 31/5").
  const rangeLabel = useMemo(() => {
    const fmt = (t: number) => {
      const d = new Date(t);
      return `${d.getDate()}/${d.getMonth() + 1}`;
    };
    if (period === "today") return fmt(start);
    if (period === "yesterday") return fmt(start);
    return `${fmt(start)} – ${fmt(start + (days - 1) * dayMs)}`;
  }, [period, start, days]);

  // Bundle the real datasets the panel already computes into the shape the
  // user-customizable chart gallery (CustomCharts) consumes. No recompute.
  const chartData = useMemo<ChartData>(() => ({
    dayLabels: volume.map((r) => String(r.label)),
    channelSeries: activeChannels.map((ch) => ({
      name: ch.label,
      color: ch.color,
      data: volume.map((r) => (r[ch.key] as number) || 0),
    })),
    byQueue: byQueue.map((q, i) => ({ name: q.name, value: q.value, color: DONUT_COLORS[i % DONUT_COLORS.length] })),
    liveQueues: (metrics?.queues ?? []).slice(0, 6).map((q) => ({
      name: q.queueName,
      inQueue: q.contactsInQueue,
      available: q.agentsAvailable,
    })),
    funnel: funnel.map((f) => ({ label: f.label, value: f.count, color: f.color })),
    agentRank,
    sources: sources.map((s, i) => ({ name: s.name, value: s.value, color: DONUT_COLORS[i % DONUT_COLORS.length] })),
  }), [volume, activeChannels, byQueue, funnel, agentRank, sources, metrics]);

  // Actionable "Atención requerida" insights — all derived from real data and
  // surfaced by exception (only when a condition actually holds).
  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = [];
    const qrisk = (metrics?.queues ?? [])
      .filter((q) => q.contactsInQueue > 0)
      .map((q) => ({ q, pressure: q.contactsInQueue / Math.max(1, q.agentsAvailable) }))
      .sort((a, b) => b.pressure - a.pressure)[0];
    if (qrisk && (qrisk.q.contactsInQueue >= 5 || qrisk.q.agentsAvailable === 0)) {
      const a = qrisk.q.agentsAvailable;
      out.push({
        sev: "crit", icon: Activity, kicker: "SLA en riesgo",
        title: `${qrisk.q.queueName} · espera ${fmtDur(qrisk.q.oldestContactAge ?? 0)}`,
        sub: `${qrisk.q.contactsInQueue} en cola y ${a} ${a === 1 ? "agente libre" : "agentes libres"}.`,
        action: "Ver cola en vivo", to: "/queue",
      });
    }
    const paused = campaigns.find((c) => c.status === "PAUSED");
    if (paused) {
      const total = Number(paused.totalContacts || 0);
      const done = (paused.doneCount || 0) + (paused.failedCount || 0);
      out.push({
        sev: "warn", icon: Pause, kicker: "Campaña pausada",
        title: paused.name,
        sub: `${done}/${total} contactados — reanúdala para continuar.`,
        action: "Ir a campañas", to: "/campaigns",
      });
    }
    if (periodLeads.length > 0 && periodLeads.length > prevLeads.length) {
      const d = periodLeads.length - prevLeads.length;
      out.push({
        sev: "info", icon: Sparkles, kicker: "Oportunidad",
        title: `Leads al alza (+${d})`,
        sub: `${periodLeads.length} leads en el período vs ${prevLeads.length} en el anterior.`,
        action: "Ver leads", to: "/leads",
      });
    }
    if (posPct >= 80 && curContacts.length > 0) {
      out.push({
        sev: "good", icon: ArrowUp, kicker: "En máximo",
        title: "Sentiment en su mejor nivel",
        sub: `${posPct}% de contactos con sentiment positivo.`,
        action: "Ver reportes", to: "/reports",
      });
    }
    return out.slice(0, 4);
  }, [metrics, campaigns, periodLeads, prevLeads, posPct, curContacts]);

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, background: "var(--bg-1)", border: "1px solid var(--border-1)", padding: "18px 20px 22px", boxShadow: "var(--shadow-card)" }}>
      <div style={{ position: "absolute", top: "-50%", right: "-8%", width: "55%", height: "200%", background: "radial-gradient(circle, var(--accent-cyan-soft), transparent 60%)", opacity: 0.5, pointerEvents: "none" }} />

      {/* Premium hero header (design-handoff style): gradient icon box,
          breadcrumb, big title + context chips, Live + date pill + refresh. */}
      {title && (
        <div className="exec-hero">
          <div className="exec-hero__id">
            <div className="exec-hero__icon"><Chart size={26} /></div>
            <div style={{ minWidth: 0 }}>
              <div className="exec-hero__crumb">
                <span>Inicio</span>
                <ChevRight size={12} />
                <span>Centro de operaciones</span>
              </div>
              <h1 className="exec-hero__title">{title}</h1>
              <div className="exec-hero__chips">
                <span className="exec-chip">
                  <Users size={13} />
                  <b>{agentsOnlineProp ?? 0}</b> {pluralES(agentsOnlineProp ?? 0, "agente", "agentes")}
                </span>
                <span className="exec-chip">
                  <Queue size={13} />
                  <b>{queueCountProp ?? 0}</b> {pluralES(queueCountProp ?? 0, "cola activa", "colas activas")}
                </span>
                <span className="exec-chip"><Building size={13} /> UDEP</span>
                {selectedUser && (
                  <span className="exec-chip exec-chip--accent">filtrado: {selectedUser}</span>
                )}
              </div>
            </div>
          </div>
          <div className="exec-hero__actions">
            <span className="exec-chip exec-chip--live">
              <span className="exec-chip__pulse" />
              Live{lastRefresh ? ` · ${lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
            </span>
            <span className="exec-chip"><Calendar size={13} /> {rangeLabel}</span>
            {onRefresh && (
              <button className="btn" onClick={onRefresh}>
                <Refresh size={14} /> Actualizar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Kommo-style control bar: segmented period + functional user filter */}
      <div style={{ position: "relative" }}>
        <DashboardControls
          period={period}
          onPeriod={setPeriod}
          users={userNames}
          selectedUser={selectedUser}
          onUser={setSelectedUser}
          rangeLabel={rangeLabel}
          loading={loading}
        />
      </div>

      {/* Atención requerida — actionable insights from real data */}
      <InsightsStrip items={insights} />

      {/* Hero StatCards — pipeline $ + goal % lead (CRM-grade), then ops KPIs */}
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <StatCard
          label="Valor de pipeline"
          value={pipelineValue > 0 ? fmtSoles(pipelineValue) : "S/ 0"}
          accent="var(--accent-green)"
          sub={leadsWithAmount > 0 ? `${leadsWithAmount} ${pluralES(leadsWithAmount, "lead con monto", "leads con monto")}` : "Agrega monto a tus leads"}
          to="/leads"
        />
        <div className="kpi-goal">
          <div className="kpi-goal__head">
            <span className="kpi-goal__label">% de meta</span>
            <button className="kpi-goal__edit" onClick={() => setEditingGoal((e) => !e)} title="Editar meta mensual">
              <Settings size={11} />
            </button>
          </div>
          {editingGoal ? (
            <div className="kpi-goal__editor">
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>Meta mensual S/</span>
              <input
                type="number"
                min="0"
                autoFocus
                defaultValue={goals.monthlyPipeline || ""}
                placeholder="0"
                onKeyDown={(e) => { if (e.key === "Enter") { setMonthlyPipeline(Number((e.target as HTMLInputElement).value) || 0); setEditingGoal(false); } }}
                onBlur={(e) => { setMonthlyPipeline(Number(e.target.value) || 0); setEditingGoal(false); }}
              />
            </div>
          ) : goals.monthlyPipeline > 0 ? (
            <>
              <div className="kpi-goal__value" style={{ color: goalPct >= 100 ? "var(--accent-green)" : goalPct >= 60 ? "var(--accent-amber)" : "var(--accent-red)" }}>
                {goalPct}%
              </div>
              <div className="kpi-goal__bar"><div style={{ width: `${Math.min(100, goalPct)}%`, background: goalPct >= 100 ? "var(--accent-green)" : goalPct >= 60 ? "var(--accent-amber)" : "var(--accent-red)" }} /></div>
              <div className="kpi-goal__sub">{fmtSoles(pipelineValue)} de {fmtSoles(periodGoal)}</div>
            </>
          ) : (
            <div className="kpi-goal__empty" onClick={() => setEditingGoal(true)}>
              Define tu meta mensual para ver el avance
            </div>
          )}
        </div>
        <StatCard label="Contactos" value={curContacts.length} accent="var(--accent-cyan)" delta={curContacts.length - prevContacts.length} spark={contactSpark} to="/reports" />
        <StatCard label="Sentiment positivo" value={`${posPct}%`} accent="var(--accent-green)" sub={`${curContacts.length} contactos`} to="/reports" />
        <StatCard label="AHT promedio" value={fmtDur(aht)} accent="var(--accent-violet)" sub={aht ? "tiempo medio de atención" : "sin datos"} to="/reports" />
        <StatCard label="Leads" value={periodLeads.length} accent="var(--accent-amber)" delta={periodLeads.length - prevLeads.length} spark={leadSpark} to="/leads" />
        <StatCard label="Citas próximas" value={upcoming} accent="var(--accent-pink)" sub={`${appts.length} agendadas`} to="/appointments" />
        <StatCard label="Plantillas WA" value={hsmSent} accent="#25B873" sub="enviadas (histórico)" to="/reports" />
        <StatCard label="Agentes" value={`${available}/${online}`} accent="var(--accent-green)" sub="disponibles" to="/queue" />
      </div>

      {/* Volume by channel (wide) + Sentiment donut */}
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14, marginBottom: 14 }}>
        <div style={{ ...cardStyle, minHeight: 280 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={sectionLabel}>{mainChart === "compare" ? "Volumen de contactos" : "Volumen por canal"}</div>
            {mainChart === "compare" && (
              <div style={{ display: "flex", gap: 12, marginLeft: 4 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)" }}><span style={{ width: 9, height: 9, borderRadius: 3, background: AREA_ACTUAL }} /> Actual</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)" }}><span style={{ width: 9, height: 9, borderRadius: 3, background: AREA_PREV }} /> Anterior</span>
              </div>
            )}
            <div style={{ marginLeft: "auto", display: "inline-flex", background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 9, padding: 3 }}>
              {([["compare", "Comparación"], ["channel", "Por canal"]] as const).map(([id, lbl]) => (
                <button key={id} onClick={() => setMainChart(id)} style={{
                  padding: "4px 11px", fontSize: 11.5, fontWeight: 600, borderRadius: 6, cursor: "pointer", border: "none",
                  background: mainChart === id ? "var(--bg-3)" : "transparent",
                  color: mainChart === id ? "var(--text-1)" : "var(--text-3)",
                }}>{lbl}</button>
              ))}
            </div>
          </div>
          {curContacts.length === 0 ? (
            <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 12 }}>Sin contactos en el período</div>
          ) : (
            <div style={{ flex: 1, minHeight: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                {mainChart === "compare" ? (
                  <AreaChart data={trend} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="exArea-actual" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={AREA_ACTUAL} stopOpacity={0.38} />
                        <stop offset="100%" stopColor={AREA_ACTUAL} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="exArea-prev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={AREA_PREV} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={AREA_PREV} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-1)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-3)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--border-1)" }} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: "var(--text-3)", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                    <Tooltip contentStyle={{ background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 8, fontSize: 12 }} itemStyle={{ color: "var(--text-1)" }} labelStyle={{ color: "var(--text-3)" }} />
                    <Area type="monotone" dataKey="anterior" name="Anterior" stroke={AREA_PREV} strokeWidth={2} fill="url(#exArea-prev)" isAnimationActive={false} />
                    <Area type="monotone" dataKey="actual" name="Actual" stroke={AREA_ACTUAL} strokeWidth={2} fill="url(#exArea-actual)" isAnimationActive={false} />
                  </AreaChart>
                ) : (
                  <BarChart data={volume} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-1)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "var(--text-3)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--border-1)" }} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: "var(--text-3)", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                    <Tooltip contentStyle={{ background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 8, fontSize: 12 }} itemStyle={{ color: "var(--text-1)" }} labelStyle={{ color: "var(--text-3)" }} cursor={{ fill: "var(--bg-hover)" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
                    {activeChannels.map((ch) => <Bar key={ch.key} dataKey={ch.key} name={ch.label} stackId="ch" fill={ch.color} radius={[2, 2, 0, 0]} isAnimationActive={false} />)}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <DonutCard title="Sentiment de contactos" data={sentiment} centerLabel="contactos" empty="Sin sentiment aún" />
      </div>

      {/* Tareas de hoy (real callbacks + citas) + Embudo de conversión.
          The #1 lead-management gap — actionable, at the top. */}
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 14, marginBottom: 14 }}>
        <div style={{ ...cardStyle, minHeight: 240 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={sectionLabel}>Mis tareas de hoy</div>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>{todayTasks.length} pendientes</span>
          </div>
          {todayTasks.length === 0 ? (
            <div style={{ flex: 1, display: "grid", placeItems: "center", textAlign: "center", color: "var(--text-3)", fontSize: 12.5, padding: 16 }}>
              Sin tareas para hoy · los callbacks y citas agendadas aparecerán aquí.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {todayTasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => navigate(task.kind === "appt" ? "/appointments" : "/agent")}
                  style={{
                    display: "flex", alignItems: "center", gap: 11, textAlign: "left",
                    padding: "9px 11px", borderRadius: 10, border: "1px solid var(--border-1)",
                    background: "var(--bg-1)", cursor: "pointer", width: "100%",
                  }}
                >
                  <span style={{
                    width: 40, flexShrink: 0, textAlign: "center", fontSize: 12, fontWeight: 700,
                    color: task.kind === "appt" ? "var(--accent-pink)" : "var(--accent-cyan)",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {new Date(task.when).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--text-3)" }}>{task.sub}</span>
                  </span>
                  <span className={`chip ${task.kind === "appt" ? "chip--pink" : "chip--cyan"}`} style={{ flexShrink: 0 }}>
                    {task.kind === "appt" ? "Cita" : "Callback"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ ...cardStyle, minHeight: 240 }}>
          <div style={{ ...sectionLabel, marginBottom: 12 }}>Embudo de conversión</div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 6 }}>
            {funnel.map((s) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 84, fontSize: 11.5, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                <div style={{ flex: 1, height: 9, borderRadius: 5, background: "var(--border-1)", overflow: "hidden" }}>
                  <div style={{ width: `${(s.count / funnelMax) * 100}%`, height: "100%", background: s.color, borderRadius: 5, transition: "width .3s" }} />
                </div>
                <span style={{ width: 20, textAlign: "right", fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>{s.count}</span>
              </div>
            ))}
            {funnel.length === 0 && <div style={{ color: "var(--text-3)", fontSize: 12 }}>Sin etapas configuradas.</div>}
          </div>
        </div>
      </div>

      {/* Progressive disclosure: secondary analytics behind "Ver más". */}
      {showMore && (
        <>
          {/* Gauge + agent ranking + queue (detail row) */}
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
            <GaugeCard title="Satisfacción (sentiment +)" pct={posPct} color="#2E9D8E" target={posPct > 0 ? 80 : undefined} caption={`${curContacts.length} contactos en el período`} />
            <RankCard title="Ranking de agentes" rows={agentRank} color="var(--accent-cyan)" empty="Sin contactos atendidos" />
            <QueuePillCard title="Contactos por cola" data={byQueue} empty="Sin contactos" />
          </div>

          {/* Heatmap */}
          <div style={{ position: "relative", marginBottom: 14 }}>
            <div style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={sectionLabel}>Contactos por hora × día de semana</div>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>08:00 – 20:00</span>
              </div>
              {curContacts.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>Sin contactos en el período</div>
              ) : (
                <ContactHeatmap grid={heatmap.grid} max={heatmap.max} />
              )}
            </div>
          </div>

          {/* User-customizable chart gallery (real data, persisted per browser) */}
          <CustomCharts data={chartData} loading={loading} />
        </>
      )}

      {/* Ver más / menos toggle */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
        <button className="btn btn--ghost" onClick={() => setShowMore((s) => !s)}>
          {showMore ? "Ver menos" : "Ver más analíticas"}
          {showMore ? <ArrowUp size={14} /> : <ChevDown size={14} />}
        </button>
      </div>
    </div>
  );
}
