import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useJourneys, type Journey, type JourneyNodeKind } from "@/hooks/useJourneys";
import { JourneyBuilder } from "@/components/journeys/JourneyBuilder";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Icon, Btn, Card, Stat, Pill, HeroBand, Num } from "@/components/aria";
import type { IconName } from "@/components/aria";
import { FeatureCompare, FeatureCompareButton } from "@/components/aria/FeatureCompare";

/**
 * JourneysPage — el /journeys (Fase 3 · 3B), re-skinneado al sistema ARIA:
 * HeroBand premium, KPIs con Stat + count-up, journeys como Cards con el rail de
 * pasos encadenados (icono + chevron) del lenguaje visual de ARIA. Toda la
 * lógica real queda intacta: lista los recorridos del tenant (motor de Journeys
 * / Engagement Studio) y abre el JourneyBuilder visual para crear/editar uno.
 * Persiste con manage-leads (saveJourney, folded); el avance paso-a-paso lo
 * corre el journey-runner por tick.
 */
const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  active: "Activo",
  paused: "Pausado",
};
/** Estado → tono de Pill de ARIA. */
const STATUS_TONE: Record<string, "green" | "gold" | "outline"> = {
  active: "green",
  paused: "gold",
  draft: "outline",
};
const ACCENTS = [
  "var(--green)",
  "var(--cyan)",
  "var(--accent)",
  "var(--iris)",
  "var(--gold)",
  "var(--coral)",
];
/** Cada tipo de nodo → icono + etiqueta corta para el rail de pasos ARIA. */
const NODE_META: Record<JourneyNodeKind, { icon: IconName; label: string }> = {
  entry: { icon: "userplus", label: "Entrada" },
  send: { icon: "send", label: "Enviar" },
  wait: { icon: "clock", label: "Espera" },
  branch: { icon: "filter", label: "Ramifica" },
  split: { icon: "sliders", label: "A/B" },
  action: { icon: "zap", label: "Acción" },
  exit: { icon: "target", label: "Fin" },
};
const rid = () => Math.random().toString(36).slice(2, 9);
type N = Journey["nodes"][number];
type E = Journey["edges"][number];

/** Arma un Journey borrador (journeyId lo asigna el backend al guardar). */
function mk(name: string, nodes: N[], edges: E[]): Journey {
  return {
    journeyId: "",
    name,
    status: "draft",
    entry: { manual: true },
    reenroll: false,
    nodes,
    edges,
  };
}

/**
 * Plantillas semilla (Fase 3 · 3C-D) — el no-técnico arranca de un patrón probado
 * en vez del lienzo en blanco. Cada `build()` genera ids frescos.
 */
interface JourneyTemplate {
  key: string;
  name: string;
  desc: string;
  accent: string;
  build: () => Journey;
}
const TEMPLATES: JourneyTemplate[] = [
  {
    key: "blank",
    name: "En blanco",
    desc: "Entrada → Fin. Armá el recorrido desde cero, paso por paso.",
    accent: "var(--text-3)",
    build: () => {
      const e = rid(),
        x = rid();
      return mk(
        "Nuevo journey",
        [
          { id: e, kind: "entry" },
          { id: x, kind: "exit" },
        ],
        [{ from: e, to: x }],
      );
    },
  },
  {
    key: "welcome",
    name: "Bienvenida",
    desc: "Saludo por WhatsApp al entrar, espera 1 día y refuerza por email.",
    accent: "var(--accent)",
    build: () => {
      const e = rid(),
        s1 = rid(),
        w = rid(),
        s2 = rid(),
        x = rid();
      return mk(
        "Bienvenida",
        [
          { id: e, kind: "entry" },
          { id: s1, kind: "send", params: { channel: "whatsapp", templateName: "" } },
          { id: w, kind: "wait", params: { days: 1 } },
          {
            id: s2,
            kind: "send",
            params: { channel: "email", subject: "¿Seguimos conversando?", body: "" },
          },
          { id: x, kind: "exit" },
        ],
        [
          { from: e, to: s1 },
          { from: s1, to: w },
          { from: w, to: s2 },
          { from: s2, to: x },
        ],
      );
    },
  },
  {
    key: "nurture",
    name: "Nutrición (drip)",
    desc: "Tres toques espaciados (WhatsApp → email → WhatsApp) para madurar el interés.",
    accent: "var(--green)",
    build: () => {
      const e = rid(),
        s1 = rid(),
        w1 = rid(),
        s2 = rid(),
        w2 = rid(),
        s3 = rid(),
        x = rid();
      return mk(
        "Nutrición",
        [
          { id: e, kind: "entry" },
          { id: s1, kind: "send", params: { channel: "whatsapp", templateName: "" } },
          { id: w1, kind: "wait", params: { days: 3 } },
          {
            id: s2,
            kind: "send",
            params: { channel: "email", subject: "Más información", body: "" },
          },
          { id: w2, kind: "wait", params: { days: 4 } },
          { id: s3, kind: "send", params: { channel: "whatsapp", templateName: "" } },
          { id: x, kind: "exit" },
        ],
        [
          { from: e, to: s1 },
          { from: s1, to: w1 },
          { from: w1, to: s2 },
          { from: s2, to: w2 },
          { from: w2, to: s3 },
          { from: s3, to: x },
        ],
      );
    },
  },
  {
    key: "reengage",
    name: "Reactivación por score",
    desc: "Ramifica por score: a los calientes (≥50) les manda; al resto los deja salir.",
    accent: "var(--iris)",
    build: () => {
      const e = rid(),
        b = rid(),
        s = rid(),
        x = rid();
      return mk(
        "Reactivación por score",
        [
          { id: e, kind: "entry" },
          {
            id: b,
            kind: "branch",
            params: { rules: [{ field: "score", op: "gte", value: "50" }], match: "all" },
          },
          { id: s, kind: "send", params: { channel: "whatsapp", templateName: "" } },
          { id: x, kind: "exit" },
        ],
        [
          { from: e, to: b },
          { from: b, to: s, on: "yes" },
          { from: b, to: x, on: "no" },
          { from: s, to: x },
        ],
      );
    },
  },
];

