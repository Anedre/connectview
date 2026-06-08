import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getApiEndpoints } from "@/lib/api";
import { FlowBuilder } from "@/components/bots/FlowBuilder";
import { type Bot, BOT_TEMPLATES } from "@/lib/botFlow";
import * as Icon from "@/components/vox/primitives";
import { PageHeader } from "@/components/vox/PageHeader";
import { FLOW_ICONS } from "@/components/bots/icons";

/**
 * FlowBuilderPage — the real /bot page (roadmap #16). Lists saved bots from
 * connectview-bots (via manage-bot), and opens the visual FlowBuilder to
 * create/edit one. Persists on Guardar; the demo lives separately at
 * /bot-demo (auth-free).
 */
interface BotSummary {
  botId: string;
  name: string;
  status: string;
  trigger?: string;
  stepCount: number;
  updatedAt?: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  active: "Activo",
  paused: "Pausado",
};

export function FlowBuilderPage() {
  const [list, setList] = useState<BotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<Bot | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "draft" | "paused">("all");
  const [picking, setPicking] = useState(false);
  const [autoTest, setAutoTest] = useState(false);

  const ep = getApiEndpoints();

  const loadList = async () => {
    if (!ep?.manageBot) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(ep.manageBot);
      const d = await r.json();
      // Agents live in their own hub (/agente); keep this list to visual bots.
      setList(Array.isArray(d.bots) ? d.bots.filter((b: BotSummary & { kind?: string }) => b.kind !== "agent") : []);
    } catch {
      toast.error("No se pudieron cargar los bots");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openBot = async (botId: string, test = false) => {
    if (!ep?.manageBot) return;
    setAutoTest(test);
    try {
      const r = await fetch(`${ep.manageBot}?botId=${encodeURIComponent(botId)}`);
      const d = await r.json();
      if (d.bot) setCurrent(d.bot as Bot);
      else toast.error("No se pudo abrir el bot");
    } catch {
      toast.error("Error al abrir el bot");
    }
  };

  const save = async (bot: Bot) => {
    if (!ep?.manageBot) return;
    setSaving(true);
    try {
      const r = await fetch(ep.manageBot, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botId: bot.botId || undefined,
          name: bot.name,
          status: bot.status,
          trigger: bot.trigger,
          nodes: bot.nodes,
          edges: bot.edges,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.saved) throw new Error(d?.error || "fallo al guardar");
      toast.success("Bot guardado");
      setCurrent({ ...bot, botId: d.bot.botId });
      loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (botId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!ep?.manageBot) return;
    if (!confirm("¿Eliminar este bot? No se puede deshacer.")) return;
    try {
      await fetch(`${ep.manageBot}?botId=${encodeURIComponent(botId)}`, { method: "DELETE" });
      toast.success("Bot eliminado");
      loadList();
    } catch {
      toast.error("No se pudo eliminar");
    }
  };

  // ── Builder view ──
  if (current) {
    return (
      <div style={{ height: "100%", minHeight: 0 }}>
        <FlowBuilder
          initial={current}
          onSave={save}
          saving={saving}
          autoTest={autoTest}
          onBack={() => {
            setCurrent(null);
            setAutoTest(false);
            loadList();
          }}
        />
      </div>
    );
  }

  // ── Template picker ──
  if (picking) {
    return (
      <div className="view" style={{ maxWidth: 1100 }}>
        <PageHeader
          crumb="Automatización · Nuevo bot"
          title="Elegí un punto de partida"
          sub="Empezá con una plantilla lista o desde cero — todo es editable después."
          actions={
            <button className="btn" onClick={() => setPicking(false)}>
              ← Volver
            </button>
          }
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
          }}
        >
          {BOT_TEMPLATES.map((t) => {
            const Icn = FLOW_ICONS[t.icon] || FLOW_ICONS.message;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setPicking(false);
                  setCurrent(t.build());
                }}
                className="card"
                style={{
                  textAlign: "left",
                  padding: 18,
                  cursor: "pointer",
                  border: "1px solid var(--border-1)",
                  background: `linear-gradient(160deg, ${t.accent}10, var(--bg-1) 60%)`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  transition: "border-color .15s, transform .15s",
                }}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 40,
                    height: 40,
                    borderRadius: 11,
                    background: `linear-gradient(150deg, ${t.accent}, ${t.accent}b0)`,
                    color: "#fff",
                    boxShadow: `0 4px 12px ${t.accent}55`,
                  }}
                >
                  <Icn size={20} />
                </span>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{t.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
                  {t.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── List view ──
  const CardIcon = FLOW_ICONS.bot;
  const counts = {
    all: list.length,
    active: list.filter((b) => b.status === "active").length,
    draft: list.filter((b) => b.status === "draft").length,
    paused: list.filter((b) => b.status === "paused").length,
  };
  const totalSteps = list.reduce((s, b) => s + (b.stepCount || 0), 0);
  const kept = list.filter(
    (b) =>
      (!q || (b.name || "").toLowerCase().includes(q.toLowerCase())) &&
      (statusFilter === "all" || b.status === statusFilter)
  );
  const FILTERS: { key: typeof statusFilter; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "active", label: "Activos" },
    { key: "draft", label: "Borradores" },
    { key: "paused", label: "Pausados" },
  ];

  return (
    <div className="view" style={{ maxWidth: 1180 }}>
      <PageHeader
        crumb="Automatización"
        title="Bots"
        count={`${list.length} ${list.length === 1 ? "bot" : "bots"}`}
        sub="Flujos conversacionales sin código — chat, calificación de leads y derivación a un agente."
        search={{ value: q, onChange: setQ, placeholder: "Buscar bot…" }}
        actions={
          <>
            <button className="btn" onClick={loadList} disabled={loading}>
              <Icon.Refresh size={14} /> Actualizar
            </button>
            <button className="btn btn--primary" onClick={() => setPicking(true)}>
              <Icon.Plus size={14} /> Nuevo bot
            </button>
          </>
        }
      />

      {loading ? (
        <div className="bots-grid">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skel" style={{ height: 168, borderRadius: 14 }} />)}
        </div>
      ) : list.length === 0 ? (
        <div className="card" style={{ padding: 56, textAlign: "center", color: "var(--text-3)" }}>
          <Icon.Workflow size={34} style={{ opacity: 0.4 }} />
          <div style={{ marginTop: 12, fontSize: 14.5, fontWeight: 600, color: "var(--text-2)" }}>
            Todavía no hay bots
          </div>
          <div style={{ marginTop: 4, fontSize: 12.5 }}>
            Construí flujos sin código para automatizar chats, calificar leads y derivar a un agente.
          </div>
          <button className="btn btn--primary" style={{ marginTop: 16 }} onClick={() => setPicking(true)}>
            <Icon.Plus size={14} /> Crear el primero
          </button>
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="bots-kpis">
            <div className="bots-kpi"><span className="bots-kpi__n">{counts.all}</span><span className="bots-kpi__l">Bots</span></div>
            <div className="bots-kpi"><span className="bots-kpi__n" style={{ color: "var(--accent-green)" }}>{counts.active}</span><span className="bots-kpi__l">Activos</span></div>
            <div className="bots-kpi"><span className="bots-kpi__n" style={{ color: "var(--text-2)" }}>{counts.draft}</span><span className="bots-kpi__l">Borradores</span></div>
            <div className="bots-kpi"><span className="bots-kpi__n" style={{ color: "var(--accent-violet)" }}>{totalSteps}</span><span className="bots-kpi__l">Pasos totales</span></div>
          </div>

          {/* Status filters */}
          <div className="bots-filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`bots-filter ${statusFilter === f.key ? "bots-filter--on" : ""}`}
                onClick={() => setStatusFilter(f.key)}
              >
                {f.label}<span className="bots-filter__n">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          {/* Card grid */}
          {kept.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
              Ningún bot coincide con el filtro.
            </div>
          ) : (
            <div className="bots-grid">
              {kept.map((b) => (
                <div key={b.botId} className="bot-card" onClick={() => openBot(b.botId)} role="button" tabIndex={0}>
                  <div className="bot-card__top">
                    <span className="bot-card__icon"><CardIcon size={17} /></span>
                    <span className={`bot-card__status bot-card__status--${b.status}`}>
                      {STATUS_LABEL[b.status] || b.status}
                    </span>
                  </div>
                  <div className="bot-card__name">{b.name || "Sin nombre"}</div>
                  <div className="bot-card__rail" aria-hidden>
                    {Array.from({ length: Math.max(1, Math.min(b.stepCount || 1, 7)) }).map((_, i) => (
                      <span key={i} className="bot-card__dot" />
                    ))}
                  </div>
                  <div className="bot-card__meta">
                    <span className="bot-card__chip"><Icon.Workflow size={12} /> {b.trigger || "Manual"}</span>
                    <span className="bot-card__chip">{b.stepCount} {b.stepCount === 1 ? "paso" : "pasos"}</span>
                  </div>
                  <div className="bot-card__foot">
                    <span>{b.updatedAt ? new Date(b.updatedAt).toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button className="btn btn--ghost btn--sm" style={{ padding: "3px 10px", fontSize: 11.5, color: "var(--accent-cyan)" }} onClick={(e) => { e.stopPropagation(); openBot(b.botId, true); }} title="Probar este flujo">
                        Probar
                      </button>
                      <button className="bot-card__del" onClick={(e) => remove(b.botId, e)} title="Eliminar bot">
                        <Icon.Trash size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
