import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Wrench, Check, Copy, Sparkles, BookText, ShieldAlert, Radio } from "lucide-react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import * as Icon from "@/components/vox/primitives";
import { BotTester } from "@/components/bots/BotTester";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Bot } from "@/lib/botFlow";
import { Icon as AIcon, Btn, Card, Stat, Pill, HeroBand, Num } from "@/components/aria";

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
// Paleta de identidad "IA" (fría: violeta / cyan / azul) — coherente en tarjetas y features,
// en vez de los colores rotativos heredados de Bots.
const AGENT_ACCENTS = ["var(--iris)", "var(--cyan)", "var(--accent)"];
const agentAccent = (i: number) => AGENT_ACCENTS[i % AGENT_ACCENTS.length];

interface ToolDef { key: string; label: string; desc: string; icon: React.ComponentType<{ size?: number }>; accent: string; req: string; }
const TOOLS: ToolDef[] = [
  { key: "book_appointment", label: "Agendar cita", desc: "Reserva una cita para el cliente", icon: Icon.Calendar, accent: "var(--accent-cyan)", req: "El agente pedirá teléfono y fecha/hora antes de agendar." },
  { key: "upsert_lead", label: "Crear / mover lead", desc: "Registra o avanza un lead en el embudo", icon: Icon.Users, accent: "var(--accent-green)", req: "Necesita al menos el teléfono del cliente." },
  { key: "lookup_customer", label: "Buscar cliente", desc: "Consulta perfil e historial del cliente", icon: Icon.Search, accent: "var(--accent-violet)", req: "Busca por número de teléfono." },
  { key: "send_whatsapp_template", label: "Enviar plantilla WhatsApp", desc: "Envía una plantilla aprobada al cliente", icon: Icon.WhatsApp, accent: "var(--accent-green)", req: "Solo plantillas aprobadas; en el playground se simula." },
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

/** Plantillas de arranque — prellenan persona, objetivo y herramientas. */
interface AgentTemplate { id: string; label: string; desc: string; icon: React.ComponentType<{ size?: number }>; cfg: Partial<AgentCfg>; }
const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "admision", label: "Asesor de admisión", desc: "Resuelve dudas de programas y agenda citas para postulantes.", icon: Icon.Sparkles,
    cfg: {
      name: "Asesor de admisión", model: MODELS[0],
      instructions: "Sos un asesor de admisión cordial y conciso. Respondé en español, claro y al grano. Tuteá al postulante.",
      objective: "Resolver dudas de admisión y agendar una cita con un asesor si hay interés.",
      tools: ["book_appointment", "upsert_lead"], handoffWhen: "el postulante pide una persona o su caso es complejo", handoffQueue: "Admisión",
    },
  },
  {
    id: "soporte", label: "Soporte / Mesa de ayuda", desc: "Atiende consultas, busca al cliente y deriva lo complejo.", icon: Wrench,
    cfg: {
      name: "Soporte técnico", model: MODELS[1],
      instructions: "Sos soporte técnico paciente. Pedí los datos concretos que necesitás y guiá paso a paso, sin tecnicismos.",
      objective: "Resolver la consulta del cliente o derivar al equipo cuando excede lo básico.",
      tools: ["lookup_customer"], handoffWhen: "el problema es técnico complejo o el cliente se frustra", handoffQueue: "Soporte",
    },
  },
  {
    id: "ventas", label: "Ventas / Calificación", desc: "Califica leads, responde precios y agenda demos.", icon: Icon.Users,
    cfg: {
      name: "Agente de ventas", model: MODELS[0],
      instructions: "Sos un vendedor consultivo. Entendé la necesidad del cliente con preguntas antes de recomendar. No presiones.",
      objective: "Calificar al lead (necesidad, presupuesto, plazo) y agendar una demo o pasarlo a ventas.",
      tools: ["upsert_lead", "book_appointment"], handoffWhen: "el lead está listo para comprar o pide un humano", handoffQueue: "Ventas",
    },
  },
  {
    id: "recepcion", label: "Recepción y citas", desc: "Saluda, identifica al cliente y reserva turnos.", icon: Icon.Calendar,
    cfg: {
      name: "Recepción", model: MODELS[1],
      instructions: "Sos la recepción del negocio, amable y eficiente. Saludá, identificá al cliente y ayudalo a reservar.",
      objective: "Agendar una cita o turno para el cliente.",
      tools: ["book_appointment", "lookup_customer"], handoffWhen: "el cliente pide algo distinto a agendar", handoffQueue: "Recepción",
    },
  },
];
function templateToAgent(t: AgentTemplate): AgentCfg { return { ...blankAgent(), ...t.cfg }; }

