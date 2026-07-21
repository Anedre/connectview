import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Icon, Btn, Stat, Pill, HeroBand, Num } from "@/components/aria";
import type { IconName } from "@/components/aria";
import { useWorkflows } from "@/hooks/useWorkflows";
import { WorkflowBuilder } from "@/components/workflows/WorkflowBuilder";
import { TRIGGER_DEFS } from "@/lib/automations";
import type { Workflow, WorkflowShape, WorkflowTrigger } from "@/lib/workflows";

/**
 * WorkflowsHub — el hub UNIFICADO de "Flujos" (Fase 1, detrás del flag
 * `flujosFusion`). UNA lista con reflejos, recorridos y combos; UN botón "Nuevo
 * flujo"; UN builder (WorkflowBuilder) que rutea al motor correcto al guardar.
 * El hub de la Fase 0 (AutomationsPage) queda como fallback cuando el flag está
 * OFF. No reescribe motores: usa `useWorkflows` (mapeo puro testeado + endpoints
 * existentes).
 */

const SHAPE_META: Record<WorkflowShape, { label: string; tone: string; icon: IconName }> = {
  reflex: { label: "Reflejo", tone: "var(--gold)", icon: "zap" },
  journey: { label: "Recorrido", tone: "var(--green)", icon: "flow" },
  split: { label: "Reacción + recorrido", tone: "var(--cyan)", icon: "flow" },
};

function triggerLabel(t: WorkflowTrigger): string {
  if (t.kind === "event") return TRIGGER_DEFS[t.type]?.label || t.type;
  if (t.kind === "segment") return "Segmento";
  if (t.kind === "new_lead") return "Lead nuevo (auto)";
  return "Manual";
}

/** Un flujo en blanco: entrada por evento (lead nuevo) + Entrada→Fin en el lienzo. */
function blankWorkflow(): Workflow {
  return {
    id: "",
    source: "rule",
    name: "Nuevo flujo",
    enabled: false,
    trigger: { kind: "event", type: "lead_created", params: {} },
    nodes: [
      { id: "wf-entry", kind: "entry", params: {} },
      { id: "wf-exit", kind: "exit", params: {} },
    ],
    edges: [{ from: "wf-entry", to: "wf-exit" }],
  };
}

