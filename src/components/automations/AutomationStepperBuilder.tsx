import { Fragment, useState } from "react";
import {
  Trash2,
  Plus,
  Copy,
  X,
  ChevronUp,
  ChevronDown,
  Filter,
  AlertTriangle,
  GripVertical,
} from "lucide-react";
import {
  ACTION_DEFS,
  ACTION_ORDER,
  CONDITION_FIELDS,
  CONDITION_OPS,
  TRIGGER_DEFS,
  TRIGGER_ORDER,
  type ActionType,
  type AutomationRule,
  type RuleCondition,
} from "@/lib/automations";
import { FieldsBlock, WfSelect, colorForAction, type PickersCtx } from "./AutomationFields";

/**
 * AutomationStepperBuilder — el builder de Automatizaciones como ESPINAZO VERTICAL
 * ("playbook"/receta premium). Identidad propia frente a los otros builders:
 *  · Bots      = canvas horizontal con nodos-rectángulo (React Flow, cables).
 *  · Journeys  = state cards estilo AWS Step Functions ARRASTRABLES (React Flow, ramas).
 *  · Automatizaciones (este) = un espinazo LINEAL: disparador (gold) arriba → filtro →
 *    acciones NUMERADAS bajando por un riel, cada una como tarjeta premium con un
 *    resumen. Sin canvas ni drag: el ORDEN se lee de arriba a abajo y escala infinito.
 *
 * Reemplaza al hub radial (se veía cargado con muchas acciones). El modelo de datos
 * NO cambia; el panel derecho (inspector) configura el nodo seleccionado.
 */

type Sel = { kind: "hub" } | { kind: "conditions" } | { kind: "action"; index: number } | null;

/** Resumen corto de una acción para la tarjeta (sin abrir el inspector). */
function summarize(
  a: { type: ActionType; params?: Record<string, unknown> },
  ctx: PickersCtx,
): string {
  const p = a.params || {};
  switch (a.type) {
    case "apply_score": {
      const d = Number(p.delta || 0);
      return `${d >= 0 ? "+" : ""}${d} pts`;
    }
    case "apply_tag":
    case "remove_tag":
      return String(p.tag || "");
    case "apply_attribute":
      return p.field ? `${String(p.field)} = ${String(p.value ?? "")}` : "";
    case "set_program": {
      const id = String(p.programId || "");
      return ctx.programs.find((pr) => pr.id === id)?.name || id;
    }
    case "unsubscribe": {
      const ch = String(p.channel || "all");
      return ch === "all" ? "WhatsApp + Email" : ch;
    }
    case "send_whatsapp_template":
      return String(p.templateName || "");
    case "send_email":
      return String(p.subject || "");
    case "move_stage": {
      const id = String(p.stageId || "");
      return ctx.stages.find((s) => s.id === id)?.label || id;
    }
    case "schedule_callback":
      return `${String(p.channel || "voice")} · +${Number(p.offsetHours ?? 24)}h`;
    case "enqueue_dialer": {
      const id = String(p.campaignId || "");
      return ctx.campaigns.find((cp) => cp.id === id)?.name || id;
    }
    case "notify_agent":
      return String(p.message || "").slice(0, 46);
    case "add_note":
      return String(p.text || "").slice(0, 46);
    case "mark_salesforce_sync":
      return "Salesforce";
    case "start_journey":
    case "unenroll_journey": {
      const id = String(p.journeyId || "");
      return ctx.journeys.find((j) => j.journeyId === id)?.name || id;
    }
    case "webhook":
      return String(p.url || "");
    default:
      return "";
  }
}

/** ¿Un valor de campo está vacío? (para el badge de "falta configurar"). */
const isBlank = (v: unknown): boolean =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0);

/** ¿A un trigger/acción le falta algún campo REQUERIDO? */
function isIncomplete(
  fields: { key: string; required?: boolean }[],
  params: Record<string, unknown> | undefined,
): boolean {
  const p = params || {};
  return fields.some((f) => f.required && isBlank(p[f.key]));
}

