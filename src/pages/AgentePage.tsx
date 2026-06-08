import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";
import { BotTester } from "@/components/bots/BotTester";
import type { Bot } from "@/lib/botFlow";

/**
 * AgentePage — the "Agentes IA" hub (autonomous, tool-using AI agents).
 * An agent is authored here (persona, objective, knowledge, guardrails, tools,
 * handoff) and persisted via manage-bot as a single-AI-node bot (kind:"agent"),
 * so it runs on the existing bot-runtime (Bedrock/Claude). The Playground chats
 * with it live. Tool *execution* (function-calling to real Lambdas) is wired in
 * a follow-up; tools are configured + sent to the runtime now.
 */
// Text agents only (no voice): Claude on Bedrock + Amazon Q for knowledge.
const MODELS = [
  "Claude Sonnet 4.6 (Bedrock)",
  "Claude Haiku 4.5 (Bedrock)",
  "Claude Opus 4.8 (Bedrock)",
  "Amazon Q in Connect",
];
// Text channels only — WhatsApp / web chat (no voice / IVR).
const CHANNELS = ["WhatsApp", "Chat web", "Nuevo lead", "Palabra clave"];

interface ToolDef { key: string; label: string; desc: string; icon: React.ComponentType<{ size?: number }>; accent: string; }
const TOOLS: ToolDef[] = [
  { key: "book_appointment", label: "Agendar cita", desc: "Reserva una cita para el cliente", icon: Icon.Calendar, accent: "var(--accent-cyan)" },
  { key: "upsert_lead", label: "Crear / mover lead", desc: "Registra o avanza un lead en el embudo", icon: Icon.Users, accent: "var(--accent-green)" },
  { key: "lookup_customer", label: "Buscar cliente", desc: "Consulta perfil e historial del cliente", icon: Icon.Search, accent: "var(--accent-violet)" },
  { key: "send_whatsapp_template", label: "Enviar plantilla WhatsApp", desc: "Envía una plantilla aprobada al cliente", icon: Icon.WhatsApp, accent: "var(--accent-green)" },
];

interface AgentCfg {
  botId: string;
  name: string;
  status: "draft" | "active" | "paused";
  model: string;
  objective: string;
  instructions: string;
  knowledge: string;
  guardrails: string;
  handoffWhen: string;
  handoffQueue: string;
  channel: string;
  maxTurns: number;
  tools: string[];
}

function blankAgent(): AgentCfg {
  return {
    botId: "", name: "Nuevo agente IA", status: "draft", model: MODELS[1],
    objective: "", instructions: "", knowledge: "", guardrails: "",
    handoffWhen: "el cliente lo pida o se frustre", handoffQueue: "",
    channel: CHANNELS[0], maxTurns: 8, tools: [],
  };
}

/** Agent config → a runnable 1-AI-node bot graph (manage-bot + bot-runtime). */
function agentToBot(a: AgentCfg): Bot {
  return {
    botId: a.botId, name: a.name, status: a.status, trigger: a.channel,
    nodes: [
      { id: "start", kind: "start", position: { x: 240, y: 0 }, data: { trigger: a.channel } },
      { id: "ai", kind: "ai_agent", position: { x: 230, y: 140 }, data: { model: a.model, objective: a.objective, instructions: a.instructions, knowledge: a.knowledge, guardrails: a.guardrails, handoffWhen: a.handoffWhen, maxTurns: a.maxTurns, tools: a.tools } },
      { id: "stopOk", kind: "stop", position: { x: 60, y: 360 }, data: {} },
      { id: "hand", kind: "handoff", position: { x: 470, y: 360 }, data: { queue: a.handoffQueue, priority: "alta", note: "Derivado por el Agente IA." } },
      { id: "stopH", kind: "stop", position: { x: 470, y: 540 }, data: {} },
    ],
    edges: [
      { id: "e0", source: "start", sourceHandle: "out", target: "ai" },
      { id: "e1", source: "ai", sourceHandle: "resolved", target: "stopOk" },
      { id: "e2", source: "ai", sourceHandle: "handoff", target: "hand" },
      { id: "e3", source: "hand", sourceHandle: "out", target: "stopH" },
    ],
  };
}

