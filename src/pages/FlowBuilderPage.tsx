import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { FlowBuilder } from "@/components/bots/FlowBuilder";
import { BotTemplateGallery } from "@/components/bots/BotTemplateGallery";
import { WaRouting } from "@/components/bots/WaRouting";
import { type Bot } from "@/lib/botFlow";
import { FLOW_ICONS } from "@/components/bots/icons";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Icon, Btn, Stat, Pill, HeroBand, Num } from "@/components/aria";
import {
  FeatureCompare,
  FeatureCompareButton,
  FeatureTagline,
} from "@/components/aria/FeatureCompare";

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

// Estado → tono del Pill de ARIA (verde=activo, gold=pausado, outline=borrador).
const STATUS_TONE: Record<string, "green" | "gold" | "outline"> = {
  active: "green",
  paused: "gold",
  draft: "outline",
};

// Acento por bot — variedad visual (como los colores por etapa del embudo de
// Leads) en vez de todo violeta. Cicla por índice.
const BOT_ACCENTS = [
  "#9B8CF0",
  "#6366F1",
  "#38BDF8",
  "#06B6D4",
  "#14B8A6",
  "#10B981",
  "#A855F7",
  "#EC4899",
];
export function botColor(i: number): string {
  return BOT_ACCENTS[i % BOT_ACCENTS.length];
}

