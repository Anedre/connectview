import { useState } from "react";
import { X, Plus } from "lucide-react";
import { toast } from "sonner";
import { JourneyFlowBuilder } from "@/components/journeys/JourneyFlowBuilder";
import { useSegments } from "@/hooks/useSegments";
import { SegmentedControl } from "@/components/ui/segmented";
import { Icon } from "@/components/aria";
import type { Journey } from "@/hooks/useJourneys";
import {
  CONDITION_FIELDS,
  CONDITION_OPS,
  TRIGGER_DEFS,
  TRIGGER_ORDER,
  type RuleCondition,
  type TriggerType,
} from "@/lib/automations";
import { classifyShape, journeyIdOf, type Workflow, type WorkflowTrigger } from "@/lib/workflows";

/**
 * WorkflowBuilder — EL builder unificado de "Flujos" (Fase 1). Reutiliza el
 * CANVAS de Journey para los pasos (acción / espera / rama) y le antepone un
 * panel de ENTRADA unificada: por EVENTO (los 9 disparadores, reacción
 * instantánea) o por AUDIENCIA (segmento / manual, nurture en el tiempo).
 *
 * El filtro del evento vive en `trigger.conditions` (regla eficiente en el
 * automation-engine), NO como un `branch` del canvas (que forzaría el motor de
 * journeys). Al guardar, compone el `Workflow` y delega en `onSave`, que rutea
 * al motor correcto (`useWorkflows.save`): sin esperas → regla; con esperas →
 * split (regla → start_journey(J)); audiencia → journey.
 */

const inputStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid var(--border-2)",
  background: "var(--bg-1)",
  color: "var(--text-1)",
};

type EntryMode = "event" | "audience" | "manual";
function modeOf(t: WorkflowTrigger): EntryMode {
  if (t.kind === "event") return "event";
  if (t.kind === "manual") return "manual";
  return "audience"; // segment | new_lead
}

/** El Journey que alimenta el canvas (los PASOS). La entrada real vive en el
 *  trigger del panel; aquí `entry` es siempre manual (irrelevante para el canvas). */
function toCanvasJourney(w: Workflow): Journey {
  return {
    journeyId: journeyIdOf(w.id) || "",
    name: w.name,
    status: w.status ?? (w.enabled ? "active" : "draft"),
    entry: { manual: true },
    reenroll: !!w.reenroll,
    nodes: w.nodes,
    edges: w.edges,
    ...(w.goal ? { goal: w.goal } : {}),
  };
}

export function WorkflowBuilder({
  initial,
  saving,
  onSave,
  onBack,
  journeys,
}: {
  initial: Workflow;
  saving?: boolean;
  onSave: (w: Workflow) => void | Promise<void>;
  onBack?: () => void;
  journeys?: Journey[];
}) {
  const { segments } = useSegments();
  const [trigger, setTrigger] = useState<WorkflowTrigger>(initial.trigger);

  const mode = modeOf(trigger);
  const setMode = (m: EntryMode) => {
    if (m === "event")
      setTrigger((prev) =>
        prev.kind === "event" ? prev : { kind: "event", type: "lead_created", params: {} },
      );
    else if (m === "manual") setTrigger({ kind: "manual" });
    else
      setTrigger((prev) =>
        prev.kind === "segment" || prev.kind === "new_lead"
          ? prev
          : { kind: "segment", segmentId: segments[0]?.segmentId || "" },
      );
  };

  // El canvas emite el Journey editado (pasos + nombre + status); componemos el
  // Workflow con el trigger del panel y delegamos el ruteo en onSave.
  const handleSave = async (j: Journey) => {
    const w: Workflow = {
      id: initial.id,
      source: initial.source,
      name: j.name,
      enabled: j.status === "active",
      status: j.status,
      trigger,
      nodes: j.nodes,
      edges: j.edges,
      reenroll: !!j.reenroll,
      ...(j.goal ? { goal: j.goal } : {}),
    };
    if (w.trigger.kind === "event") {
      const steps = w.nodes.filter((n) => n.kind !== "entry" && n.kind !== "exit");
      if (steps.length === 0) {
        toast.error("Agrega al menos un paso al flujo");
        return;
      }
    }
    await onSave(w);
  };

  const shape = classifyShape({ trigger, nodes: initial.nodes, edges: initial.edges });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <EntryPanel
        trigger={trigger}
        onChange={setTrigger}
        mode={mode}
        onMode={setMode}
        segments={segments}
        shape={shape}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        <JourneyFlowBuilder
          initial={toCanvasJourney(initial)}
          journeys={journeys}
          onSave={handleSave}
          saving={saving}
          onBack={onBack}
          hideEntryConfig
        />
      </div>
    </div>
  );
}

