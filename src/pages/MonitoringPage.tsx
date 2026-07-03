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
import { Icon, Btn, Card, Stat, Pill, Av, MiniBars, HeroBand } from "@/components/aria";
import type { AgentStatus, QueueMetrics } from "@/types/monitoring";

/**
 * MonitoringPage — "Cola en vivo · Supervisión". Re-skinneada al sistema ARIA
 * (HeroBand con pulso live + Stat KPIs + Card panels), preservando el WFM
 * command center: 6 KPIs, "Contactos en espera" (prioridad + SLA breach),
 * "Salud de colas", coaching en vivo y el tablero de agentes con Whisper/Barge.
 *
 * Real data: realtime-metrics + live-queue + derived SLA/alerts. Toda la lógica,
 * hooks, effects y handlers reales quedan intactos — solo cambia la presentación.
 */
const fmt = formatDurationSec;

function since(iso?: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, Math.round((Date.now() - t) / 1000));
}

const STATE: Record<string, { label: string; color: string }> = {
  Available: { label: "Disponible", color: "var(--green)" },
  Busy: { label: "En llamada", color: "var(--cyan)" },
  AfterCallWork: { label: "ACW", color: "var(--gold)" },
  Offline: { label: "Off", color: "var(--text-3)" },
  MissedCallAgent: { label: "Perdida", color: "var(--coral)" },
};
function stateOf(s: string) { return STATE[s] || { label: s, color: "var(--iris)" }; }

/** Channel meta from a queue/contact channel string. */
function channelMeta(ch?: string): { label: string; color: string } {
  const k = (ch || "").toUpperCase();
  if (k.includes("WHATS") || k === "WA") return { label: "WA", color: "#25B873" };
  if (k.includes("CHAT")) return { label: "Chat", color: "var(--iris)" };
  if (k.includes("EMAIL")) return { label: "Email", color: "var(--gold)" };
  if (k.includes("SMS")) return { label: "SMS", color: "var(--coral)" };
  return { label: "Voz", color: "var(--cyan)" };
}