function botToAgent(bot: Bot): AgentCfg {
  const ai = bot.nodes.find((n) => n.kind === "ai_agent");
  const hand = bot.nodes.find((n) => n.kind === "handoff");
  const d = (ai?.data || {}) as Record<string, unknown>;
  const s = (k: string, dflt = "") => (typeof d[k] === "string" ? (d[k] as string) : dflt);
  return {
    botId: bot.botId, name: bot.name, status: (bot.status as AgentCfg["status"]) || "draft",
    model: s("model", MODELS[1]), objective: s("objective"), instructions: s("instructions"),
    knowledge: s("knowledge"), guardrails: s("guardrails"),
    handoffWhen: s("handoffWhen"), handoffQueue: typeof hand?.data?.queue === "string" ? (hand!.data!.queue as string) : "",
    channel: bot.trigger || CHANNELS[0], maxTurns: typeof d.maxTurns === "number" ? (d.maxTurns as number) : 8,
    tools: Array.isArray(d.tools) ? (d.tools as string[]) : [],
  };
}

interface AgentMeta { model: string; toolsCount: number; hasObjective: boolean; hasKnowledge: boolean; hasHandoff: boolean; }
interface AgentSummary { botId: string; name: string; status: string; trigger?: string; kind?: string; stepCount: number; updatedAt?: string; agentMeta?: AgentMeta; }

interface ConvAgg { agentBotId: string; agentName: string; total: number; resolved: number; handoff: number; ended: number; turns: number; toolUses: number; avgTurns: number }
interface ConvRecent { convId: string; agentBotId: string; agentName: string; source: string; outcome: string; turns: number; toolsUsed: string[]; lastUserText: string; createdAt: string }
interface ConvData { totals: { total: number; resolved: number; handoff: number }; byAgent: ConvAgg[]; recent: ConvRecent[] }
const OUTCOME_META: Record<string, { label: string; color: string; soft: string }> = {
  resolved: { label: "Resuelta", color: "var(--accent-green)", soft: "var(--accent-green-soft)" },
  handoff: { label: "Derivada", color: "var(--accent-amber)", soft: "var(--accent-amber-soft)" },
  ended: { label: "Terminada", color: "var(--text-3)", soft: "var(--bg-3)" },
};

function shortModel(m: string): string { return m.replace(" (Bedrock)", "").replace("Claude ", "").replace(" in Connect", " Q"); }
/** Readiness from real config: objective + at least one tool + a handoff target. */
function readiness(m?: AgentMeta): { done: number; total: number; ready: boolean } {
  if (!m) return { done: 0, total: 3, ready: false };
  const done = [m.hasObjective, m.toolsCount > 0, m.hasHandoff].filter(Boolean).length;
  return { done, total: 3, ready: done === 3 };
}