export function WorkflowsHub() {
  const { workflows, journeys, loading, reload, save, remove, toggle, shapeOf } = useWorkflows();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");

  const persist = async (w: Workflow) => {
    setSaving(true);
    try {
      await save(w);
      toast.success("Flujo guardado");
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el flujo");
    } finally {
      setSaving(false);
    }
  };

  const del = async (w: Workflow) => {
    const okd = await confirm({
      title: `¿Eliminar "${w.name}"?`,
      description:
        shapeOf(w) === "reflex"
          ? "Las ejecuciones pasadas se conservan hasta expirar."
          : "Los leads inscritos dejan de avanzar.",
      destructive: true,
      confirmLabel: "Eliminar",
    });
    if (!okd) return;
    try {
      await remove(w);
      toast.success("Flujo eliminado");
    } catch {
      toast.error("No se pudo eliminar");
    }
  };

  const onToggle = async (w: Workflow) => {
    try {
      await toggle(w);
    } catch {
      toast.error("No se pudo cambiar el estado");
    }
  };

  // ── Builder ──
  if (editing) {
    return (
      <WorkflowBuilder
        initial={editing}
        saving={saving}
        onSave={persist}
        onBack={() => setEditing(null)}
        journeys={journeys}
      />
    );
  }

  // ── Lista ──
  const kept = workflows.filter((w) => !q || w.name.toLowerCase().includes(q.toLowerCase()));
  const activeCount = workflows.filter((w) => w.enabled).length;
  const reflexCount = workflows.filter((w) => shapeOf(w) === "reflex").length;

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <HeroBand
        title="Flujos"
        chip={`Orquestación unificada · ${workflows.length} ${workflows.length === 1 ? "flujo" : "flujos"}`}
        chipIcon="flow"
        chipTone="var(--green)"
        right={
          <div className="row gap10">
            <Btn variant="ghost" size="sm" icon="refresh" onClick={reload} disabled={loading}>
              Actualizar
            </Btn>
            <Btn
              variant="primary"
              size="sm"
              icon="plus"
              onClick={() => setEditing(blankWorkflow())}
            >
              Nuevo flujo
            </Btn>
          </div>
        }
      />

      <div
        className="dim"
        style={{ fontSize: 13, marginTop: -8, marginBottom: 18, maxWidth: 780, lineHeight: 1.55 }}
      >
        Un solo lugar para la orquestación: <strong>reflejos</strong> que reaccionan a un evento al
        instante, <strong>recorridos</strong> que acompañan al lead en el tiempo, y{" "}
        <strong>combos</strong> que reaccionan y después nutren. Eliges la entrada (evento o
        audiencia) y los pasos; ARIA rutea al motor correcto al guardar.
      </div>

      {/* KPIs */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <Stat
          icon="flow"
          color="var(--green)"
          label="Flujos totales"
          value={<Num value={workflows.length} />}
          sub="reflejos + recorridos"
        />
        <Stat
          icon="check"
          color="var(--green)"
          label="Activos"
          value={<Num value={activeCount} />}
          sub={`${workflows.length - activeCount} en pausa`}
        />
        <Stat
          icon="zap"
          color="var(--gold)"
          label="Reflejos"
          value={<Num value={reflexCount} />}
          sub="reacción instantánea"
        />
      </div>

      {/* Buscador */}
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
            placeholder="Buscar flujo…"
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

      {loading ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 14,
          }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skel" style={{ height: 140, borderRadius: 14 }} />
          ))}
        </div>
      ) : kept.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="flow" size={22} />}
            title={workflows.length === 0 ? "Todavía no hay flujos" : "Ningún flujo coincide"}
            description="Crea el primero: un reflejo («lead nuevo → WhatsApp de bienvenida»), un recorrido de nurture, o un combo que reacciona y después acompaña."
            action={
              <Btn variant="primary" icon="plus" onClick={() => setEditing(blankWorkflow())}>
                Crear el primero
              </Btn>
            }
          />
        </div>
      ) : (
        <div
          className="aria-stagger"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: 14,
          }}
        >
          {kept.map((w) => {
            const shape = shapeOf(w);
            const sm = SHAPE_META[shape];
            const steps = w.nodes.filter((n) => n.kind !== "entry" && n.kind !== "exit").length;
            return (
              <div
                key={w.id || w.name}
                className={"card " + (w.enabled ? "card__accent-bar" : "")}
                style={{
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  ...(w.enabled ? ({ "--_c": sm.tone } as React.CSSProperties) : {}),
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 32,
                      height: 32,
                      borderRadius: 9,
                      background: "var(--bg-2)",
                      color: sm.tone,
                      flexShrink: 0,
                    }}
                  >
                    <Icon name={sm.icon} size={15} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13.5,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {w.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {triggerLabel(w.trigger)}
                      {` · ${steps} ${steps === 1 ? "paso" : "pasos"}`}
                    </div>
                  </div>
                  <Switch
                    checked={w.enabled}
                    onCheckedChange={() => onToggle(w)}
                    accent="var(--green)"
                    aria-label={w.enabled ? "Pausar flujo" : "Activar flujo"}
                  />
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Pill icon={sm.icon} style={{ color: sm.tone, border: `1px solid ${sm.tone}` }}>
                    {sm.label}
                  </Pill>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 11.5,
                    color: "var(--text-3)",
                    marginTop: "auto",
                  }}
                >
                  <span style={{ flex: 1 }}>{w.enabled ? "Activo" : "En pausa"}</span>
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="settings"
                    onClick={() => setEditing({ ...w })}
                    title="Editar"
                  />
                  <Btn variant="ghost" size="sm" onClick={() => del(w)} title="Eliminar">
                    <Trash2 size={13} />
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