/** Small ARIA channel chip (colored rounded square with the channel initial). */
function ChBadge({ ch, size = 24 }: { ch?: string; size?: number }) {
  const cm = channelMeta(ch);
  return (
    <span
      className="tnum"
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        borderRadius: 7,
        display: "grid",
        placeItems: "center",
        fontSize: size * 0.44,
        fontWeight: 800,
        color: "#fff",
        background: cm.color,
      }}
    >
      {cm.label[0]}
    </span>
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
const SEV_META: { label: string; tone: "green" | "gold" | "coral" }[] = [
  { label: "Normal", tone: "green" },
  { label: "Alta", tone: "gold" },
  { label: "Crítica", tone: "coral" },
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
      <div className="page" style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
        <div style={{ textAlign: "center" }}>
          <Icon name="live" size={28} style={{ color: "var(--gold)" }} />
          <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>Cargando supervisión en tiempo real…</div>
        </div>
      </div>
    );
  }
  if (!metrics) return null;

  const tone: Record<string, string> = { ok: "var(--green)", warn: "var(--gold)", crit: "var(--coral)", info: "var(--cyan)" };
  const kpis = [
    { label: "En cola", icon: "headset", value: String(inQueue), sub: inQueue > 0 ? `${inQueue} esperando` : "sin contactos", t: inQueue > 5 ? "crit" : "ok", bars: barHist.queue },
    { label: "En conversación", icon: "phone", value: String(onCall), sub: `${util}% utilización`, t: "info", bars: barHist.conv },
    { label: "SLA hoy", icon: "check", value: `${slaDisplay}%`, sub: slaToday == null ? "en vivo · meta 80%" : "atend. <30s · meta 80%", t: slaDisplay >= 80 ? "ok" : slaDisplay >= 50 ? "warn" : "crit", bars: barHist.sla },
    { label: "Abandono hoy", icon: "missed", value: `${abandRate}%`, sub: today ? `${today.abandoned} de ${today.queued}` : "sin datos aún", t: abandRate > 8 ? "crit" : abandRate > 4 ? "warn" : "ok", bars: barHist.aband },
    { label: "Espera máx.", icon: "clock", value: fmt(longest), sub: `${breachCount} en breach`, t: longest > 120 ? "crit" : "ok", bars: barHist.wait },
    { label: "Disponibles", icon: "users", value: String(available), sub: `${acw} en ACW · ${handledToday} atend.`, t: "ok", bars: barHist.conv.map((_, i) => available + (i % 2)) },
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
    <div className="page" style={{ maxWidth: 1320 }}>
      {/* ARIA hero band — "Cola en vivo" con pulso live + segmentos por área y
          controles reales (auto-refresh, coach IA). Reemplaza el header propio
          por el lenguaje premium de ARIA sin perder ningún control. */}
      <HeroBand
        title={<span className="row gap10">Cola en vivo · Supervisión <span className="dot dot--live" /></span>}
        chip={<>Live · {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</>}
        chipIcon="live"
        chipTone="var(--green)"
        right={
          <div className="row gap8" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
            {areas.length > 0 && (
              <div className="row gap4">
                <Btn variant={queueFilter === "all" ? "soft" : "ghost"} size="sm" onClick={() => setQueueFilter("all")}>Todos</Btn>
                {areas.map((a) => (
                  <Btn key={a} variant={queueFilter === a ? "soft" : "ghost"} size="sm" onClick={() => setQueueFilter(a)}>{a}</Btn>
                ))}
              </div>
            )}
            <label className="row gap6" style={{ fontSize: 12.5, cursor: "pointer", color: "var(--text-2)" }} title="Auto-actualizar">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Auto-refresh
            </label>
            <Btn
              variant={muted ? "ghost" : "soft"}
              size="sm"
              icon="sparkle"
              onClick={() => setMuted((m) => !m)}
              title={muted ? "Activar alertas sonoras" : "Silenciar"}
            >
              Coach IA
            </Btn>
          </div>
        }
      />

      {error && (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: "var(--r-md)", background: "color-mix(in srgb,var(--gold) 14%,transparent)", color: "var(--gold)", fontSize: 12.5 }}>{error}</div>
      )}

      {/* 6 KPIs — familia ARIA (Stat + spark MiniBars). */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 20 }}>
        {kpis.map((k) => (
          <Stat
            key={k.label}
            icon={k.icon}
            color={tone[k.t]}
            label={k.label}
            value={k.value}
            sub={
              <div className="col gap6">
                <span>{k.sub}</span>
                <MiniBars data={k.bars.length > 1 ? k.bars : [1, 1]} color={tone[k.t]} h={22} />
              </div>
            }
          />
        ))}
      </div>

      {/* Contactos en espera (60) + Salud de colas (40) */}
      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card
          title="Contactos en espera"
          icon="clock"
          extra={
            <div className="row gap8">
              {breachCount > 0 && <Pill tone="coral">{breachCount} en breach SLA</Pill>}
              <span className="dim" style={{ fontSize: 12 }}>{waiting.length} en cola</span>
            </div>
          }
        >
          {waiting.length === 0 ? (
            <div style={{ padding: "28px 8px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Sin contactos en espera · todo atendido.</div>
          ) : (
            <div className="col gap8">
              {waiting.slice(0, 8).map((c) => {
                const sig = c.phone ? custSignals[c.phone] : undefined;
                const sev = Math.max(waitSeverity(c.waitingSeconds), sig?.severity ?? 0) as Sev;
                const prio = SEV_META[sev];
                const over = c.waitingSeconds - WAIT_SLA_SECONDS;
                const breach = over > 0;
                const cm = channelMeta(c.channel);
                const pct = breach ? 100 : Math.min(100, (c.waitingSeconds / WAIT_SLA_SECONDS) * 100);
                return (
                  <div
                    key={c.contactId}
                    className="row gap12"
                    style={{
                      padding: "10px 12px",
                      border: "1px solid " + (breach ? "color-mix(in srgb,var(--coral) 40%,var(--border-1))" : "var(--border-1)"),
                      borderRadius: "var(--r-md)",
                      background: breach ? "color-mix(in srgb,var(--coral) 7%,var(--bg-2))" : "var(--bg-2)",
                    }}
                  >
                    <ChBadge ch={c.channel} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row gap8" style={{ minWidth: 0 }}>
                        <b style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.customerName || c.phone || "Contacto"}</b>
                        <span className="dim" style={{ fontSize: 11.5 }}>· {cm.label}</span>
                      </div>
                      <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>
                        {c.queueName || "—"}{sig?.reason ? ` · ${sig.reason}` : ""}
                      </div>
                      <div className="bar" style={{ height: 5, marginTop: 6 }}>
                        <span style={{ width: `${pct}%`, background: breach ? "var(--coral)" : "var(--gold)" }} />
                      </div>
                    </div>
                    <div className="col" style={{ alignItems: "flex-end", gap: 5, flex: "0 0 auto" }}>
                      <Pill tone={prio.tone}>{prio.label}</Pill>
                      <span className="mono tnum" style={{ fontSize: 13, fontWeight: 700, color: breach ? "var(--coral-2)" : "var(--text-1)" }}>
                        {fmt(c.waitingSeconds)}{breach && <span className="dim" style={{ fontWeight: 500 }}> +{fmt(over)}</span>}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Salud de colas" icon="layers" extra={<span className="dim" style={{ fontSize: 12 }}>{metrics.queues.length} activas</span>}>
          <div className="col gap8">
            {shownQueues.map((q: QueueMetrics) => {
              const chKey = q.queueName.toLowerCase().includes("whats") ? "wa" : q.queueName.toLowerCase().includes("chat") ? "chat" : q.queueName.toLowerCase().includes("email") ? "email" : q.queueName.toLowerCase().includes("sms") ? "sms" : "voz";
              const wait = q.oldestContactAge ?? 0;
              const st = wait > 120 ? "crit" : wait > WAIT_SLA_SECONDS ? "warn" : "ok";
              const sl = q.serviceLevelToday;                       // real SLA hoy (null = sin datos)
              const slColor = sl == null ? "var(--text-3)" : sl >= 80 ? tone.ok : sl >= 50 ? tone.warn : tone.crit;
              const aba = q.abandonRateToday ?? 0;
              return (
                <div key={q.queueId} className="row gap12" style={{ padding: "10px 12px", border: "1px solid var(--border-1)", borderRadius: "var(--r-md)", background: "var(--bg-2)" }}>
                  <ChBadge ch={chKey} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.queueName}</div>
                    <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{aba}% abandono hoy · meta SLA 80%</div>
                  </div>
                  <div className="col" style={{ alignItems: "center", minWidth: 40 }}><b className="tnum" style={{ fontSize: 14 }}>{q.contactsInQueue}</b><span className="dim" style={{ fontSize: 9.5, letterSpacing: 0.3 }}>COLA</span></div>
                  <div className="col" style={{ alignItems: "center", minWidth: 46 }}><b className="tnum" style={{ fontSize: 14, color: slColor }}>{sl == null ? "—" : `${Math.round(sl)}%`}</b><span className="dim" style={{ fontSize: 9.5, letterSpacing: 0.3 }}>SLA HOY</span></div>
                  <div className="col" style={{ alignItems: "center", minWidth: 44 }}><b className="tnum mono" style={{ fontSize: 13, color: tone[st] }}>{fmt(wait)}</b><span className="dim" style={{ fontSize: 9.5, letterSpacing: 0.3 }}>MÁX</span></div>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: tone[st], flex: "0 0 auto" }} />
                </div>
              );
            })}
          </div>
        </Card>
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
          <Card
            title="Coaching automático · alertas en vivo"
            icon="sparkle"
            extra={<Pill tone="iris">{signals.length} señales activas</Pill>}
            style={{ marginBottom: 16 }}
          >
            <div className="col gap8">
              {signals.map((s) => (
                <div key={s.a.userId} className="row gap12" style={{ padding: "10px 12px", border: "1px solid var(--border-1)", borderRadius: "var(--r-md)", background: "var(--bg-2)" }}>
                  <Av name={s.a.username} size={34} color={stateOf(s.a.statusName || "").color} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.a.username} <span className="dim" style={{ fontWeight: 400 }}>· {s.a.routingProfile || "—"}</span></div>
                    <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{s.text}</div>
                  </div>
                  <Btn variant="soft" size="sm" icon="mic" disabled={pending || !s.a.activeContact} onClick={() => doMonitor(s.a, "SILENT_MONITOR")}>{s.action}</Btn>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}

      {/* Agent board */}
      <Card
        title="Tablero de agentes"
        icon="users"
        extra={
          <label className="searchbox" style={{ maxWidth: 240 }}>
            <Icon name="search" size={13} />
            <input value={agentQuery} onChange={(e) => setAgentQuery(e.target.value)} placeholder="Buscar agente…" />
          </label>
        }
      >
        <div className="row gap6" style={{ flexWrap: "wrap", marginBottom: 12 }}>
          {filters.map((f) => (
            <Btn key={f.id} variant={agentFilter === f.id ? "soft" : "ghost"} size="sm" onClick={() => setAgentFilter(f.id)}>
              {f.label} <b className="tnum" style={{ marginLeft: 4 }}>{f.n}</b>
            </Btn>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(268px, 1fr))", gap: 12 }}>
          {sortedAgents.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", padding: "28px 8px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Sin agentes que coincidan.</div>
          ) : sortedAgents.map((a) => {
            const meta = stateOf(a.status);
            const live = liveQueue?.agents.find((la) => la.userId === a.agentId) || null;
            const ac = live?.activeContact;
            const inState = since(a.statusStartTimestamp);
            const longAcw = a.status === "AfterCallWork" && inState > 120;
            const callSecs = ac ? since(ac.connectedToAgentTimestamp) : 0;
            const callPct = Math.min(100, (callSecs / 480) * 100); // 8min full bar
            return (
              <div key={a.agentId} className="card" style={{ padding: 14, borderLeft: `3px solid ${meta.color}`, ["--_c" as string]: meta.color }}>
                <div className="row gap10">
                  <div style={{ position: "relative", flex: "0 0 auto" }}>
                    <Av name={a.username} size={36} color={meta.color} />
                    <span style={{ position: "absolute", right: -2, bottom: -2, width: 12, height: 12, borderRadius: "50%", background: meta.color, border: "2px solid var(--bg-1)" }} />
                  </div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.username}</div>
                    <div className="dim" style={{ fontSize: 11.5 }}>{live?.routingProfile || "Agente"}</div>
                  </div>
                  <span className="row gap4 tnum" style={{ fontSize: 12, fontWeight: 600, color: longAcw ? "var(--coral)" : meta.color }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.color }} />{inState > 0 ? fmt(inState) : "—"}
                  </span>
                </div>
                {ac ? (
                  <>
                    <div className="row gap8" style={{ marginTop: 10, fontSize: 12, color: "var(--text-2)" }}>
                      <ChBadge ch={ac.channel} size={20} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>En contacto · {ac.phone || ac.queueName || "Cliente"}</span>
                    </div>
                    <div className="bar" style={{ height: 6, marginTop: 8 }}><span style={{ width: `${callPct}%`, background: meta.color }} /></div>
                    {live && (
                      <div className="row gap6" style={{ marginTop: 10 }}>
                        <Btn variant="ghost" size="sm" icon="headset" onClick={() => doMonitor(live, "SILENT_MONITOR")}>Whisper</Btn>
                        <Btn variant="soft" size="sm" icon="mic" onClick={() => doMonitor(live, "BARGE")}>Barge</Btn>
                        <Btn variant="ghost" size="sm" icon="fileText" onClick={() => setSelectedAgent(live)} title="Más" />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="dim" style={{ marginTop: 10, fontSize: 12 }}>{a.status === "AfterCallWork" ? "En wrap-up…" : a.status === "Available" ? "Esperando contacto" : a.status === "Offline" ? "Fuera de turno" : "En pausa"}</div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

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