/** El panel de ENTRADA (encima del canvas): elige evento/audiencia/manual y su
 *  configuración. Compacto: los pasos siguen siendo el foco del lienzo. */
function EntryPanel({
  trigger,
  onChange,
  mode,
  onMode,
  segments,
  shape,
}: {
  trigger: WorkflowTrigger;
  onChange: (t: WorkflowTrigger) => void;
  mode: EntryMode;
  onMode: (m: EntryMode) => void;
  segments: Array<{ segmentId: string; name: string }>;
  shape: ReturnType<typeof classifyShape>;
}) {
  const shapeMeta: Record<typeof shape, { label: string; tone: string }> = {
    reflex: { label: "Reflejo · instantáneo", tone: "var(--gold)" },
    journey: { label: "Recorrido · en el tiempo", tone: "var(--green)" },
    split: { label: "Reacción + recorrido", tone: "var(--cyan)" },
  };
  const meta = shapeMeta[shape];

  return (
    <div
      style={{
        borderBottom: "1px solid var(--border-1)",
        background: "var(--bg-2)",
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div className="row between wrap" style={{ gap: 10 }}>
        <div className="row gap8" style={{ alignItems: "center" }}>
          <Icon name="zap" size={15} style={{ color: "var(--gold)" }} />
          <strong style={{ fontSize: 13 }}>Entrada del flujo</strong>
          <SegmentedControl
            value={mode}
            onValueChange={(m) => onMode(m as EntryMode)}
            options={[
              { value: "event", label: "Por evento", color: "var(--gold)" },
              { value: "audience", label: "Por audiencia", color: "var(--green)" },
              { value: "manual", label: "Manual", color: "var(--text-3)" },
            ]}
          />
        </div>
        <span
          className="pill"
          style={{
            height: 26,
            gap: 6,
            fontSize: 11.5,
            fontWeight: 700,
            color: meta.tone,
            border: `1px solid ${meta.tone}`,
          }}
          title="A qué motor se rutea al guardar, según la forma"
        >
          <Icon name="flow" size={12} /> {meta.label}
        </span>
      </div>

      {trigger.kind === "event" && <EventEntry trigger={trigger} onChange={onChange} />}
      {(trigger.kind === "segment" || trigger.kind === "new_lead") && (
        <AudienceEntry trigger={trigger} onChange={onChange} segments={segments} />
      )}
      {trigger.kind === "manual" && (
        <div className="dim" style={{ fontSize: 12, lineHeight: 1.5 }}>
          Inscribes los leads a mano (desde Leads) o desde otro flujo. El recorrido no se dispara
          solo.
        </div>
      )}
    </div>
  );
}

function EventEntry({
  trigger,
  onChange,
}: {
  trigger: Extract<WorkflowTrigger, { kind: "event" }>;
  onChange: (t: WorkflowTrigger) => void;
}) {
  const def = TRIGGER_DEFS[trigger.type];
  const params = trigger.params || {};
  const conditions = trigger.conditions || [];
  const setParam = (k: string, v: unknown) =>
    onChange({ ...trigger, params: { ...params, [k]: v } });
  const setConditions = (c: RuleCondition[]) => onChange({ ...trigger, conditions: c });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row gap10 wrap" style={{ alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)" }}>
            Cuándo dispara
          </span>
          <select
            value={trigger.type}
            onChange={(e) =>
              onChange({
                kind: "event",
                type: e.target.value as TriggerType,
                params: {},
                conditions,
              })
            }
            style={{ ...inputStyle, minWidth: 220 }}
          >
            {TRIGGER_ORDER.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_DEFS[t].label}
              </option>
            ))}
          </select>
        </label>
        {def.fields.map((f) => (
          <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)" }}>{f.label}</span>
            <input
              type={f.type === "number" ? "number" : "text"}
              value={String(params[f.key] ?? f.defaultValue ?? "")}
              placeholder={f.placeholder}
              onChange={(e) =>
                setParam(f.key, f.type === "number" ? Number(e.target.value) : e.target.value)
              }
              style={{ ...inputStyle, width: f.type === "number" ? 90 : 180 }}
            />
          </label>
        ))}
      </div>
      <div className="dim" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
        {def.description}
      </div>
      <ConditionRows conditions={conditions} onChange={setConditions} />
    </div>
  );
}

