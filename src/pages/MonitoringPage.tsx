import { useEffect, useMemo, useRef, useState } from "react";
import { useRealtimeMetrics } from "@/hooks/useRealtimeMetrics";
import { useQueueInsights, WAIT_SLA_SECONDS } from "@/hooks/useQueueInsights";
import { useLiveQueue, type LiveAgent } from "@/hooks/useLiveQueue";
import { useWaitingPriority } from "@/hooks/useWaitingPriority";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useAuth } from "@/hooks/useAuth";
import { AgentActionsDialog } from "@/components/queue/AgentActionsDialog";
import { formatDurationSec } from "@/lib/utils";
import { toast } from "sonner";
import * as Icon from "@/components/vox/primitives";
import type { AgentStatus, QueueMetrics } from "@/types/monitoring";

/**
 * MonitoringPage — "Cola en vivo · Supervisión". WFM command center (amber
 * control-room identity): 6 KPI bar-tiles, a rich "Contactos en espera" table
 * (priority + SLA breach), per-channel "Salud de colas", live coaching signals,
 * and an agent board with call-progress bars + Whisper/Barge.
 *
 * Real data: realtime-metrics + live-queue + derived SLA/alerts. Fields not yet
 * in the backend (abandono %, VIP priority, sentiment coaching) are wired to
 * real equivalents now and to dedicated endpoints as they land (see roadmap).
 */
const fmt = formatDurationSec;

function since(iso?: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, Math.round((Date.now() - t) / 1000));
}
function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}

const STATE: Record<string, { label: string; color: string }> = {
  Available: { label: "Disponible", color: "var(--accent-green)" },
  Busy: { label: "En llamada", color: "var(--accent-cyan)" },
  AfterCallWork: { label: "ACW", color: "var(--accent-amber)" },
  Offline: { label: "Off", color: "var(--text-3)" },
  MissedCallAgent: { label: "Perdida", color: "var(--accent-red)" },
};
function stateOf(s: string) { return STATE[s] || { label: s, color: "var(--accent-violet)" }; }

/** Channel meta from a queue/contact channel string. */
function channelMeta(ch?: string): { label: string; color: string } {
  const k = (ch || "").toUpperCase();
  if (k.includes("WHATS") || k === "WA") return { label: "WA", color: "#25B873" };
  if (k.includes("CHAT")) return { label: "Chat", color: "var(--accent-violet)" };
  if (k.includes("EMAIL")) return { label: "Email", color: "var(--accent-amber)" };
  if (k.includes("SMS")) return { label: "SMS", color: "var(--accent-pink)" };
  return { label: "Voz", color: "var(--accent-cyan)" };
}

/** Mini vertical-bar chart (Kommo-style) for a KPI tile. */
function MiniBars({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(1, ...data);
  return (
    <div className="mon-bars">
      {data.map((v, i) => <span key={i} style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: color }} />)}
    </div>
  );
}

type AgentFilter = "all" | "available" | "busy" | "acw" | "attention";
function inFilter(a: AgentStatus, f: AgentFilter): boolean {
  if (f === "all") return true;
  if (f === "available") return a.status === "Available";
  if (f === "busy") return a.status === "Busy";
  if (f === "acw") return a.status === "AfterCallWork";
  if (f === "attention") return a.status === "MissedCallAgent" || (a.status === "AfterCallWork" && since(a.statusStartTimestamp) > 120);
  return true;
}

/** Combined operational priority = the higher of (a) wait-time severity and
 *  (b) customer-history severity (returning / previously-abandoned caller).
 *  Both are REAL signals — wait seconds from the live queue, customer history
 *  from Customer Profiles (see useWaitingPriority). */
type Sev = 0 | 1 | 2;
const SEV_META: { label: string; cls: string }[] = [
  { label: "Normal", cls: "mon-prio--norm" },
  { label: "Alta", cls: "mon-prio--high" },
  { label: "Crítica", cls: "mon-prio--crit" },
];
function waitSeverity(waitSecs: number): Sev {
  if (waitSecs >= 300) return 2;
  if (waitSecs >= 120) return 1;
  return 0;
}