/** Bases de "persona" para rellenar las instrucciones de un clic. */
const PERSONAS: { label: string; text: string }[] = [
  { label: "Cordial y conciso", text: "Sos un asesor cordial y conciso. Respondé en español, claro y al grano. Tuteá al cliente." },
  { label: "Soporte paciente", text: "Sos soporte técnico paciente. Pedí los datos que necesitás y guiá paso a paso, sin tecnicismos innecesarios." },
  { label: "Vendedor consultivo", text: "Sos un vendedor consultivo. Entendé la necesidad antes de ofrecer; no presiones." },
  { label: "Recepción formal", text: "Sos la recepción de la empresa, con tono formal y amable. Tratá de «usted»." },
];
const MODEL_HINT: Record<string, string> = {
  "Claude Sonnet 4.6 (Bedrock)": "Equilibrado: buen razonamiento a costo medio. Recomendado para la mayoría.",
  "Claude Haiku 4.5 (Bedrock)": "El más rápido y económico. Ideal para FAQs y alto volumen.",
  "Claude Opus 4.8 (Bedrock)": "El más capaz para tareas complejas; más lento y caro.",
  "Amazon Q in Connect": "Responde con tu base de conocimiento de Amazon Q in Connect.",
};
/** Mensajes de prueba sugeridos según las herramientas activas del agente. */
function testPrompts(a: AgentCfg): string[] {
  const p = ["Hola, ¿en qué me pueden ayudar?"];
  if (a.tools.includes("book_appointment")) p.push("Quiero agendar una cita");
  if (a.tools.includes("upsert_lead")) p.push("Me interesa, ¿qué precios manejan?");
  if (a.tools.includes("lookup_customer")) p.push("¿Tienen registrado mi número?");
  p.push("Quiero hablar con una persona");
  return p.slice(0, 4);
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
interface ConvDetail { convId: string; agentName: string; outcome: string; turns: number; toolsUsed: string[]; source: string; createdAt: string; history: { role: string; text: string }[] }
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
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [convs, setConvs] = useState<ConvData | null>(null);
  const [convDetail, setConvDetail] = useState<ConvDetail | null>(null);
  const [convLoading, setConvLoading] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
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
    if (!(await confirm({ title: "¿Eliminar este agente?", description: "No se puede deshacer.", destructive: true, confirmLabel: "Eliminar" }))) return;
    try {
      await fetch(`${ep.manageBot}?botId=${encodeURIComponent(botId)}`, { method: "DELETE" });
      toast.success("Agente eliminado");
      loadList();
    } catch { toast.error("No se pudo eliminar"); }
  };

  const duplicate = async (botId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!ep?.manageBot) return;
    try {
      const r = await fetch(`${ep.manageBot}?botId=${encodeURIComponent(botId)}`);
      const d = await r.json();
      if (d.bot) {
        const cfg = botToAgent(d.bot as Bot);
        setCurrent({ ...cfg, botId: "", name: `${cfg.name} (copia)`, status: "draft" });
      } else toast.error("No se pudo duplicar");
    } catch { toast.error("No se pudo duplicar"); }
  };

  const openConv = async (convId: string) => {
    if (!ep?.manageBot) return;
    setConvLoading(true);
    setConvDetail(null);
    try {
      const r = await fetch(`${ep.manageBot}?conversation=${encodeURIComponent(convId)}`);
      const d = await r.json();
      if (d.conversation) setConvDetail(d.conversation as ConvDetail);
      else toast.error("No se encontró la conversación");
    } catch { toast.error("No se pudo abrir la conversación"); }
    finally { setConvLoading(false); }
  };

  if (current) {
    return <AgentBuilder agent={current} saving={saving} onSave={save} onBack={() => { setCurrent(null); loadList(); }} />;
  }
  if (picking) {
    return <AgentPicker onPick={(a) => { setPicking(false); setCurrent(a); }} onBack={() => setPicking(false)} />;
  }

  const kept = list.filter((b) => !q || (b.name || "").toLowerCase().includes(q.toLowerCase()));
  const active = list.filter((b) => b.status === "active").length;
  const convByAgent: Record<string, ConvAgg> = {};
  (convs?.byAgent || []).forEach((a) => { if (a.agentBotId) convByAgent[a.agentBotId] = a; });

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      {/* ARIA hero band — reemplaza el header plano por el lenguaje premium de
          ARIA, sin perder ninguna de las acciones reales (actualizar / crear). */}
      <HeroBand
        title="Agentes IA"
        chip={<>Empleados digitales que atienden, califican y resuelven — solos</>}
        chipIcon="sparkle"
        chipTone="var(--iris)"
        right={
          <div className="row gap10">
            <Btn variant="ghost" size="sm" icon="refresh" onClick={loadList} disabled={loading}>Actualizar</Btn>
            <Btn variant="primary" size="sm" icon="sparkle" onClick={() => setPicking(true)}>Nuevo agente</Btn>
          </div>
        }
      />

      {loading ? (
        <div className="bots-grid">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skel" style={{ height: 176, borderRadius: 16 }} />)}</div>
      ) : list.length === 0 ? (
        <AgentHero onCreate={() => setPicking(true)} />
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}>
            <Stat icon="bot" color="var(--iris)" label="Agentes" value={<Num value={list.length} />} sub="empleados digitales" />
            <Stat icon="check" color="var(--green)" label="Activos" value={<Num value={active} />} sub={active > 0 ? "en producción" : "ninguno activo"} />
            <Stat icon="chats" color="var(--cyan)" label="Conversaciones" value={<Num value={convs?.totals.total ?? 0} />} sub={`${convs?.totals.resolved ?? 0} resueltas`} />
            <Stat icon="tag" color="var(--accent)" label="Herramientas" value={<Num value={TOOLS.length} />} sub="acciones disponibles" />
          </div>

          <div style={{ marginBottom: 14, position: "relative", maxWidth: 300 }}>
            <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)", display: "grid", placeItems: "center" }}><AIcon name="search" size={15} /></span>
            <input placeholder="Buscar agente…" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ width: "100%", padding: "8px 11px 8px 33px", fontSize: 13, border: "1px solid var(--border-1)", borderRadius: 10, background: "var(--bg-1)", color: "var(--text-1)" }} />
          </div>

          <div className="bots-grid">
            {kept.map((b, i) => {
              const cv = convByAgent[b.botId];
              const accent = agentAccent(i);
              return (
              <div key={b.botId} className="card card__accent-bar bot-card ag-card" style={{ "--_c": accent, "--bot-accent": accent } as React.CSSProperties} onClick={() => openAgent(b.botId)} role="button" tabIndex={0}>
                <div className="bot-card__top">
                  <span className="bot-card__icon ag-card__icon" style={{ background: "color-mix(in srgb," + accent + " 15%,var(--bg-1))", color: accent }}><AIcon name="sparkle" size={17} /></span>
                  <Pill tone={b.status === "active" ? "green" : b.status === "paused" ? "gold" : "outline"} icon={b.status === "active" ? "dot" : undefined}>
                    {b.status === "active" ? "Activo" : b.status === "paused" ? "Pausado" : "Borrador"}
                  </Pill>
                </div>
                <div className="bot-card__name">{b.name || "Agente sin nombre"}</div>
                <div className="bot-card__meta" style={{ marginTop: 10 }}>
                  <span className="bot-card__chip"><AIcon name="globe" size={12} /> {b.trigger || "WhatsApp"}</span>
                  {b.agentMeta?.model && <span className="bot-card__chip"><AIcon name="sparkle" size={12} /> {shortModel(b.agentMeta.model)}</span>}
                  {!!b.agentMeta?.toolsCount && <span className="bot-card__chip"><AIcon name="tag" size={12} /> {b.agentMeta.toolsCount} {b.agentMeta.toolsCount === 1 ? "herramienta" : "herramientas"}</span>}
                  {cv && cv.total > 0 && <span className="bot-card__chip" title="Conversaciones · % resueltas"><MessageCircle size={12} /> {cv.total} · {Math.round((cv.resolved / cv.total) * 100)}%</span>}
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
                    <button className="btn btn--ghost btn--sm" style={{ padding: "3px 10px", fontSize: 11.5, color: "var(--iris)" }} onClick={(e) => { e.stopPropagation(); openAgent(b.botId); }} title="Probar este agente">
                      Probar
                    </button>
                    <button className="bot-card__del" onClick={(e) => duplicate(b.botId, e)} title="Duplicar agente"><Copy size={13} /></button>
                    <button className="bot-card__del" onClick={(e) => remove(b.botId, e)} title="Eliminar agente"><Icon.Trash size={13} /></button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>

          {convs && convs.recent.length > 0 && (
            <Card
              icon="chats"
              title={<>Conversaciones recientes <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>· {convs.totals.total} en total · {convs.totals.resolved} resueltas · {convs.totals.handoff} derivadas</span></>}
              pad={false}
              style={{ marginTop: 18, overflow: "hidden" }}
            >
              {convs.recent.slice(0, 12).map((c) => {
                const m = OUTCOME_META[c.outcome] || OUTCOME_META.ended;
                return (
                  <div key={c.convId} className="ag-conv" onClick={() => openConv(c.convId)} role="button" tabIndex={0} style={{ cursor: "pointer" }}>
                    <span className="ag-conv__badge" style={{ background: m.soft, color: m.color }}>{m.label}</span>
                    <span className="ag-conv__name">{c.agentName || "Agente"}</span>
                    <span className="ag-conv__txt">{c.lastUserText || "—"}</span>
                    {c.toolsUsed?.length > 0 && <span className="ag-conv__tools" title={c.toolsUsed.join(", ")}><Wrench size={12} /> {c.toolsUsed.length}</span>}
                    <span className="ag-conv__meta">{c.turns} turnos{c.source === "playground" ? " · prueba" : ""}</span>
                    <span className="ag-conv__when">{c.createdAt ? new Date(c.createdAt).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}

      {(convLoading || convDetail) && (
        <div className="ag-conv-modal" onClick={() => { if (!convLoading) setConvDetail(null); }}>
          <div className="ag-conv-modal__card" onClick={(e) => e.stopPropagation()}>
            <div className="ag-conv-modal__head">
              <span className="ag-conv-modal__ico"><AIcon name="sparkle" size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>{convDetail?.agentName || "Conversación"}</div>
                {convDetail && (
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {convDetail.turns} turnos{convDetail.source === "playground" ? " · prueba" : ""}
                  </div>
                )}
              </div>
              {convDetail &&
                (() => {
                  const m = OUTCOME_META[convDetail.outcome] || OUTCOME_META.ended;
                  return (
                    <span className="ag-conv-outcome" style={{ background: m.soft, color: m.color }}>
                      {m.label}
                    </span>
                  );
                })()}
              <button className="ag-conv-modal__close" onClick={() => setConvDetail(null)} title="Cerrar">×</button>
            </div>
            <div className="ag-conv-modal__body">
              {convLoading ? (
                <div className="muted" style={{ padding: 24, textAlign: "center" }}>Cargando…</div>
              ) : !convDetail ? null : convDetail.history.length === 0 ? (
                <div className="muted" style={{ padding: 24, textAlign: "center" }}>Sin transcript guardado (conversación previa a esta función).</div>
              ) : (
                convDetail.history.map((h, i) => (
                  <div key={i} className={`ag-msg ag-msg--${h.role === "user" ? "user" : "bot"}`}>{h.text}</div>
                ))
              )}
            </div>
            {convDetail && convDetail.toolsUsed?.length > 0 && (
              <div className="ag-conv-modal__foot">
                <span className="muted" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Wrench size={11} /> Herramientas
                </span>
                {convDetail.toolsUsed.map((t) => (
                  <span key={t} className="ag-tool-badge">
                    {TOOLS.find((x) => x.key === t)?.label || t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {confirmDialog}
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
        <div className="ag-hero__badge"><AIcon name="sparkle" size={13} /> Agentes IA de ARIA</div>
        <h2 className="ag-hero__title">Creá un empleado digital que trabaja solo</h2>
        <p className="ag-hero__sub">Dale una persona y un objetivo, elegí el modelo (Claude Opus/Sonnet/Haiku, Amazon Q o Lex), conectá herramientas reales y dejalo conversar hasta resolver o derivar.</p>
        <Btn variant="primary" icon="sparkle" style={{ marginTop: 20 }} onClick={onCreate}>Crear mi primer agente</Btn>
      </div>
      <div className="bots-grid" style={{ marginTop: 16 }}>
        {FEATURES.map((f, i) => {
          const Icn = f.icon;
          return (
            <div key={f.title} className="card" style={{ padding: 18, "--bot-accent": agentAccent(i) } as React.CSSProperties}>
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

/* ── Starter-template picker ──────────────────────────────────────── */
function AgentPicker({ onPick, onBack }: { onPick: (a: AgentCfg) => void; onBack: () => void }) {
  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <HeroBand
        title="Elegí un punto de partida"
        chip={<>Empezá con una plantilla lista (persona, objetivo y herramientas) o desde cero — todo es editable.</>}
        chipIcon="sparkle"
        chipTone="var(--iris)"
        right={<Btn variant="ghost" size="sm" icon="chevL" onClick={onBack}>Volver</Btn>}
      />
      <button className="ag-blank-card" onClick={() => onPick(blankAgent())}>
        <span className="ag-blank-card__icon"><AIcon name="plus" size={18} /></span>
        <div>
          <div className="ag-blank-card__h">Comenzar desde cero</div>
          <div className="ag-blank-card__d">Un agente vacío para configurar a tu gusto.</div>
        </div>
      </button>
      <div className="bots-grid" style={{ marginTop: 14 }}>
        {AGENT_TEMPLATES.map((t, i) => {
          const Icn = t.icon;
          const accent = agentAccent(i);
          return (
            <button
              key={t.id}
              className="card card__accent-bar bot-card ag-card"
              style={{ "--_c": accent, "--bot-accent": accent, textAlign: "left", cursor: "pointer" } as React.CSSProperties}
              onClick={() => onPick(templateToAgent(t))}
            >
              <div className="bot-card__top">
                <span className="bot-card__icon ag-card__icon" style={{ background: "color-mix(in srgb," + accent + " 15%,var(--bg-1))", color: accent }}><Icn size={17} /></span>
              </div>
              <div className="bot-card__name">{t.label}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5, marginTop: 6 }}>{t.desc}</div>
              <div className="bot-card__meta" style={{ marginTop: 11 }}>
                {(t.cfg.tools || []).map((tk) => {
                  const td = TOOLS.find((x) => x.key === tk);
                  return td ? <span key={tk} className="bot-card__chip"><AIcon name="tag" size={12} /> {td.label}</span> : null;
                })}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Builder: config (left) + live playground (right) ─────────────── */
function AgentBuilder({ agent, saving, onSave, onBack }: { agent: AgentCfg; saving: boolean; onSave: (a: AgentCfg) => void; onBack: () => void }) {
  const [a, setA] = useState<AgentCfg>(agent);
  const [playKey, setPlayKey] = useState(0);
  const set = (patch: Partial<AgentCfg>) => setA((s) => ({ ...s, ...patch }));
  const toggleTool = (key: string) => setA((s) => ({ ...s, tools: s.tools.includes(key) ? s.tools.filter((t) => t !== key) : [...s.tools, key] }));
  const playBot = useMemo(() => agentToBot(a), [a]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      <div className="fb-bar">
        <button onClick={onBack} title="Volver a mis agentes" className="fb-bar__back">←</button>
        <span className="fb-bar__icon ag-bar__icon"><AIcon name="sparkle" size={16} /></span>
        <input value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="Nombre del agente" className="fb-bar__name" />
        <div className={`fb-status fb-status--${a.status}`}>
          <span className="fb-status__dot" />
          <select value={a.status} onChange={(e) => set({ status: e.target.value as AgentCfg["status"] })}>
            <option value="draft">Borrador</option><option value="active">Activo</option><option value="paused">Pausado</option>
          </select>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Btn variant="ghost" size="sm" icon="refresh" onClick={() => setPlayKey((k) => k + 1)} title="Reiniciar el playground con los cambios">Probar cambios</Btn>
          <Btn variant="primary" size="sm" icon="sparkle" onClick={() => onSave(a)} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Btn>
        </div>
      </div>

      {/* Body */}
      <div className="ag-build">
        <div className="ag-build__form">
          <AgentReadiness a={a} />
          <Section kicker="Quién es" title="Identidad" desc="Quién es el agente y cómo se comporta." icon={Sparkles} accent="var(--iris)">
            <label><span className="ag-label">Modelo</span>
              <select className="ag-input" value={a.model} onChange={(e) => set({ model: e.target.value })}>{MODELS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
              {MODEL_HINT[a.model] && <div className="ag-hint">{MODEL_HINT[a.model]}</div>}
            </label>
            <label><span className="ag-label">Persona / instrucciones</span>
              <textarea className="ag-area" rows={3} placeholder="Sos un asesor de admisión cordial y conciso. Respondé en español…" value={a.instructions} onChange={(e) => set({ instructions: e.target.value })} />
              <div className="ag-personas">
                {PERSONAS.map((p) => (
                  <button key={p.label} type="button" className="ag-persona" onClick={() => set({ instructions: p.text })} title="Usar como base">{p.label}</button>
                ))}
              </div>
            </label>
            <label><span className="ag-label">Objetivo</span>
              <textarea className="ag-area" rows={2} placeholder="Resolver dudas de admisión y agendar una cita si hay interés." value={a.objective} onChange={(e) => set({ objective: e.target.value })} />
            </label>
          </Section>

          <Section kicker="Qué sabe" title="Conocimiento" desc="Datos que el agente puede usar para responder." icon={BookText} accent="var(--cyan)">
            <textarea className="ag-area" rows={4} placeholder="Pegá FAQs, precios, horarios, políticas… El agente los usará al responder." value={a.knowledge} onChange={(e) => set({ knowledge: e.target.value })} />
          </Section>

          <Section kicker="Qué puede hacer" title="Herramientas" desc="Acciones reales que el agente puede ejecutar." icon={Wrench} accent="var(--green)">
            <div className="ag-tools">
              {TOOLS.map((t) => {
                const on = a.tools.includes(t.key);
                const Icn = t.icon;
                return (
                  <button key={t.key} className={`ag-tool ${on ? "ag-tool--on" : ""}`} onClick={() => toggleTool(t.key)}>
                    <span className="ag-tool__icon" style={{ background: on ? t.accent : "var(--bg-3)", color: on ? "#fff" : "var(--text-3)" }}><Icn size={15} /></span>
                    <span className="ag-tool__meta"><span className="ag-tool__label">{t.label}</span><span className="ag-tool__desc">{t.desc}</span>{on && <span className="ag-tool__req">{t.req}</span>}</span>
                    <span className={`ag-tool__check ${on ? "ag-tool__check--on" : ""}`}>{on ? <Check size={13} /> : ""}</span>
                  </button>
                );
              })}
            </div>
            <div className="ag-note">El agente decide cuándo usar cada herramienta (function-calling de Claude). En el playground ya se ejecutan de verdad; en producción corren con tu cuenta.</div>
          </Section>

          <Section kicker="Qué no debe hacer" title="Guardrails" desc="Qué NO debe hacer el agente." icon={ShieldAlert} accent="var(--coral)">
            <textarea className="ag-area" rows={2} placeholder="No prometas descuentos. No inventes precios. No pidas datos de tarjeta." value={a.guardrails} onChange={(e) => set({ guardrails: e.target.value })} />
          </Section>

          <Section kicker="Dónde y cuándo" title="Canal y derivación" desc="Dónde atiende y cuándo pasa a un humano." icon={Radio} accent="var(--gold)">
            <label><span className="ag-label">Canal / disparador</span>
              <select className="ag-input" value={a.channel} onChange={(e) => set({ channel: e.target.value })}>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            </label>
            <label><span className="ag-label">Derivar a un humano cuando…</span>
              <input className="ag-input" placeholder="el cliente lo pida o se frustre" value={a.handoffWhen} onChange={(e) => set({ handoffWhen: e.target.value })} />
            </label>
            <div className="row" style={{ gap: 10 }}>
              <label style={{ flex: 1 }}><span className="ag-label">Cola al derivar</span>
                <input className="ag-input" placeholder="Admisión" value={a.handoffQueue} onChange={(e) => set({ handoffQueue: e.target.value })} />
              </label>
              <label style={{ width: 160 }}><span className="ag-label">Máx. turnos · {a.maxTurns}</span>
                <input type="range" min={1} max={12} value={a.maxTurns} onChange={(e) => set({ maxTurns: Number(e.target.value) })} style={{ width: "100%", accentColor: "var(--iris)", marginTop: 7 }} />
              </label>
            </div>
          </Section>
        </div>

        {/* Live playground */}
        <div className="ag-build__play">
          <BotTester key={playKey} bot={playBot} suggestions={testPrompts(a)} onClose={() => setPlayKey((k) => k + 1)} />
        </div>
      </div>
    </div>
  );
}

function Section({
  kicker,
  title,
  desc,
  icon: Icn,
  accent,
  children,
}: {
  kicker: string;
  title: string;
  desc: string;
  icon: React.ComponentType<{ size?: number }>;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ag-sec" style={{ "--_c": accent } as React.CSSProperties}>
      <div className="ag-sec__head">
        <span className="ag-sec__icon">
          <Icn size={15} />
        </span>
        <div>
          <div className="ag-sec__kicker">{kicker}</div>
          <div className="ag-sec__h">{title}</div>
        </div>
      </div>
      <div className="ag-sec__d">{desc}</div>
      <div style={{ display: "grid", gap: 11 }}>{children}</div>
    </div>
  );
}

/** Checklist en vivo: qué le falta al agente para estar "listo". */
function AgentReadiness({ a }: { a: AgentCfg }) {
  const items = [
    { ok: !!a.objective.trim(), label: "Definí un objetivo claro" },
    { ok: a.tools.length > 0, label: "Activá al menos una herramienta" },
    { ok: !!a.handoffQueue.trim(), label: "Configurá la cola de derivación" },
  ];
  const done = items.filter((i) => i.ok).length;
  const ready = done === items.length;
  return (
    <div className={`ag-check ${ready ? "ag-check--ready" : ""}`}>
      <div className="ag-check__head">
        {ready ? <><Check size={14} /> Agente listo para publicar</> : <>Para dejarlo listo · {done}/{items.length}</>}
      </div>
      <div className="ag-check__items">
        {items.map((it) => (
          <div key={it.label} className={`ag-check__item ${it.ok ? "is-on" : ""}`}>
            <span className="ag-check__dot">{it.ok ? <Check size={11} /> : ""}</span>
            {it.label}
          </div>
        ))}
      </div>
    </div>
  );
}