export function JourneysPage() {
  const { journeys, loading, reload, save, remove } = useJourneys();
  const [current, setCurrent] = useState<Journey | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "draft" | "paused">("all");
  const { confirm, confirmDialog } = useConfirm();

  const persist = async (j: Journey) => {
    setSaving(true);
    try {
      const saved = await save(j);
      if (!saved) throw new Error("fallo al guardar");
      toast.success("Journey guardado");
      setCurrent(saved);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (j: Journey, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = j.status === "active" ? "paused" : "active";
    try {
      await save({ ...j, status: next });
      toast.success(next === "active" ? "Journey activado" : "Journey pausado");
    } catch {
      toast.error("No se pudo cambiar el estado");
    }
  };

  const del = async (j: Journey, e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !(await confirm({
        title: "¿Eliminar este journey?",
        description: "No se puede deshacer. Los leads inscritos dejan de avanzar.",
        destructive: true,
        confirmLabel: "Eliminar",
      }))
    )
      return;
    try {
      await remove(j.journeyId);
      toast.success("Journey eliminado");
    } catch {
      toast.error("No se pudo eliminar");
    }
  };

  const counts = useMemo(
    () => ({
      all: journeys.length,
      active: journeys.filter((j) => j.status === "active").length,
      draft: journeys.filter((j) => j.status === "draft").length,
      paused: journeys.filter((j) => j.status === "paused").length,
    }),
    [journeys],
  );
  const kept = journeys.filter(
    (j) =>
      (!q || (j.name || "").toLowerCase().includes(q.toLowerCase())) &&
      (statusFilter === "all" || j.status === statusFilter),
  );
  const FILTERS: { key: typeof statusFilter; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "active", label: "Activos" },
    { key: "draft", label: "Borradores" },
    { key: "paused", label: "Pausados" },
  ];

  // ── Builder view ──
  if (current) {
    return (
      <div style={{ height: "100%", minHeight: 0 }}>
        <JourneyBuilder
          initial={current}
          onSave={persist}
          saving={saving}
          onBack={() => {
            setCurrent(null);
            reload();
          }}
        />
      </div>
    );
  }

  // ── Template picker (Fase 3 · 3C-D) ──
  if (picking) {
    return (
      <div className="page">
        <HeroBand
          title="Elige una plantilla"
          chip="Arranca de un patrón probado o desde cero — después editas todo en el riel"
          chipIcon="flow"
          chipTone="var(--green)"
          right={
            <Btn variant="ghost" size="sm" icon="chevL" onClick={() => setPicking(false)}>
              Volver
            </Btn>
          }
        />
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16 }}
        >
          {TEMPLATES.map((t) => (
            <div
              key={t.key}
              className="card card__accent-bar card__pad"
              style={{ "--_c": t.accent, cursor: "pointer" } as React.CSSProperties}
              role="button"
              tabIndex={0}
              onClick={() => {
                setPicking(false);
                setCurrent(t.build());
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 11,
                  display: "grid",
                  placeItems: "center",
                  background: `color-mix(in srgb,${t.accent} 15%,var(--bg-1))`,
                  color: t.accent,
                }}
              >
                <Icon name="flow" size={19} />
              </div>
              <div style={{ fontWeight: 750, fontSize: 15, marginTop: 12 }}>{t.name}</div>
              <div
                className="dim"
                style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.5, minHeight: 54 }}
              >
                {t.desc}
              </div>
              <div
                className="row gap6"
                style={{ marginTop: 4, color: t.accent, fontSize: 11.5, fontWeight: 700 }}
              >
                Usar esta plantilla <Icon name="arrowRight" size={14} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="page">
      <HeroBand
        title="Journeys"
        chip={
          <>
            Engagement Studio · {journeys.length}{" "}
            {journeys.length === 1 ? "recorrido" : "recorridos"}
          </>
        }
        chipIcon="flow"
        chipTone="var(--green)"
        right={
          <div className="row gap10">
            <FeatureCompareButton current="journeys" />
            <Btn variant="ghost" size="sm" icon="refresh" onClick={reload} disabled={loading}>
              Actualizar
            </Btn>
            <Btn variant="primary" size="sm" icon="plus" onClick={() => setPicking(true)}>
              Nuevo journey
            </Btn>
          </div>
        }
      />

      <div
        className="dim"
        style={{ fontSize: 13, marginTop: -8, marginBottom: 18, maxWidth: 720, lineHeight: 1.55 }}
      >
        Secuencias que acompañan en el tiempo: llevan a cada lead por pasos, esperas y ramas (entrar
        → enviar → esperar → ramificar → salir) durante días o semanas. El motor de engagement que
        reemplaza a Pardot.
      </div>

      {loading ? (
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 16 }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skel" style={{ height: 176, borderRadius: 14 }} />
          ))}
        </div>
      ) : journeys.length === 0 ? (
        <div className="col" style={{ gap: 16 }}>
          <Card>
            <div style={{ padding: 40, textAlign: "center" }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  margin: "0 auto",
                  display: "grid",
                  placeItems: "center",
                  background: "color-mix(in srgb, var(--green) 14%, var(--bg-1))",
                  color: "var(--green)",
                }}
              >
                <Icon name="flow" size={26} />
              </div>
              <div style={{ marginTop: 14, fontSize: 15, fontWeight: 700 }}>
                Todavía no hay journeys
              </div>
              <div
                className="dim"
                style={{
                  marginTop: 6,
                  fontSize: 12.5,
                  maxWidth: 420,
                  marginInline: "auto",
                  lineHeight: 1.5,
                }}
              >
                Armá recorridos automáticos que nutren a cada lead con el mensaje correcto en el
                momento correcto — sin escribir código.
              </div>
              <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
                <Btn variant="primary" size="sm" icon="plus" onClick={() => setPicking(true)}>
                  Crear el primero
                </Btn>
              </div>
            </div>
          </Card>
          <div className="card" style={{ padding: 18 }}>
            <FeatureCompare current="journeys" />
          </div>
        </div>
      ) : (
        <>
          {/* KPIs — familia ARIA (Stat + count-up). */}
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
              gap: 16,
              marginBottom: 20,
            }}
          >
            <Stat
              icon="flow"
              color="var(--green)"
              label="Journeys"
              value={<Num value={counts.all} />}
              sub="recorridos totales"
            />
            <Stat
              icon="dot"
              color="var(--green)"
              label="Activos"
              value={<Num value={counts.active} />}
              sub="corriendo ahora"
            />
            <Stat
              icon="fileText"
              color="var(--text-3)"
              label="Borradores"
              value={<Num value={counts.draft} />}
              sub="sin publicar"
            />
            <Stat
              icon="clock"
              color="var(--gold)"
              label="Pausados"
              value={<Num value={counts.paused} />}
              sub="en pausa"
            />
          </div>

          {/* Filtros + búsqueda — pills estilo ARIA. */}
          <div className="row between wrap gap12" style={{ marginBottom: 16 }}>
            <div className="row gap8 wrap" role="tablist" aria-label="Estado">
              {FILTERS.map((f) => {
                const active = statusFilter === f.key;
                return (
                  <button
                    key={f.key}
                    role="tab"
                    aria-selected={active}
                    className="pill"
                    onClick={() => setStatusFilter(f.key)}
                    style={{
                      cursor: "pointer",
                      height: 32,
                      gap: 8,
                      border: active ? "1.5px solid var(--accent)" : "1px solid var(--border-1)",
                      background: active ? "var(--accent-soft)" : "var(--bg-1)",
                      color: active ? "var(--accent)" : "var(--text-2)",
                      fontWeight: active ? 700 : 600,
                    }}
                  >
                    {f.label}
                    <span className="tnum" style={{ opacity: 0.7, fontSize: 11.5 }}>
                      {counts[f.key]}
                    </span>
                  </button>
                );
              })}
            </div>
            <div
              className="row gap8"
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: 999,
                border: "1px solid var(--border-1)",
                background: "var(--bg-1)",
                minWidth: 220,
              }}
            >
              <Icon name="search" size={15} style={{ color: "var(--text-3)" }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar journey…"
                style={{
                  border: "none",
                  background: "transparent",
                  outline: "none",
                  color: "var(--text-1)",
                  fontSize: 13,
                  width: "100%",
                }}
              />
            </div>
          </div>

          {kept.length === 0 ? (
            <Card>
              <div className="dim" style={{ padding: 36, textAlign: "center", fontSize: 13 }}>
                Ningún journey coincide con el filtro.
              </div>
            </Card>
          ) : (
            <div
              className="grid"
              style={{ gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 16 }}
            >
              {kept.map((j, i) => {
                const nodes = Array.isArray(j.nodes) ? j.nodes : [];
                const steps = nodes.length;
                const entryLabel = j.entry?.segmentId
                  ? "Segmento"
                  : j.entry?.trigger
                    ? j.entry.trigger
                    : "Manual";
                const accent = ACCENTS[i % ACCENTS.length];
                // Rail de pasos: los primeros nodos como pills encadenadas con chevrons.
                const rail = nodes.slice(0, 5);
                return (
                  <div
                    key={j.journeyId}
                    className="card card__accent-bar"
                    style={
                      {
                        "--_c": accent,
                        padding: "16px 18px",
                        cursor: "pointer",
                      } as React.CSSProperties
                    }
                    onClick={() => setCurrent(j)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="row between" style={{ marginBottom: 12 }}>
                      <div className="row gap12" style={{ minWidth: 0 }}>
                        <div
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 11,
                            display: "grid",
                            placeItems: "center",
                            background: `color-mix(in srgb,${accent} 15%,var(--bg-1))`,
                            color: accent,
                            flex: "0 0 auto",
                          }}
                        >
                          <Icon name="flow" size={19} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 750,
                              fontSize: 15,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {j.name || "Sin nombre"}
                          </div>
                          <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
                            {entryLabel} · {steps} {steps === 1 ? "paso" : "pasos"}
                            {j.stats && j.stats.total > 0 && (
                              <>
                                {" · "}
                                <b style={{ color: "var(--text-2)" }}>{j.stats.total}</b> inscrito
                                {j.stats.total === 1 ? "" : "s"}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <Pill
                        tone={STATUS_TONE[j.status] || "outline"}
                        icon={j.status === "active" ? "dot" : undefined}
                      >
                        {STATUS_LABEL[j.status] || j.status}
                      </Pill>
                    </div>

                    <div
                      className="row gap6 wrap"
                      style={{ alignItems: "center", marginBottom: 12, minHeight: 30 }}
                    >
                      {rail.map((n, k) => {
                        const meta = NODE_META[n.kind] || {
                          icon: "dot" as IconName,
                          label: n.kind,
                        };
                        return (
                          <span key={n.id || k} style={{ display: "contents" }}>
                            <span
                              className="pill pill--outline"
                              style={{ height: 28, gap: 6, fontSize: 11.5 }}
                            >
                              <Icon name={meta.icon} size={13} style={{ color: accent }} />
                              {meta.label}
                            </span>
                            {k < rail.length - 1 && (
                              <Icon
                                name="chevR"
                                size={14}
                                style={{ color: "var(--text-3)", flex: "0 0 auto" }}
                              />
                            )}
                          </span>
                        );
                      })}
                      {steps > rail.length && (
                        <span className="dim" style={{ fontSize: 11.5 }}>
                          +{steps - rail.length}
                        </span>
                      )}
                    </div>

                    <div
                      className="row between"
                      style={{ paddingTop: 12, borderTop: "1px solid var(--border-1)" }}
                    >
                      <span className="dim" style={{ fontSize: 12 }}>
                        {j.updatedAt
                          ? new Date(j.updatedAt).toLocaleDateString("es-PE", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </span>
                      <div className="row gap6">
                        <Btn
                          variant="ghost"
                          size="sm"
                          icon={j.status === "active" ? "clock" : "dot"}
                          onClick={(e) => toggleStatus(j, e)}
                          title={j.status === "active" ? "Pausar" : "Activar"}
                        >
                          {j.status === "active" ? "Pausar" : "Activar"}
                        </Btn>
                        <Btn
                          variant="ghost"
                          size="sm"
                          icon="x"
                          onClick={(e) => del(j, e)}
                          title="Eliminar journey"
                        />
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