/** Filtro de la regla (solo dispara si se cumplen). Reusa los campos/operadores
 *  del catálogo de automatizaciones → va a `trigger.conditions`. */
function ConditionRows({
  conditions,
  onChange,
}: {
  conditions: RuleCondition[];
  onChange: (c: RuleCondition[]) => void;
}) {
  const set = (i: number, patch: Partial<RuleCondition>) =>
    onChange(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)" }}>
        Solo si (filtro, opcional)
      </span>
      {conditions.map((c, i) => {
        const op = CONDITION_OPS.find((o) => o.value === c.op);
        return (
          <div key={i} className="row gap6" style={{ alignItems: "center" }}>
            <select
              value={c.field}
              onChange={(e) => set(i, { field: e.target.value as RuleCondition["field"] })}
              style={{ ...inputStyle, width: 160 }}
            >
              {CONDITION_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              value={c.op}
              onChange={(e) => set(i, { op: e.target.value as RuleCondition["op"] })}
              style={{ ...inputStyle, width: 150 }}
            >
              {CONDITION_OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {op?.needsValue !== false && (
              <input
                value={c.value}
                onChange={(e) => set(i, { value: e.target.value })}
                placeholder="valor"
                style={{ ...inputStyle, width: 130 }}
              />
            )}
            <button
              onClick={() => onChange(conditions.filter((_, idx) => idx !== i))}
              title="Quitar condición"
              style={{
                ...inputStyle,
                width: 30,
                color: "var(--red)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        onClick={() => onChange([...conditions, { field: "source", op: "eq", value: "" }])}
        className="jb-btn"
        style={{ alignSelf: "flex-start" }}
      >
        <Plus size={12} /> Condición
      </button>
    </div>
  );
}

function AudienceEntry({
  trigger,
  onChange,
  segments,
}: {
  trigger: Extract<WorkflowTrigger, { kind: "segment" | "new_lead" }>;
  onChange: (t: WorkflowTrigger) => void;
  segments: Array<{ segmentId: string; name: string }>;
}) {
  const kind = trigger.kind;
  return (
    <div className="row gap10 wrap" style={{ alignItems: "flex-end" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)" }}>Quién entra</span>
        <select
          value={kind === "new_lead" ? "__new_lead" : "__segment"}
          onChange={(e) =>
            e.target.value === "__new_lead"
              ? onChange({ kind: "new_lead" })
              : onChange({ kind: "segment", segmentId: segments[0]?.segmentId || "" })
          }
          style={{ ...inputStyle, minWidth: 220 }}
        >
          <option value="__segment">Los que entran a un segmento</option>
          <option value="__new_lead">Cada lead nuevo (auto-inscripción)</option>
        </select>
      </label>
      {kind === "segment" && (
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)" }}>Segmento</span>
          <select
            value={trigger.segmentId}
            onChange={(e) => onChange({ kind: "segment", segmentId: e.target.value })}
            style={{ ...inputStyle, minWidth: 220 }}
          >
            <option value="">— Elegir segmento —</option>
            {segments.map((s) => (
              <option key={s.segmentId} value={s.segmentId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="dim" style={{ fontSize: 11.5, lineHeight: 1.45, flex: 1, minWidth: 200 }}>
        El runner evalúa cada 5 min e inscribe a los leads que coinciden, una vez por lead.
      </div>
    </div>
  );
}