export function AgentePage() {
  const [list, setList] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<AgentCfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [convs, setConvs] = useState<ConvData | null>(null);
  const ep = getApiEndpoints();

  const loadConvs = async () => {
    if (!ep?.manageBot) return;
    try {
      const r = await fetch(`${ep.manageBot}?conversations=1`);
      const d = await r.json();
      setConvs(d.conversations || null);
    } catch { /* monitoring is best-effort */ }
  };

  const loadList = async () => {
    if (!ep?.manageBot) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await fetch(ep.manageBot);
      const d = await r.json();
      const all: AgentSummary[] = Array.isArray(d.bots) ? d.bots : [];
      setList(all.filter((b) => b.kind === "agent"));
      loadConvs();
    } catch { toast.error("No se pudieron cargar los agentes"); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openAgent = async (botId: string) => {
    if (!ep?.manageBot) return;
    try {
      const r = await fetch(`${ep.manageBot}?botId=${encodeURIComponent(botId)}`);
      const d = await r.json();
      if (d.bot) setCurrent(botToAgent(d.bot as Bot));
      else toast.error("No se pudo abrir el agente");
    } catch { toast.error("Error al abrir el agente"); }
  };

  const save = async (a: AgentCfg) => {
    if (!ep?.manageBot) return;
    setSaving(true);
    try {
      const bot = agentToBot(a);
      const r = await fetch(ep.manageBot, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId: bot.botId || undefined, name: bot.name, status: bot.status, trigger: bot.trigger, kind: "agent", nodes: bot.nodes, edges: bot.edges }),
      });
      const d = await r.json();
      if (!r.ok || !d.saved) throw new Error(d?.error || "fallo al guardar");
      toast.success("Agente guardado");
      setCurrent({ ...a, botId: d.bot.botId });
      loadList();
    } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo guardar"); }
    finally { setSaving(false); }
  };

  const remove = async (botId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!ep?.manageBot) return;
    if (!confirm("¿Eliminar este agente? No se puede deshacer.")) return;
    try {
      await fetch(`${ep.manageBot}?botId=${encodeURIComponent(botId)}`, { method: "DELETE" });
      toast.success("Agente eliminado");
      loadList();
    } catch { toast.error("No se pudo eliminar"); }
  };

  if (current) {
    return <AgentBuilder agent={current} saving={saving} onSave={save} onBack={() => { setCurrent(null); loadList(); }} />;
  }

  const kept = list.filter((b) => !q || (b.name || "").toLowerCase().includes(q.toLowerCase()));
  const active = list.filter((b) => b.status === "active").length;
  const convByAgent: Record<string, ConvAgg> = {};
  (convs?.byAgent || []).forEach((a) => { if (a.agentBotId) convByAgent[a.agentBotId] = a; });

  return (
    <div className="view" style={{ maxWidth: 1180 }}>
      <div className="view__head">
        <div>
          <div className="view__crumb"><span>Inteligencia artificial</span></div>
          <h1 className="view__title">Agentes IA</h1>
          <div className="view__sub">Empleados digitales que atienden, califican y resuelven — solos</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={loadList} disabled={loading}><Icon.Refresh size={14} /> Actualizar</button>
          <button className="btn btn--primary" onClick={() => setCurrent(blankAgent())}><Icon.Sparkles size={14} /> Nuevo agente</button>
        </div>
      </div>

      {loading ? (
        <div className="bots-grid">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skel" style={{ height: 176, borderRadius: 16 }} />)}</div>
      ) : list.length === 0 ? (
        <AgentHero onCreate={() => setCurrent(blankAgent())} />
      ) : (
        <>
          <div className="bots-kpis">
            <div className="bots-kpi"><span className="bots-kpi__n">{list.length}</span><span className="bots-kpi__l">Agentes</span></div>
            <div className="bots-kpi"><span className="bots-kpi__n" style={{ color: "var(--accent-green)" }}>{active}</span><span className="bots-kpi__l">Activos</span></div>
            <div className="bots-kpi"><span className="bots-kpi__n" style={{ color: "var(--accent-cyan)" }}>{convs?.totals.total ?? 0}</span><span className="bots-kpi__l">Conversaciones</span></div>
            <div className="bots-kpi"><span className="bots-kpi__n" style={{ color: "var(--accent-violet)" }}>{TOOLS.length}</span><span className="bots-kpi__l">Herramientas</span></div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <input placeholder="Buscar agente…" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ maxWidth: 280, width: "100%", padding: "8px 11px", fontSize: 13, border: "1px solid var(--border-1)", borderRadius: 8, background: "var(--bg-1)", color: "var(--text-1)" }} />
          </div>

          <div className="bots-grid">
            {kept.map((b) => {
              const cv = convByAgent[b.botId];
              return (
              <div key={b.botId} className="bot-card ag-card" onClick={() => openAgent(b.botId)} role="button" tabIndex={0}>
                <div className="bot-card__top">
                  <span className="bot-card__icon ag-card__icon"><Icon.Sparkles size={17} /></span>
                  <span className={`bot-card__status bot-card__status--${b.status}`}>
                    {b.status === "active" ? "Activo" : b.status === "paused" ? "Pausado" : "Borrador"}
                  </span>
                </div>
                <div className="bot-card__name">{b.name || "Agente sin nombre"}</div>
                <div className="bot-card__meta" style={{ marginTop: 10 }}>
                  <span className="bot-card__chip"><Icon.Globe size={12} /> {b.trigger || "WhatsApp"}</span>
                  {b.agentMeta?.model && <span className="bot-card__chip"><Icon.Sparkles size={12} /> {shortModel(b.agentMeta.model)}</span>}
                  {!!b.agentMeta?.toolsCount && <span className="bot-card__chip"><Icon.Tag size={12} /> {b.agentMeta.toolsCount} {b.agentMeta.toolsCount === 1 ? "herramienta" : "herramientas"}</span>}
                  {cv && cv.total > 0 && <span className="bot-card__chip" title="Conversaciones · % resueltas">💬 {cv.total} · {Math.round((cv.resolved / cv.total) * 100)}%</span>}
                </div>
                {(() => {
                  const r = readiness(b.agentMeta);
                  return (
                    <div className="ag-ready" title="Listo = objetivo + al menos una herramienta + derivación configurados">
                      <div className="ag-ready__bar"><span style={{ width: `${(r.done / r.total) * 100}%`, background: r.ready ? "var(--accent-green)" : "var(--accent-amber)" }} /></div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: r.ready ? "var(--accent-green)" : "var(--text-3)", whiteSpace: "nowrap" }}>{r.ready ? "Listo" : `${r.done}/${r.total}`}</span>
                    </div>
                  );
                })()}
                <div className="bot-card__foot">
                  <span>{b.updatedAt ? new Date(b.updatedAt).toLocaleDateString("es-PE", { day: "numeric", month: "short" }) : "—"}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button className="btn btn--ghost btn--sm" style={{ padding: "3px 10px", fontSize: 11.5, color: "var(--accent-violet)" }} onClick={(e) => { e.stopPropagation(); openAgent(b.botId); }} title="Probar este agente">
                      Probar
                    </button>
                    <button className="bot-card__del" onClick={(e) => remove(b.botId, e)} title="Eliminar agente"><Icon.Trash size={13} /></button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>

          {convs && convs.recent.length > 0 && (
            <div className="card" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-1)", fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 8 }}>
                <Icon.Sparkles size={15} style={{ color: "var(--accent-violet)" }} /> Conversaciones recientes
                <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>· {convs.totals.total} en total · {convs.totals.resolved} resueltas · {convs.totals.handoff} derivadas</span>
              </div>
              {convs.recent.slice(0, 12).map((c) => {
                const m = OUTCOME_META[c.outcome] || OUTCOME_META.ended;
                return (
                  <div key={c.convId} className="ag-conv">
                    <span className="ag-conv__badge" style={{ background: m.soft, color: m.color }}>{m.label}</span>
                    <span className="ag-conv__name">{c.agentName || "Agente"}</span>
                    <span className="ag-conv__txt">{c.lastUserText || "—"}</span>
                    {c.toolsUsed?.length > 0 && <span className="ag-conv__tools" title={c.toolsUsed.join(", ")}>🔧 {c.toolsUsed.length}</span>}
                    <span className="ag-conv__meta">{c.turns} turnos{c.source === "playground" ? " · prueba" : ""}</span>
                    <span className="ag-conv__when">{c.createdAt ? new Date(c.createdAt).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Empty-state hero ─────────────────────────────────────────────── */
function AgentHero({ onCreate }: { onCreate: () => void }) {
  const FEATURES = [
    { icon: Icon.Sparkles, title: "Atiende 24/7", body: "Responde al instante en WhatsApp y chat, de día o de madrugada." },
    { icon: Icon.Users, title: "Califica y actúa", body: "Hace las preguntas correctas y usa herramientas: agenda citas, crea leads, busca al cliente." },
    { icon: Icon.Phone, title: "Deriva a un humano", body: "Cuando hace falta una persona, pasa la conversación con todo el contexto." },
  ];
  return (
    <>
      <div className="ag-hero">
        <div className="ag-hero__badge"><Icon.Sparkles size={13} /> Agentes IA de ARIA</div>
        <h2 className="ag-hero__title">Creá un empleado digital que trabaja solo</h2>
        <p className="ag-hero__sub">Dale una persona y un objetivo, elegí el modelo (Claude Opus/Sonnet/Haiku, Amazon Q o Lex), conectá herramientas reales y dejalo conversar hasta resolver o derivar.</p>
        <button className="btn btn--primary" style={{ marginTop: 20 }} onClick={onCreate}><Icon.Sparkles size={14} /> Crear mi primer agente</button>
      </div>
      <div className="bots-grid" style={{ marginTop: 16 }}>
        {FEATURES.map((f) => {
          const Icn = f.icon;
          return (
            <div key={f.title} className="card" style={{ padding: 18 }}>
              <span className="ag-card__icon" style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center" }}><Icn size={18} /></span>
              <div style={{ fontWeight: 700, fontSize: 14.5, marginTop: 12 }}>{f.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55, marginTop: 5 }}>{f.body}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Builder: config (left) + live playground (right) ─────────────── */
function AgentBuilder({ agent, saving, onSave, onBack }: { agent: AgentCfg; saving: boolean; onSave: (a: AgentCfg) => void; onBack: () => void }) {
  const [a, setA] = useState<AgentCfg>(agent);
  const [playKey, setPlayKey] = useState(0);
  const set = (patch: Partial<AgentCfg>) => setA((s) => ({ ...s, ...patch }));
  const toggleTool = (key: string) => setA((s) => ({ ...s, tools: s.tools.includes(key) ? s.tools.filter((t) => t !== key) : [...s.tools, key] }));
  const playBot = useMemo(() => agentToBot(a), [a]);

  const inp: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid var(--border-1)", borderRadius: 8, background: "var(--bg-2)", color: "var(--text-1)", boxSizing: "border-box" };
  const lbl: React.CSSProperties = { fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700, display: "block", marginBottom: 5 };
  const area: React.CSSProperties = { ...inp, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      <div className="fb-bar">
        <button onClick={onBack} title="Volver a mis agentes" className="fb-bar__back">←</button>
        <span className="fb-bar__icon ag-bar__icon"><Icon.Sparkles size={16} /></span>
        <input value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Nombre del agente" className="fb-bar__name" />
        <div className={`fb-status fb-status--${a.status}`}>
          <span className="fb-status__dot" />
          <select value={a.status} onChange={(e) => set({ status: e.target.value as AgentCfg["status"] })}>
            <option value="draft">Borrador</option><option value="active">Activo</option><option value="paused">Pausado</option>
          </select>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn btn--sm" onClick={() => setPlayKey((k) => k + 1)} title="Reiniciar el playground con los cambios"><Icon.Refresh size={13} /> Probar cambios</button>
          <button className="btn btn--primary btn--sm" onClick={() => onSave(a)} disabled={saving}><Icon.Sparkles size={13} /> {saving ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>

      {/* Body */}
      <div className="ag-build">
        <div className="ag-build__form">
          <Section title="Identidad" desc="Quién es el agente y cómo se comporta.">
            <label><span style={lbl}>Modelo</span>
              <select style={inp} value={a.model} onChange={(e) => set({ model: e.target.value })}>{MODELS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
            </label>
            <label><span style={lbl}>Persona / instrucciones</span>
              <textarea style={area} rows={3} placeholder="Sos un asesor de admisión cordial y conciso. Respondé en español…" value={a.instructions} onChange={(e) => set({ instructions: e.target.value })} />
            </label>
            <label><span style={lbl}>Objetivo</span>
              <textarea style={area} rows={2} placeholder="Resolver dudas de admisión y agendar una cita si hay interés." value={a.objective} onChange={(e) => set({ objective: e.target.value })} />
            </label>
          </Section>

          <Section title="Conocimiento" desc="Datos que el agente puede usar para responder.">
            <textarea style={area} rows={4} placeholder="Pegá FAQs, precios, horarios, políticas… El agente los usará al responder." value={a.knowledge} onChange={(e) => set({ knowledge: e.target.value })} />
          </Section>

          <Section title="Herramientas" desc="Acciones reales que el agente puede ejecutar.">
            <div className="ag-tools">
              {TOOLS.map((t) => {
                const on = a.tools.includes(t.key);
                const Icn = t.icon;
                return (
                  <button key={t.key} className={`ag-tool ${on ? "ag-tool--on" : ""}`} onClick={() => toggleTool(t.key)}>
                    <span className="ag-tool__icon" style={{ background: on ? t.accent : "var(--bg-3)", color: on ? "#fff" : "var(--text-3)" }}><Icn size={15} /></span>
                    <span className="ag-tool__meta"><span className="ag-tool__label">{t.label}</span><span className="ag-tool__desc">{t.desc}</span></span>
                    <span className={`ag-tool__check ${on ? "ag-tool__check--on" : ""}`}>{on ? "✓" : ""}</span>
                  </button>
                );
              })}
            </div>
            <div className="ag-note">La ejecución de herramientas (function-calling real) se conecta en el siguiente paso; por ahora se guardan y el agente ya conversa con su persona, objetivo y conocimiento.</div>
          </Section>

          <Section title="Guardrails" desc="Qué NO debe hacer el agente.">
            <textarea style={area} rows={2} placeholder="No prometas descuentos. No inventes precios. No pidas datos de tarjeta." value={a.guardrails} onChange={(e) => set({ guardrails: e.target.value })} />
          </Section>

          <Section title="Canal y derivación" desc="Dónde atiende y cuándo pasa a un humano.">
            <label><span style={lbl}>Canal / disparador</span>
              <select style={inp} value={a.channel} onChange={(e) => set({ channel: e.target.value })}>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            </label>
            <label><span style={lbl}>Derivar a un humano cuando…</span>
              <input style={inp} placeholder="el cliente lo pida o se frustre" value={a.handoffWhen} onChange={(e) => set({ handoffWhen: e.target.value })} />
            </label>
            <div className="row" style={{ gap: 10 }}>
              <label style={{ flex: 1 }}><span style={lbl}>Cola al derivar</span>
                <input style={inp} placeholder="Admisión" value={a.handoffQueue} onChange={(e) => set({ handoffQueue: e.target.value })} />
              </label>
              <label style={{ width: 130 }}><span style={lbl}>Máx. turnos</span>
                <input style={inp} type="number" min={1} value={a.maxTurns} onChange={(e) => set({ maxTurns: Number(e.target.value) || 8 })} />
              </label>
            </div>
          </Section>
        </div>

        {/* Live playground */}
        <div className="ag-build__play">
          <BotTester key={playKey} bot={playBot} onClose={() => setPlayKey((k) => k + 1)} />
        </div>
      </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="ag-sec">
      <div className="ag-sec__h">{title}</div>
      <div className="ag-sec__d">{desc}</div>
      <div style={{ display: "grid", gap: 11 }}>{children}</div>
    </div>
  );
}