export function AutomationStepperBuilder({
  rule,
  onChange,
  ctx,
}: {
  rule: AutomationRule;
  onChange: (r: AutomationRule) => void;
  ctx: PickersCtx;
}) {
  const [sel, setSel] = useState<Sel>({ kind: "hub" });
  const [adding, setAdding] = useState(false);
  // Drag-para-reordenar: índice arrastrado + índice sobre el que se suelta.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const actions = rule.actions || [];
  const conds = rule.conditions || [];
  const trig = TRIGGER_DEFS[rule.trigger.type];
  const TrigIcon = trig.icon;

  // ── Handlers (mismo modelo de datos) ──
  const defaultsFor = (t: ActionType): Record<string, unknown> => {
    const params: Record<string, unknown> = {};
    for (const f of ACTION_DEFS[t].fields)
      if (f.defaultValue !== undefined) params[f.key] = f.defaultValue;
    return params;
  };
  const setActionParams = (i: number, p: Record<string, unknown>) => {
    const a = [...actions];
    a[i] = { ...a[i], params: p };
    onChange({ ...rule, actions: a });
  };
  const setActionConditions = (i: number, conditions: RuleCondition[]) => {
    const a = [...actions];
    a[i] = { ...a[i], conditions };
    onChange({ ...rule, actions: a });
  };
  const setActionType = (i: number, t: ActionType) => {
    const a = [...actions];
    a[i] = { type: t, params: defaultsFor(t) };
    onChange({ ...rule, actions: a });
  };
  const addAction = (t: ActionType) => {
    onChange({ ...rule, actions: [...actions, { type: t, params: defaultsFor(t) }] });
    setSel({ kind: "action", index: actions.length });
    setAdding(false);
  };
  const removeAction = (i: number) => {
    onChange({ ...rule, actions: actions.filter((_, j) => j !== i) });
    setSel(null);
  };
  const moveAction = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= actions.length) return;
    const a = [...actions];
    [a[i], a[j]] = [a[j], a[i]];
    onChange({ ...rule, actions: a });
    setSel({ kind: "action", index: j });
  };
  const dupAction = (i: number) => {
    const a = [...actions];
    a.splice(i + 1, 0, { type: actions[i].type, params: { ...actions[i].params } });
    onChange({ ...rule, actions: a });
    setSel({ kind: "action", index: i + 1 });
  };
  /** Mueve la acción `from` a la posición `to` (drag & drop). */
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= actions.length) return;
    const a = [...actions];
    const [moved] = a.splice(from, 1);
    a.splice(to, 0, moved);
    onChange({ ...rule, actions: a });
    setSel({ kind: "action", index: to });
  };

  return (
    <div className="arb">
      {/* ═══════════ ESPINAZO (playbook vertical) ═══════════ */}
      <div
        className="ast"
        onClick={() => {
          setSel(null);
          setAdding(false);
        }}
      >
        <div className="ast-flow" onClick={(e) => e.stopPropagation()}>
          {/* Disparador (inicio) */}
          <button
            type="button"
            className={"ast-trigger" + (sel?.kind === "hub" ? " ast-on" : "")}
            style={{ ["--i" as string]: 0 }}
            onClick={() => {
              setSel({ kind: "hub" });
              setAdding(false);
            }}
          >
            <span className="ast-trigger__ico">
              <TrigIcon size={20} strokeWidth={1.9} />
            </span>
            <span className="ast-trigger__body">
              <span className="ast-kicker">Cuándo pasa esto</span>
              <span className="ast-trigger__label">{trig.label}</span>
            </span>
            {isIncomplete(trig.fields, rule.trigger.params) && (
              <span className="ast-warn" title="Falta configurar">
                <AlertTriangle size={14} strokeWidth={2.2} />
              </span>
            )}
          </button>

          <span className="ast-spine" />

          {/* Filtro (condiciones) */}
          <button
            type="button"
            className={"ast-filter" + (sel?.kind === "conditions" ? " ast-on" : "")}
            style={{ ["--i" as string]: 1 }}
            onClick={() => {
              setSel({ kind: "conditions" });
              setAdding(false);
            }}
          >
            <span className="ast-filter__ico">
              <Filter size={13} strokeWidth={2.3} />
            </span>
            <span className="ast-filter__txt">
              <b>Solo si</b>{" "}
              {conds.length
                ? `${conds.length} ${conds.length === 1 ? "condición" : "condiciones"}`
                : "· se ejecuta siempre"}
            </span>
          </button>

          <span className="ast-spine" />

          {/* Acciones (numeradas, de arriba a abajo) */}
          {actions.length === 0 && (
            <div className="ast-empty-hint">
              Todavía no hay acciones. Agrega la primera abajo 👇
            </div>
          )}
          {actions.map((a, i) => {
            const def = ACTION_DEFS[a.type];
            const Icn = def.icon;
            const c = colorForAction(a.type);
            const on = sel?.kind === "action" && sel.index === i;
            const sum = summarize(a, ctx);
            const last = i === actions.length - 1;
            const incomplete = isIncomplete(def.fields, a.params);
            const condCount = a.conditions?.length || 0;
            return (
              <Fragment key={i}>
                <div
                  className={
                    "ast-card" +
                    (on ? " ast-on" : "") +
                    (dragIdx === i ? " ast-card--drag" : "") +
                    (overIdx === i && dragIdx !== null && dragIdx !== i ? " ast-card--over" : "")
                  }
                  style={{ ["--arb-c" as string]: c, ["--i" as string]: i + 2 }}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(e) => {
                    setDragIdx(i);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (overIdx !== i) setOverIdx(i);
                  }}
                  onDragLeave={() => setOverIdx((v) => (v === i ? null : v))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIdx !== null) reorder(dragIdx, i);
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setOverIdx(null);
                  }}
                  onClick={() => {
                    setSel({ kind: "action", index: i });
                    setAdding(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSel({ kind: "action", index: i });
                    }
                  }}
                >
                  <span className="ast-card__grip" aria-hidden>
                    <GripVertical size={15} />
                  </span>
                  <span className="ast-card__num">{i + 1}</span>
                  <span className="ast-card__ico">
                    <Icn size={17} strokeWidth={1.9} />
                  </span>
                  <span className="ast-card__body">
                    <span className="ast-card__label">{def.label}</span>
                    {sum && <span className="ast-card__sum">{sum}</span>}
                  </span>
                  {condCount > 0 && (
                    <span
                      className="ast-card__if"
                      title={`Solo corre si se cumplen ${condCount} condición(es)`}
                    >
                      <Filter size={11} strokeWidth={2.4} /> si {condCount}
                    </span>
                  )}
                  {incomplete && (
                    <span className="ast-warn" title="Falta configurar">
                      <AlertTriangle size={14} strokeWidth={2.2} />
                    </span>
                  )}
                  <span className="ast-card__tools" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="arb-tool"
                      title="Subir"
                      disabled={i === 0}
                      onClick={() => moveAction(i, -1)}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="arb-tool"
                      title="Bajar"
                      disabled={last}
                      onClick={() => moveAction(i, 1)}
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      type="button"
                      className="arb-tool arb-tool--danger"
                      title="Quitar"
                      onClick={() => removeAction(i)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
                <span className="ast-spine" />
              </Fragment>
            );
          })}

          {/* Agregar acción */}
          <div className="ast-addwrap" style={{ ["--i" as string]: actions.length + 2 }}>
            <button
              type="button"
              className={"ast-add" + (adding ? " ast-on" : "")}
              onClick={() => {
                setAdding((v) => !v);
                setSel(null);
              }}
            >
              <Plus size={16} strokeWidth={2.4} /> Agregar acción
            </button>
            {adding && (
              <div className="ast-menu" onClick={(e) => e.stopPropagation()}>
                {ACTION_ORDER.map((t) => {
                  const d = ACTION_DEFS[t];
                  const Icn = d.icon;
                  return (
                    <button
                      key={t}
                      type="button"
                      className="ast-menu__item"
                      style={{ ["--arb-c" as string]: colorForAction(t) }}
                      onClick={() => addAction(t)}
                    >
                      <span className="ast-menu__ico">
                        <Icn size={14} />
                      </span>
                      <span className="ast-menu__label">{d.label}</span>
                      <span className="ast-menu__desc">{d.description}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════ INSPECTOR ═══════════ */}
      <aside className="arb-inspect">
        {sel?.kind === "hub" && (
          <div className="arb-ins">
            <div className="arb-ins__head" style={{ ["--arb-c" as string]: "var(--gold)" }}>
              <span className="arb-ins__ico">
                <TrigIcon size={16} />
              </span>
              <div>
                <div className="arb-ins__kicker">Cuándo — disparador</div>
                <div className="arb-ins__title">{trig.label}</div>
              </div>
            </div>
            <p className="arb-ins__desc">{trig.description}</p>
            <div className="arb-ins__section">Tipo de disparador</div>
            <div className="arb-picks">
              {TRIGGER_ORDER.map((t) => {
                const d = TRIGGER_DEFS[t];
                const Icn = d.icon;
                const active = rule.trigger.type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    className={"arb-pick" + (active ? " arb-pick--on" : "")}
                    style={{ ["--arb-c" as string]: d.accent }}
                    onClick={() => onChange({ ...rule, trigger: { type: t, params: {} } })}
                  >
                    <span className="arb-pick__ico">
                      <Icn size={14} />
                    </span>
                    <span className="arb-pick__body">
                      <span className="arb-pick__label">{d.label}</span>
                      <span className="arb-pick__desc">{d.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {trig.fields.length > 0 && (
              <>
                <div className="arb-ins__section">Ajustes</div>
                <FieldsBlock
                  fields={trig.fields}
                  params={rule.trigger.params || {}}
                  onParams={(p) => onChange({ ...rule, trigger: { ...rule.trigger, params: p } })}
                  ctx={ctx}
                  accent="var(--gold)"
                />
              </>
            )}
          </div>
        )}

        {sel?.kind === "conditions" && (
          <div className="arb-ins">
            <div className="arb-ins__head" style={{ ["--arb-c" as string]: "var(--iris)" }}>
              <span className="arb-ins__ico">
                <Filter size={16} />
              </span>
              <div>
                <div className="arb-ins__kicker">Solo si — filtro</div>
                <div className="arb-ins__title">Condiciones</div>
              </div>
            </div>
            <p className="arb-ins__desc">
              La regla solo corre si <b>todas</b> se cumplen. Sin condiciones = se ejecuta siempre
              que dispare.
            </p>
            <ConditionsEditor
              conds={conds}
              stages={ctx.stages}
              onChange={(next) => onChange({ ...rule, conditions: next })}
            />
          </div>
        )}

        {sel?.kind === "action" &&
          (() => {
            const i = sel.index;
            const a = actions[i];
            if (!a) return null;
            const def = ACTION_DEFS[a.type];
            const Icn = def.icon;
            const c = colorForAction(a.type);
            return (
              <div className="arb-ins">
                <div className="arb-ins__head" style={{ ["--arb-c" as string]: c }}>
                  <span className="arb-ins__ico">
                    <Icn size={16} />
                  </span>
                  <div>
                    <div className="arb-ins__kicker">Acción {i + 1}</div>
                    <div className="arb-ins__title">{def.label}</div>
                  </div>
                  <div className="arb-ins__tools">
                    <button
                      type="button"
                      className="arb-tool"
                      title="Subir en el orden"
                      disabled={i === 0}
                      onClick={() => moveAction(i, -1)}
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      type="button"
                      className="arb-tool"
                      title="Bajar en el orden"
                      disabled={i === actions.length - 1}
                      onClick={() => moveAction(i, 1)}
                    >
                      <ChevronDown size={15} />
                    </button>
                    <button
                      type="button"
                      className="arb-tool"
                      title="Duplicar acción"
                      onClick={() => dupAction(i)}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      className="arb-tool arb-tool--danger"
                      title="Quitar acción"
                      onClick={() => removeAction(i)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="arb-ins__section">Tipo de acción</div>
                <WfSelect
                  value={a.type}
                  onChange={(nv) => setActionType(i, nv as ActionType)}
                  options={ACTION_ORDER.map((t) => ({ value: t, label: ACTION_DEFS[t].label }))}
                  style={{ width: "100%", fontWeight: 650 }}
                />
                <p className="arb-ins__desc" style={{ marginTop: 10 }}>
                  {def.description}
                </p>
                {def.fields.length > 0 && (
                  <>
                    <div className="arb-ins__section">Configuración</div>
                    <FieldsBlock
                      fields={def.fields}
                      params={a.params || {}}
                      onParams={(p) => setActionParams(i, p)}
                      ctx={ctx}
                      accent={c}
                    />
                  </>
                )}
                <div className="arb-ins__section">Solo si (rama de esta acción)</div>
                <p className="arb-ins__desc" style={{ margin: "0 0 8px" }}>
                  Esta acción solo corre si se cumplen estas condiciones (además del filtro de la
                  regla). Vacío = corre siempre.
                </p>
                <ConditionsEditor
                  conds={a.conditions || []}
                  stages={ctx.stages}
                  onChange={(next) => setActionConditions(i, next)}
                />
              </div>
            );
          })()}

        {!sel && (
          <div className="arb-ins arb-ins--empty">
            <div className="arb-empty__ico">
              <Plus size={20} />
            </div>
            <div className="arb-empty__title">Selecciona un paso</div>
            <p className="arb-empty__desc">
              Toca el <b>disparador</b> arriba, el <b>filtro</b>, o una <b>acción</b> del espinazo
              para configurarla. Usa <b>Agregar acción</b> para sumar pasos a la secuencia.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

/** Editor de condiciones (field · operador · valor) — reusa CONDITION_OPS/FIELDS. */
function ConditionsEditor({
  conds,
  stages,
  onChange,
}: {
  conds: RuleCondition[];
  stages: Array<{ id: string; label: string }>;
  onChange: (next: RuleCondition[]) => void;
}) {
  return (
    <div className="arb-conds">
      {conds.map((c, i) => {
        const needsValue = CONDITION_OPS.find((o) => o.value === c.op)?.needsValue ?? true;
        return (
          <div key={i} className="arb-cond">
            <WfSelect
              value={c.field}
              onChange={(nf) => {
                const next = [...conds];
                next[i] = { ...c, field: nf as RuleCondition["field"] };
                onChange(next);
              }}
              options={CONDITION_FIELDS.map((f) => ({ value: f.value, label: f.label }))}
              style={{ width: "100%" }}
            />
            <div className="arb-cond__row">
              <WfSelect
                value={c.op}
                onChange={(op) => {
                  const next = [...conds];
                  next[i] = { ...c, op: op as RuleCondition["op"] };
                  onChange(next);
                }}
                options={CONDITION_OPS.map((o) => ({ value: o.value, label: o.label }))}
                style={{ flex: "0 0 148px" }}
              />
              {needsValue &&
                (c.field === "stageId" ? (
                  <WfSelect
                    value={c.value}
                    onChange={(nv) => {
                      const next = [...conds];
                      next[i] = { ...c, value: nv };
                      onChange(next);
                    }}
                    options={[
                      { value: "", label: "— elige —" },
                      ...stages.map((s) => ({ value: s.id, label: s.label })),
                    ]}
                    style={{ flex: 1 }}
                  />
                ) : (
                  <input
                    className="wf-input"
                    style={{ flex: 1 }}
                    value={c.value}
                    placeholder={c.field === "valoracion" ? "positiva / negativa" : "valor"}
                    onChange={(e) => {
                      const next = [...conds];
                      next[i] = { ...c, value: e.target.value };
                      onChange(next);
                    }}
                  />
                ))}
              <button
                type="button"
                className="arb-tool arb-tool--danger"
                title="Quitar condición"
                onClick={() => onChange(conds.filter((_, j) => j !== i))}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="arb-cond-add"
        onClick={() => onChange([...conds, { field: "source", op: "eq", value: "" }])}
      >
        <Plus size={14} /> Agregar condición
      </button>
    </div>
  );
}
