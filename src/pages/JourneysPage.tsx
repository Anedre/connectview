import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useJourneys, type Journey } from "@/hooks/useJourneys";
import { JourneyBuilder } from "@/components/journeys/JourneyBuilder";
import * as Icon from "@/components/vox/primitives";
import { PageHeader } from "@/components/vox/PageHeader";
import { useConfirm } from "@/components/ui/confirm-dialog";

/**
 * JourneysPage — el /journeys (Fase 3 · 3B). Lista los recorridos del tenant
 * (motor de Journeys / Engagement Studio) y abre el JourneyBuilder visual para
 * crear/editar uno. Persiste con manage-leads (saveJourney, folded); el avance
 * paso-a-paso lo corre el journey-runner por tick.
 */
const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  active: "Activo",
  paused: "Pausado",
};
const ACCENTS = [
  "#7c3aed",
  "#2563eb",
  "#0891b2",
  "#16a34a",
  "#d97706",
  "#db2777",
  "#0ea5e9",
  "#8b5cf6",
];
const rid = () => Math.random().toString(36).slice(2, 9);

/** Semilla de un journey nuevo: Entrada → Enviar → Esperar → Fin (editable). */
function newJourney(): Journey {
  const e = rid(),
    s = rid(),
    w = rid(),
    x = rid();
  return {
    journeyId: "",
    name: "Nuevo journey",
    status: "draft",
    entry: { manual: true },
    reenroll: false,
    nodes: [
      { id: e, kind: "entry" },
      { id: s, kind: "send", params: { channel: "whatsapp", templateName: "" } },
      { id: w, kind: "wait", params: { days: 3 } },
      { id: x, kind: "exit" },
    ],
    edges: [
      { from: e, to: s },
      { from: s, to: w },
      { from: w, to: x },
    ],
  };
}

export function JourneysPage() {
  const { journeys, loading, reload, save, remove } = useJourneys();
  const [current, setCurrent] = useState<Journey | null>(null);
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

  // ── List view ──
  return (
    <div className="view">
      <PageHeader
        crumb="Automatización"
        title="Journeys"
        count={`${journeys.length} ${journeys.length === 1 ? "recorrido" : "recorridos"}`}
        sub="Recorridos automáticos multi-paso: entrar → enviar → esperar → ramificar → salir. El motor de engagement que reemplaza a Pardot."
        search={{ value: q, onChange: setQ, placeholder: "Buscar journey…" }}
        actions={
          <>
            <button className="btn" onClick={reload} disabled={loading}>
              <Icon.Refresh size={14} /> Actualizar
            </button>
            <button className="btn btn--primary" onClick={() => setCurrent(newJourney())}>
              <Icon.Plus size={14} /> Nuevo journey
            </button>
          </>
        }
      />

      {loading ? (
        <div className="bots-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skel" style={{ height: 168, borderRadius: 14 }} />
          ))}
        </div>
      ) : journeys.length === 0 ? (
        <div className="card" style={{ padding: 56, textAlign: "center", color: "var(--text-3)" }}>
          <Icon.Workflow size={34} style={{ opacity: 0.4 }} />
          <div style={{ marginTop: 12, fontSize: 14.5, fontWeight: 600, color: "var(--text-2)" }}>
            Todavía no hay journeys
          </div>
          <div style={{ marginTop: 4, fontSize: 12.5 }}>
            Armá recorridos automáticos que nutren a cada lead con el mensaje correcto en el momento
            correcto — sin escribir código.
          </div>
          <button
            className="btn btn--primary"
            style={{ marginTop: 16 }}
            onClick={() => setCurrent(newJourney())}
          >
            <Icon.Plus size={14} /> Crear el primero
          </button>
        </div>
      ) : (
        <>
          <div className="bots-kpis">
            <div className="bots-kpi">
              <span className="bots-kpi__n">{counts.all}</span>
              <span className="bots-kpi__l">Journeys</span>
            </div>
            <div className="bots-kpi">
              <span className="bots-kpi__n" style={{ color: "var(--accent-green)" }}>
                {counts.active}
              </span>
              <span className="bots-kpi__l">Activos</span>
            </div>
            <div className="bots-kpi">
              <span className="bots-kpi__n" style={{ color: "var(--text-2)" }}>
                {counts.draft}
              </span>
              <span className="bots-kpi__l">Borradores</span>
            </div>
            <div className="bots-kpi">
              <span className="bots-kpi__n" style={{ color: "var(--accent-violet)" }}>
                {counts.paused}
              </span>
              <span className="bots-kpi__l">Pausados</span>
            </div>
          </div>

          <div className="bots-filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`bots-filter ${statusFilter === f.key ? "bots-filter--on" : ""}`}
                onClick={() => setStatusFilter(f.key)}
              >
                {f.label}
                <span className="bots-filter__n">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          {kept.length === 0 ? (
            <div
              className="card"
              style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}
            >
              Ningún journey coincide con el filtro.
            </div>
          ) : (
            <div className="bots-grid">
              {kept.map((j, i) => {
                const steps = Array.isArray(j.nodes) ? j.nodes.length : 0;
                const entryLabel = j.entry?.segmentId
                  ? "Segmento"
                  : j.entry?.trigger
                    ? j.entry.trigger
                    : "Manual";
                return (
                  <div
                    key={j.journeyId}
                    className="bot-card"
                    style={{ "--bot-accent": ACCENTS[i % ACCENTS.length] } as React.CSSProperties}
                    onClick={() => setCurrent(j)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="bot-card__top">
                      <span className="bot-card__icon">
                        <Icon.Workflow size={17} />
                      </span>
                      <span className={`bot-card__status bot-card__status--${j.status}`}>
                        {STATUS_LABEL[j.status] || j.status}
                      </span>
                    </div>
                    <div className="bot-card__name">{j.name || "Sin nombre"}</div>
                    <div className="bot-card__rail" aria-hidden>
                      {Array.from({ length: Math.max(1, Math.min(steps || 1, 7)) }).map((_, k) => (
                        <span key={k} className="bot-card__dot" />
                      ))}
                    </div>
                    <div className="bot-card__meta">
                      <span className="bot-card__chip">
                        <Icon.Workflow size={12} /> {entryLabel}
                      </span>
                      <span className="bot-card__chip">
                        {steps} {steps === 1 ? "paso" : "pasos"}
                      </span>
                    </div>
                    <div className="bot-card__foot">
                      <span>
                        {j.updatedAt
                          ? new Date(j.updatedAt).toLocaleDateString("es-PE", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          className="btn btn--ghost btn--sm"
                          style={{
                            padding: "3px 10px",
                            fontSize: 11.5,
                            color: j.status === "active" ? "var(--text-3)" : "var(--accent-green)",
                          }}
                          onClick={(e) => toggleStatus(j, e)}
                          title={j.status === "active" ? "Pausar" : "Activar"}
                        >
                          {j.status === "active" ? "Pausar" : "Activar"}
                        </button>
                        <button
                          className="bot-card__del"
                          onClick={(e) => del(j, e)}
                          title="Eliminar journey"
                        >
                          <Icon.Trash size={13} />
                        </button>
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