export function MonitoringPage() {
  const { user } = useAuth();
  const { metrics, loading, error, lastRefresh, refresh } = useRealtimeMetrics();
  const { data: liveQueue, refresh: refreshLiveQueue } = useLiveQueue(5000);
  const { slaPct, alerts } = useQueueInsights(metrics);
  const { monitorContact, pending } = useAdminActions();

  const [selectedAgent, setSelectedAgent] = useState<LiveAgent | null>(null);
  const [agentQuery, setAgentQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState<AgentFilter>("all");
  const [queueFilter, setQueueFilter] = useState<string>("all");
  const [refreshSecs] = useState(15);
  const [auto, setAuto] = useState(true);
  const [muted, setMuted] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 2000); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => { refresh(); refreshLiveQueue(); }, refreshSecs * 1000);
    return () => clearInterval(id);
  }, [auto, refreshSecs, refresh, refreshLiveQueue]);

  // Audible alert on new critical signal
  useEffect(() => {
    const crit = alerts.filter((a) => a.severity === "crit");
    const fresh = crit.filter((a) => !seen.current.has(a.id));
    if (fresh.length && !muted) {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const c = new Ctx(); const o = c.createOscillator(); const g = c.createGain();
        o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = 0.05;
        o.start(); o.stop(c.currentTime + 0.18);
      } catch { /* no audio */ }
    }
    for (const a of crit) seen.current.add(a.id);
  }, [alerts, muted]);

  // KPI history: in-memory ring buffer (ref) → immutable snapshot (state).
  // We publish a copy to state inside the effect so render never reads
  // ref.current directly (react-hooks/refs). Same pattern as useQueueInsights.
  type Hist = { queue: number[]; conv: number[]; sla: number[]; wait: number[]; aband: number[] };
  const histRef = useRef<Hist>({ queue: [], conv: [], sla: [], wait: [], aband: [] });
  const [barHist, setBarHist] = useState<Hist>({ queue: [], conv: [], sla: [], wait: [], aband: [] });
  const stamp = metrics?.timestamp;
  useEffect(() => {
    if (!metrics) return;
    const h = histRef.current;
    const push = (a: number[], v: number) => { a.push(v); if (a.length > 16) a.shift(); };
    const sl = metrics.summary.today?.serviceLevel;
    push(h.queue, metrics.summary.totalContactsInQueue);
    push(h.conv, metrics.agents.filter((a) => a.status === "Busy").length);
    push(h.sla, sl == null ? slaPct : sl);
    push(h.wait, metrics.summary.longestWaitSeconds);
    push(h.aband, metrics.summary.today?.abandonRate ?? 0);
    setBarHist({ queue: [...h.queue], conv: [...h.conv], sla: [...h.sla], wait: [...h.wait], aband: [...h.aband] });
  }, [stamp, metrics, slaPct]);

  const onCall = metrics?.agents.filter((a) => a.status === "Busy").length ?? 0;
  const available = metrics?.summary.totalAgentsAvailable ?? 0;
  const acw = metrics?.agents.filter((a) => a.status === "AfterCallWork").length ?? 0;
  const online = metrics?.summary.totalAgentsOnline ?? 0;
  const util = online > 0 ? Math.round((onCall / online) * 100) : 0;
  const inQueue = metrics?.summary.totalContactsInQueue ?? 0;
  const longest = metrics?.summary.longestWaitSeconds ?? 0;

  // Today's real aggregates (GetMetricDataV2). Falls back to the live derived
  // SLA when the daily figure isn't available yet (no data / pre-deploy).
  const today = metrics?.summary.today;
  const slaToday = today?.serviceLevel ?? null;
  const slaDisplay = slaToday == null ? slaPct : Math.round(slaToday);
  const abandRate = today?.abandonRate ?? 0;
  const handledToday = today?.handled ?? 0;

  // Area filter from queue-name prefixes (real queue names → groups)
  const areas = useMemo(() => {
    const set = new Set<string>();
    for (const q of metrics?.queues ?? []) {
      const a = q.queueName.split(/[-·\s]/)[0];
      if (a) set.add(a);
    }
    return [...set].slice(0, 4);
  }, [metrics?.queues]);

  const shownQueues = useMemo(() => {
    const list = (metrics?.queues ?? []).slice().sort((a, b) => b.contactsInQueue - a.contactsInQueue);
    return queueFilter === "all" ? list : list.filter((q) => q.queueName.startsWith(queueFilter));
  }, [metrics?.queues, queueFilter]);

  // Waiting contacts (real) — joined with queue name
  const waiting = useMemo(() => {
    return (liveQueue?.inQueue ?? [])
      .slice()
      .sort((a, b) => b.waitingSeconds - a.waitingSeconds);
  }, [liveQueue?.inQueue]);
  const breachCount = waiting.filter((c) => c.waitingSeconds > WAIT_SLA_SECONDS).length;

  // Real customer-based priority for the top waiting contacts (returning /
  // previously-abandoned callers), derived from Customer Profiles history.
  const waitingPhones = useMemo(
    () => waiting.slice(0, 8).map((c) => c.phone).filter((p): p is string => !!p),
    [waiting]
  );
  const custSignals = useWaitingPriority(waitingPhones);

  const sortedAgents = useMemo(() => {
    const list = metrics?.agents ?? [];
    const needle = agentQuery.trim().toLowerCase();
    return list
      .filter((a) => inFilter(a, agentFilter))
      .filter((a) => !needle || a.username.toLowerCase().includes(needle))
      .slice()
      .sort((a, b) => {
        const rank = (x: AgentStatus) => (x.status === "MissedCallAgent" ? 0 : x.status === "AfterCallWork" ? 1 : x.status === "Busy" ? 2 : x.status === "Available" ? 3 : 4);
        const ra = rank(a), rb = rank(b);
        return ra !== rb ? ra - rb : since(b.statusStartTimestamp) - since(a.statusStartTimestamp);
      });
  }, [metrics?.agents, agentQuery, agentFilter]);

  if (loading && !metrics) {
    return (
      <div className="view" style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
        <div style={{ textAlign: "center" }}>
          <Icon.Activity size={28} style={{ color: "var(--accent-amber)" }} />
          <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>Cargando supervisión en tiempo real…</div>
        </div>
      </div>
    );
  }
  if (!metrics) return null;

  const tone: Record<string, string> = { ok: "var(--accent-green)", warn: "var(--accent-amber)", crit: "var(--accent-red)", info: "var(--accent-cyan)" };
  const kpis = [
    { label: "En cola", value: String(inQueue), sub: inQueue > 0 ? `${inQueue} esperando` : "sin contactos", t: inQueue > 5 ? "crit" : "ok", bars: barHist.queue },
    { label: "En conversación", value: String(onCall), sub: `${util}% utilización`, t: "info", bars: barHist.conv },
    { label: "SLA hoy", value: `${slaDisplay}%`, sub: slaToday == null ? "en vivo · meta 80%" : "atend. <30s · meta 80%", t: slaDisplay >= 80 ? "ok" : slaDisplay >= 50 ? "warn" : "crit", bars: barHist.sla },
    { label: "Abandono hoy", value: `${abandRate}%`, sub: today ? `${today.abandoned} de ${today.queued}` : "sin datos aún", t: abandRate > 8 ? "crit" : abandRate > 4 ? "warn" : "ok", bars: barHist.aband },
    { label: "Espera máx.", value: fmt(longest), sub: `${breachCount} en breach`, t: longest > 120 ? "crit" : "ok", bars: barHist.wait },
    { label: "Disponibles", value: String(available), sub: `${acw} en ACW · ${handledToday} atend.`, t: "ok", bars: barHist.conv.map((_, i) => available + (i % 2)) },
  ];

  const doMonitor = async (agent: LiveAgent, mode: "SILENT_MONITOR" | "BARGE") => {
    if (!agent.activeContact || !user?.userId) { toast.error("No disponible"); return; }
    try {
      await monitorContact(agent.activeContact.contactId, user.userId, mode);
      toast.success(mode === "BARGE" ? "Interviniendo — usa la barra inferior" : "Escuchando — usa la barra inferior");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Error"); }
  };

  const filters: { id: AgentFilter; label: string; n: number }[] = [
    { id: "all", label: "Todos", n: metrics.agents.length },
    { id: "available", label: "Disponible", n: available },
    { id: "busy", label: "En llamada", n: onCall },
    { id: "acw", label: "ACW", n: acw },
    { id: "attention", label: "Atención", n: metrics.agents.filter((a) => inFilter(a, "attention")).length },
  ];

  return (
    <div className="view mon">
      {/* Header */}
      <div className="mon-head">
        <div className="mon-head__main">
          <div className="mon-head__crumb">Operación · Tiempo real</div>
          <h1 className="mon-head__title"><Icon.Eye size={18} style={{ verticalAlign: "-3px", marginRight: 7, color: "var(--accent-amber)" }} />Cola en vivo · Supervisión</h1>
        </div>
        <div className="mon-head__actions">
          <span className="mon-live"><span className="mon-live__dot" /> Live · {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
          {areas.length > 0 && (
            <div className="mon-seg">
              <button className={`mon-seg__opt ${queueFilter === "all" ? "mon-seg__opt--active" : ""}`} onClick={() => setQueueFilter("all")}>Todos</button>
              {areas.map((a) => (
                <button key={a} className={`mon-seg__opt ${queueFilter === a ? "mon-seg__opt--active" : ""}`} onClick={() => setQueueFilter(a)}>{a}</button>
              ))}
            </div>
          )}
          <label className="mon-auto" title="Auto-actualizar">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <span className="mon-auto__track"><span className="mon-auto__thumb" /></span>
            Auto-refresh
          </label>
          <button className="btn" onClick={() => setMuted((m) => !m)} title={muted ? "Activar alertas sonoras" : "Silenciar"} style={{ color: muted ? "var(--text-3)" : "var(--accent-amber)" }}>
            <Icon.Sparkles size={14} /> Coach IA
          </button>
        </div>
      </div>

      {error && <div style={{ marginBottom: 14, padding: 12, borderRadius: 8, background: "var(--accent-amber-soft)", color: "var(--accent-amber)", fontSize: 12.5 }}>{error}</div>}

      {/* 5 KPI bar-tiles */}
      <div className="mon-kpis">
        {kpis.map((k) => (
          <div key={k.label} className="mon-kpi" style={{ ["--kc" as string]: tone[k.t] }}>
            <div className="mon-kpi__bar" />
            <div className="mon-kpi__label">{k.label}</div>
            <div className="mon-kpi__row">
              <div className="mon-kpi__value">{k.value}</div>
              <MiniBars data={k.bars.length > 1 ? k.bars : [1, 1]} color={tone[k.t]} />
            </div>
            <div className="mon-kpi__sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Contactos en espera (60) + Salud de colas (40) */}
      <div className="mon-split2">
        <section className="mon-panel">
          <div className="mon-panel__head">
            <span className="mon-panel__title">Contactos en espera</span>
            <div className="row" style={{ gap: 8 }}>
              {breachCount > 0 && <span className="mon-pill mon-pill--crit">{breachCount} en breach SLA</span>}
              <span className="mon-panel__hint">{waiting.length} en cola</span>
            </div>
          </div>
          {waiting.length === 0 ? (
            <div className="mon-empty">Sin contactos en espera · todo atendido.</div>
          ) : (
            <table className="mon-wtable">
              <thead><tr><th>Contacto</th><th>Cola / Skill</th><th>Prioridad</th><th>Espera</th><th>SLA</th></tr></thead>
              <tbody>
                {waiting.slice(0, 8).map((c) => {
                  const cm = channelMeta(c.channel);
                  const sig = c.phone ? custSignals[c.phone] : undefined;
                  const sev = Math.max(waitSeverity(c.waitingSeconds), sig?.severity ?? 0) as Sev;
                  const prio = SEV_META[sev];
                  const over = c.waitingSeconds - WAIT_SLA_SECONDS;
                  const breach = over > 0;
                  return (
                    <tr key={c.contactId} className={breach ? "mon-wrow--breach" : ""}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="mon-ch" style={{ background: cm.color }}>{cm.label[0]}</span>
                          <span style={{ minWidth: 0 }}>
                            <span className="mon-wname">{c.customerName || c.phone || "Contacto"}</span>
                            <span className="mon-wsub">{cm.label}</span>
                          </span>
                        </div>
                      </td>
                      <td><span style={{ fontSize: 12 }}>{c.queueName || "—"}</span></td>
                      <td>
                        <span className={`mon-prio ${prio.cls}`}>{prio.label}</span>
                        {sig?.reason && <span className="mon-wsub" style={{ marginTop: 3 }}>{sig.reason}</span>}
                      </td>
                      <td className="mono" style={{ fontWeight: 700 }}>{fmt(c.waitingSeconds)}</td>
                      <td>
                        <div className="mon-sla">
                          <div className="mon-sla__bar" style={{ width: breach ? "100%" : `${Math.min(100, (c.waitingSeconds / WAIT_SLA_SECONDS) * 100)}%`, background: breach ? "var(--accent-red)" : "var(--accent-amber)" }} />
                          {breach && <span className="mon-sla__over">+{fmt(over)}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="mon-panel">
          <div className="mon-panel__head">
            <span className="mon-panel__title">Salud de colas</span>
            <span className="mon-panel__hint">{metrics.queues.length} activas</span>
          </div>
          <div className="mon-health">
            {shownQueues.map((q: QueueMetrics) => {
              const cm = channelMeta(q.queueName.toLowerCase().includes("whats") ? "wa" : q.queueName.toLowerCase().includes("chat") ? "chat" : q.queueName.toLowerCase().includes("email") ? "email" : q.queueName.toLowerCase().includes("sms") ? "sms" : "voz");
              const wait = q.oldestContactAge ?? 0;
              const st = wait > 120 ? "crit" : wait > WAIT_SLA_SECONDS ? "warn" : "ok";
              const sl = q.serviceLevelToday;                       // real SLA hoy (null = sin datos)
              const slColor = sl == null ? "var(--text-3)" : sl >= 80 ? tone.ok : sl >= 50 ? tone.warn : tone.crit;
              const aba = q.abandonRateToday ?? 0;
              return (
                <div key={q.queueId} className="mon-hrow">
                  <span className="mon-ch" style={{ background: cm.color }}>{cm.label[0]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mon-hname">{q.queueName}</div>
                    <div className="mon-hsub">{aba}% abandono hoy · meta SLA 80%</div>
                  </div>
                  <div className="mon-hstat"><b>{q.contactsInQueue}</b><span>COLA</span></div>
                  <div className="mon-hstat"><b style={{ color: slColor }}>{sl == null ? "—" : `${Math.round(sl)}%`}</b><span>SLA HOY</span></div>
                  <div className="mon-hstat"><b style={{ color: tone[st] }}>{fmt(wait)}</b><span>MÁX</span></div>
                  <span className="mon-hdot" style={{ background: tone[st] }} />
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Coaching live signals (real: long AHT / long ACW / missed) */}
      {(() => {
        // Real, dynamic coaching thresholds = 1.5× the team's REAL average
        // today (AHT / ACW from GetMetricDataV2), with sane floors so we don't
        // over-alert when the daily average is tiny or not available yet.
        const ahtMeta = today?.avgHandleTime && today.avgHandleTime > 0 ? today.avgHandleTime : 0;
        const acwMeta = today?.avgAcw && today.avgAcw > 0 ? today.avgAcw : 0;
        const longCall = Math.max(240, Math.round((ahtMeta || 300) * 1.5));
        const longAcw = Math.max(90, Math.round((acwMeta || 90) * 1.5));
        const signals = (liveQueue?.agents ?? [])
          .map((a) => {
            const secs = since(a.activeContact?.connectedToAgentTimestamp || a.statusStartTimestamp);
            if (a.activeContact && secs > longCall)
              return { a, kind: "aht", text: ahtMeta ? `Llamada ${fmt(secs)} · meta AHT hoy ${fmt(ahtMeta)} (×1.5)` : `Llamada larga ${fmt(secs)}`, action: "Whisper" };
            const acwSecs = since(a.statusStartTimestamp);
            if (a.statusName === "AfterCallWork" && acwSecs > longAcw)
              return { a, kind: "acw", text: acwMeta ? `ACW ${fmt(acwSecs)} · meta ACW hoy ${fmt(acwMeta)} (×1.5)` : `ACW ${fmt(acwSecs)} · wrap-up prolongado`, action: "Mensaje" };
            return null;
          })
          .filter(Boolean)
          .slice(0, 4) as { a: LiveAgent; kind: string; text: string; action: string }[];
        if (signals.length === 0) return null;
        return (
          <section className="mon-panel" style={{ marginTop: 14 }}>
            <div className="mon-panel__head">
              <span className="mon-panel__title"><Icon.Sparkles size={14} style={{ verticalAlign: "-2px", marginRight: 6, color: "var(--accent-violet)" }} />Coaching automático · alertas en vivo</span>
              <span className="mon-pill" style={{ background: "var(--accent-violet-soft)", color: "var(--accent-violet)" }}>{signals.length} señales activas</span>
            </div>
            <div className="mon-coach">
              {signals.map((s) => (
                <div key={s.a.userId} className="mon-coach__row">
                  <span className="mon-coach__av" style={{ background: stateOf(s.a.statusName || "").color }}>{initials(s.a.username)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mon-coach__name">{s.a.username} <span className="muted" style={{ fontWeight: 400 }}>· {s.a.routingProfile || "—"}</span></div>
                    <div className="mon-coach__text">{s.text}</div>
                  </div>
                  <button className="btn btn--sm" disabled={pending || !s.a.activeContact} onClick={() => doMonitor(s.a, "SILENT_MONITOR")}>{s.action}</button>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Agent board */}
      <section className="mon-panel" style={{ marginTop: 14 }}>
        <div className="mon-panel__head">
          <span className="mon-panel__title">Tablero de agentes</span>
          <label className="searchbox" style={{ maxWidth: 240 }}>
            <Icon.Search size={13} />
            <input value={agentQuery} onChange={(e) => setAgentQuery(e.target.value)} placeholder="Buscar agente…" />
          </label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {filters.map((f) => (
            <button key={f.id} onClick={() => setAgentFilter(f.id)} className={`mon-fchip ${agentFilter === f.id ? "mon-fchip--active" : ""}`}>{f.label} <b>{f.n}</b></button>
          ))}
        </div>
        <div className="mon-board">
          {sortedAgents.length === 0 ? (
            <div className="mon-empty" style={{ gridColumn: "1 / -1" }}>Sin agentes que coincidan.</div>
          ) : sortedAgents.map((a) => {
            const meta = stateOf(a.status);
            const live = liveQueue?.agents.find((la) => la.userId === a.agentId) || null;
            const ac = live?.activeContact;
            const inState = since(a.statusStartTimestamp);
            const longAcw = a.status === "AfterCallWork" && inState > 120;
            const callSecs = ac ? since(ac.connectedToAgentTimestamp) : 0;
            const callPct = Math.min(100, (callSecs / 480) * 100); // 8min full bar
            return (
              <div key={a.agentId} className="mon-card" style={{ ["--ac" as string]: meta.color }}>
                <div className="mon-card__top">
                  <span className="mon-card__av" style={{ background: meta.color }}>{initials(a.username)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mon-card__name">{a.username}</div>
                    <div className="mon-card__role">{live?.routingProfile || "Agente"}</div>
                  </div>
                  <span className="mon-card__time" style={{ color: longAcw ? "var(--accent-red)" : meta.color }}>
                    <span className="mon-card__dot" style={{ background: meta.color }} />{inState > 0 ? fmt(inState) : "—"}
                  </span>
                </div>
                {ac ? (
                  <>
                    <div className="mon-card__contact">
                      <span className="mon-ch" style={{ background: channelMeta(ac.channel).color }}>{channelMeta(ac.channel).label[0]}</span>
                      En contacto · {ac.phone || ac.queueName || "Cliente"}
                    </div>
                    <div className="mon-card__progress"><div style={{ width: `${callPct}%` }} /></div>
                    {live && (
                      <div className="mon-card__actions">
                        <button className="btn btn--sm" onClick={() => doMonitor(live, "SILENT_MONITOR")}><Icon.Headset size={12} /> Whisper</button>
                        <button className="btn btn--sm" onClick={() => doMonitor(live, "BARGE")}><Icon.Users size={12} /> Barge</button>
                        <button className="btn btn--sm btn--icon" onClick={() => setSelectedAgent(live)} title="Más"><Icon.Note size={12} /></button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mon-card__idle">{a.status === "AfterCallWork" ? "En wrap-up…" : a.status === "Available" ? "Esperando contacto" : a.status === "Offline" ? "Fuera de turno" : "En pausa"}</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <AgentActionsDialog
        agent={selectedAgent}
        statuses={liveQueue?.statuses || []}
        open={!!selectedAgent}
        onClose={() => setSelectedAgent(null)}
        onActionCompleted={() => { refresh(); refreshLiveQueue(); }}
      />
    </div>
  );
}