export function FlowBuilderPage() {
  const [list, setList] = useState<BotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<Bot | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "draft" | "paused">("all");
  const [picking, setPicking] = useState(false);
  const [autoTest, setAutoTest] = useState(false);
  const [routing, setRouting] = useState(false);

  const ep = getApiEndpoints();
  const { confirm, confirmDialog } = useConfirm();

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
      setList(
        Array.isArray(d.bots)
          ? d.bots.filter((b: BotSummary & { kind?: string }) => b.kind !== "agent")
          : [],
      );
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
    if (
      !(await confirm({
        title: "¿Eliminar este bot?",
        description: "No se puede deshacer.",
        destructive: true,
        confirmLabel: "Eliminar",
      }))
    )
      return;
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

  // ── Ruteo de WhatsApp (número → flujo) ──
  if (routing) {
    return <WaRouting onBack={() => setRouting(false)} />;
  }

  // ── Template picker (premium Kommo-style gallery) ──
  if (picking) {
    return (
      <BotTemplateGallery
        onBack={() => setPicking(false)}
        onPick={(bot) => {
          setPicking(false);
          setCurrent(bot);
        }}
      />
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
      (statusFilter === "all" || b.status === statusFilter),
  );
  const FILTERS: { key: typeof statusFilter; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "active", label: "Activos" },
    { key: "draft", label: "Borradores" },
    { key: "paused", label: "Pausados" },
  ];

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      {/* ARIA hero band — reemplaza el PageHeader por el lenguaje premium de
          ARIA. El CRUD real (manage-bot) queda intacto debajo. */}
      <HeroBand
        title="Bots"
        chip={
          <>
            {list.length} {list.length === 1 ? "bot" : "bots"} · {counts.active} activos
          </>
        }
        chipIcon="bot"
        chipTone="var(--accent)"
        right={
          <div className="row gap10">
            <FeatureTagline feature="bots" />
            <FeatureCompareButton current="bots" />
            <Btn variant="ghost" size="sm" icon="flow" onClick={() => setRouting(true)}>
              Ruteo WhatsApp
            </Btn>
            <Btn variant="ghost" size="sm" icon="refresh" onClick={loadList} disabled={loading}>
              Actualizar
            </Btn>
            <Btn variant="primary" size="sm" icon="plus" onClick={() => setPicking(true)}>
              Nuevo bot
            </Btn>
          </div>
        }
      />

      <div
        className="dim"
        style={{ fontSize: 13, marginTop: -8, marginBottom: 18, maxWidth: 760, lineHeight: 1.55 }}
      >
        Conversación con un guion: un árbol de botones y respuestas fijas que lleva al cliente por
        un menú, paso a paso — predecible y sin sorpresas.
      </div>

      {loading ? (
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skel" style={{ height: 168, borderRadius: 14 }} />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="col" style={{ gap: 16 }}>
          <div
            className="card"
            style={{ padding: 56, textAlign: "center", color: "var(--text-3)" }}
          >
            <Icon name="bot" size={34} style={{ opacity: 0.4 }} />
            <div style={{ marginTop: 12, fontSize: 14.5, fontWeight: 600, color: "var(--text-2)" }}>
              Todavía no hay bots
            </div>
            <div style={{ marginTop: 4, fontSize: 12.5, maxWidth: 460, marginInline: "auto" }}>
              Conversa con un guion: un árbol de botones y respuestas fijas que lleva al cliente por
              un menú, paso a paso. Ideal para menús predecibles. (¿Quieres que una IA entienda
              lenguaje libre? Usa Agente IA.)
            </div>
            <Btn
              variant="primary"
              icon="plus"
              style={{ marginTop: 16 }}
              onClick={() => setPicking(true)}
            >
              Crear el primero
            </Btn>
          </div>
          <div className="card" style={{ padding: 18 }}>
            <FeatureCompare current="bots" />
          </div>
        </div>
      ) : (
        <>
          {/* KPIs — familia ARIA (Stat + count-up). */}
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
              marginBottom: 20,
            }}
          >
            <Stat
              icon="bot"
              color="var(--accent)"
              label="Bots"
              value={<Num value={counts.all} />}
              sub="flujos creados"
            />
            <Stat
              icon="check"
              color="var(--green)"
              label="Activos"
              value={<Num value={counts.active} />}
              sub={`${counts.draft} borradores`}
            />
            <Stat
              icon="grip"
              color="var(--iris)"
              label="Borradores"
              value={<Num value={counts.draft} />}
              sub="sin publicar"
            />
            <Stat
              icon="flow"
              color="var(--gold)"
              label="Pasos totales"
              value={<Num value={totalSteps} />}
              sub="en todos los bots"
            />
          </div>

          {/* Filtros de estado — pills estilo ARIA. */}
          <div
            className="row gap8"
            role="tablist"
            aria-label="Estado"
            style={{ marginBottom: 16, flexWrap: "wrap" }}
          >
            {FILTERS.map((f) => {
              const active = statusFilter === f.key;
              return (
                <button
                  key={f.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStatusFilter(f.key)}
                  className="card"
                  style={{
                    padding: "8px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    border: active ? "1.5px solid var(--accent)" : "1px solid var(--border-1)",
                    background: active ? "var(--accent-soft)" : "var(--bg-1)",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 13,
                      color: active ? "var(--accent)" : "var(--text-1)",
                    }}
                  >
                    {f.label}
                  </span>
                  <span
                    className="tnum"
                    style={{ fontSize: 12, color: active ? "var(--accent)" : "var(--text-3)" }}
                  >
                    {counts[f.key]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Buscador — pill estilo ARIA. */}
          <div className="row gap8" style={{ marginBottom: 16 }}>
            <div
              className="card"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                flex: 1,
                maxWidth: 360,
              }}
            >
              <Icon name="search" size={15} style={{ color: "var(--text-3)" }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar bot…"
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--text-1)",
                  fontSize: 13,
                  outline: "none",
                  flex: 1,
                }}
              />
            </div>
          </div>

          {/* Card grid — familia ARIA (card + card__accent-bar + Pill). */}
          {kept.length === 0 ? (
            <div
              className="card"
              style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}
            >
              Ningún bot coincide con el filtro.
            </div>
          ) : (
            <div
              className="grid"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}
            >
              {kept.map((b, i) => {
                const accent = botColor(i);
                return (
                  <div
                    key={b.botId}
                    className="card card__accent-bar"
                    style={
                      {
                        "--_c": accent,
                        padding: "16px 18px",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      } as React.CSSProperties
                    }
                    onClick={() => openBot(b.botId)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="row between">
                      <span
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 11,
                          display: "grid",
                          placeItems: "center",
                          flex: "0 0 auto",
                          background: `color-mix(in srgb, ${accent} 15%, var(--bg-1))`,
                          color: accent,
                        }}
                      >
                        <CardIcon size={19} />
                      </span>
                      <Pill
                        tone={STATUS_TONE[b.status]}
                        icon={b.status === "active" ? "dot" : undefined}
                      >
                        {STATUS_LABEL[b.status] || b.status}
                      </Pill>
                    </div>

                    <div
                      style={{
                        fontWeight: 750,
                        fontSize: 15,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {b.name || "Sin nombre"}
                    </div>

                    {/* Riel de pasos — indicador visual del tamaño del flujo. */}
                    <div className="row gap6" aria-hidden style={{ alignItems: "center" }}>
                      {Array.from({ length: Math.max(1, Math.min(b.stepCount || 1, 7)) }).map(
                        (_, j) => (
                          <span
                            key={j}
                            style={{
                              width: 18,
                              height: 4,
                              borderRadius: 3,
                              background: `color-mix(in srgb, ${accent} 55%, var(--border-1))`,
                            }}
                          />
                        ),
                      )}
                    </div>

                    <div className="row gap6 wrap" style={{ alignItems: "center" }}>
                      <Pill tone="outline" icon="flow">
                        {b.trigger || "Manual"}
                      </Pill>
                      <Pill tone="outline">
                        {b.stepCount} {b.stepCount === 1 ? "paso" : "pasos"}
                      </Pill>
                    </div>

                    <div
                      className="row between"
                      style={{
                        alignItems: "center",
                        marginTop: "auto",
                        fontSize: 11.5,
                        color: "var(--text-3)",
                      }}
                    >
                      <span className="tnum">
                        {b.updatedAt
                          ? new Date(b.updatedAt).toLocaleDateString("es-PE", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </span>
                      <div className="row gap6" style={{ alignItems: "center" }}>
                        <Btn
                          variant="ghost"
                          size="sm"
                          icon="eye"
                          onClick={(e) => {
                            e.stopPropagation();
                            openBot(b.botId, true);
                          }}
                          title="Probar este flujo"
                        >
                          Probar
                        </Btn>
                        <Btn
                          variant="ghost"
                          size="sm"
                          onClick={(e) => remove(b.botId, e)}
                          title="Eliminar bot"
                          aria-label="Eliminar bot"
                        >
                          <Trash2 size={13} />
                        </Btn>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      {confirmDialog}
    </div>
  );
}
