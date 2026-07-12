import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Plus, Copy, X, ChevronUp, ChevronDown, Filter } from "lucide-react";
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
 * AutomationRadialBuilder — el builder de Automatizaciones como HUB RADIAL.
 *
 * Identidad visual DELIBERADAMENTE distinta a los otros dos builders:
 *  · Bots      = canvas horizontal con nodos-rectángulo (React Flow, cables cyan).
 *  · Journeys  = state cards verticales estilo AWS Step Functions (línea de vida verde).
 *  · Automatizaciones (este) = HUB RADIAL: el disparador es un núcleo GOLD al centro
 *    y las acciones orbitan como satélites unidos por rayos. Layout radial (ni H ni V),
 *    lienzo custom (SVG spokes + nodos absolutos), no React Flow → distinto hasta en la
 *    tecnología. El modelo de datos NO cambia (trigger → filtro → acciones en orden);
 *    solo cambia la representación/edición.
 *
 * El número en cada satélite = su ORDEN de ejecución (las acciones corren en secuencia).
 */

type Sel = { kind: "hub" } | { kind: "conditions" } | { kind: "action"; index: number } | null;

export function AutomationRadialBuilder({
  rule,
  onChange,
  ctx,
}: {
  rule: AutomationRule;
  onChange: (r: AutomationRule) => void;
  ctx: PickersCtx;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [sel, setSel] = useState<Sel>({ kind: "hub" });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const actions = rule.actions || [];
  const conds = rule.conditions || [];
  const trig = TRIGGER_DEFS[rule.trigger.type];
  const TrigIcon = trig.icon;

  // ── Geometría radial ──
  // Hub al centro; N satélites (acciones) + 1 nodo "+add" repartidos en círculo,
  // empezando arriba (-90°) y girando en sentido horario. El radio crece con el
  // conteo para que no se amontonen.
  const geo = useMemo(() => {
    const { w, h } = size;
    const cx = w / 2;
    const cy = h / 2;
    const slots = actions.length + 1; // +1 = nodo de agregar
    const spread = Math.min(w, h);
    const R = Math.max(140, spread * 0.37);
    const pts = Array.from({ length: slots }, (_, i) => {
      const ang = ((-90 + (360 / slots) * i) * Math.PI) / 180;
      return { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
    });
    return { cx, cy, R, pts };
  }, [size, actions.length]);

  // ── Handlers (mismo modelo que la receta clásica) ──
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

  const ready = size.w > 40 && size.h > 40;
  const addPt = geo.pts[actions.length];

  return (
    <div className="arb">
      {/* ═══════════ LIENZO RADIAL ═══════════ */}
      <div
        className="arb-stage"
        ref={stageRef}
        onClick={() => {
          setSel(null);
          setAdding(false);
        }}
      >
        {/* Rayos + anillos guía (SVG detrás de los nodos). */}
        {ready && (
          <svg className="arb-wires" width={size.w} height={size.h} aria-hidden>
            <defs>
              <radialGradient id="arb-ring" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.10" />
                <stop offset="70%" stopColor="var(--gold)" stopOpacity="0.03" />
                <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="arb-spoke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.9" />
                <stop offset="100%" stopColor="var(--gold)" stopOpacity="0.35" />
              </linearGradient>
            </defs>
            {/* Anillos concéntricos guía. */}
            <circle cx={geo.cx} cy={geo.cy} r={geo.R} fill="url(#arb-ring)" />
            <circle
              cx={geo.cx}
              cy={geo.cy}
              r={geo.R}
              fill="none"
              stroke="var(--gold)"
              strokeOpacity="0.14"
              strokeDasharray="2 7"
            />
            <circle
              cx={geo.cx}
              cy={geo.cy}
              r={geo.R * 0.5}
              fill="none"
              stroke="var(--border-strong)"
              strokeOpacity="0.5"
            />
            {/* Rayos hub → cada acción (sólidos) y hub → "+add" (punteado). */}
            {geo.pts.map((p, i) => {
              const isAdd = i === actions.length;
              return (
                <line
                  key={i}
                  className={"arb-spoke" + (isAdd ? " arb-spoke--add" : "")}
                  x1={geo.cx}
                  y1={geo.cy}
                  x2={p.x}
                  y2={p.y}
                  stroke={isAdd ? "var(--border-strong)" : "url(#arb-spoke)"}
                  strokeWidth={isAdd ? 1.5 : 2.5}
                  strokeDasharray={isAdd ? "4 6" : undefined}
                />
              );
            })}
          </svg>
        )}

        {ready && (
          <>
            {/* ── HUB central = disparador ── */}
            <button
              type="button"
              className={"arb-hub" + (sel?.kind === "hub" ? " arb-hub--on" : "")}
              style={{ left: geo.cx, top: geo.cy }}
              onClick={(e) => {
                e.stopPropagation();
                setSel({ kind: "hub" });
                setAdding(false);
              }}
            >
              <span className="arb-hub__ring" />
              <span className="arb-hub__ico">
                <TrigIcon size={30} strokeWidth={1.8} />
              </span>
              <span className="arb-hub__kicker">Cuándo</span>
              <span className="arb-hub__label">{trig.label}</span>
            </button>

            {/* Collar de filtro (condiciones) colgando del hub. */}
            <button
              type="button"
              className={"arb-filter" + (sel?.kind === "conditions" ? " arb-filter--on" : "")}
              style={{ left: geo.cx, top: geo.cy + Math.max(84, geo.R * 0.34) }}
              onClick={(e) => {
                e.stopPropagation();
                setSel({ kind: "conditions" });
                setAdding(false);
              }}
            >
              <Filter size={12} strokeWidth={2.4} />
              {conds.length === 0
                ? "Sin filtro · siempre"
                : `${conds.length} ${conds.length === 1 ? "condición" : "condiciones"}`}
            </button>

            {/* ── Satélites = acciones ── */}
            {actions.map((a, i) => {
              const def = ACTION_DEFS[a.type];
              const Icn = def.icon;
              const c = colorForAction(a.type);
              const p = geo.pts[i];
              const on = sel?.kind === "action" && sel.index === i;
              return (
                <button
                  key={i}
                  type="button"
                  className={"arb-sat" + (on ? " arb-sat--on" : "")}
                  style={{
                    left: p.x,
                    top: p.y,
                    ["--arb-c" as string]: c,
                    ["--i" as string]: i,
                    ["--dx" as string]: `${geo.cx - p.x}px`,
                    ["--dy" as string]: `${geo.cy - p.y}px`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSel({ kind: "action", index: i });
                    setAdding(false);
                  }}
                >
                  <span className="arb-sat__num">{i + 1}</span>
                  <span className="arb-sat__disc">
                    <Icn size={22} strokeWidth={1.9} />
                  </span>
                  <span className="arb-sat__label">{def.label}</span>
                </button>
              );
            })}

            {/* ── Nodo "+ agregar acción" ── */}
            <button
              type="button"
              className={"arb-add" + (adding ? " arb-add--on" : "")}
              style={{
                left: addPt.x,
                top: addPt.y,
                ["--i" as string]: actions.length,
                ["--dx" as string]: `${geo.cx - addPt.x}px`,
                ["--dy" as string]: `${geo.cy - addPt.y}px`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                setAdding((v) => !v);
                setSel(null);
              }}
            >
              <Plus size={22} strokeWidth={2.4} />
              <span className="arb-add__label">Agregar</span>
            </button>

            {/* Menú de acciones (popover anclado al nodo +). */}
            {adding && (
              <div
                className="arb-menu"
                style={{
                  left: Math.min(Math.max(addPt.x, 120), size.w - 120),
                  top: Math.min(addPt.y + 44, size.h - 20),
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="arb-menu__title">Agregar acción</div>
                {ACTION_ORDER.map((t) => {
                  const d = ACTION_DEFS[t];
                  const Icn = d.icon;
                  return (
                    <button
                      key={t}
                      type="button"
                      className="arb-menu__item"
                      style={{ ["--arb-c" as string]: colorForAction(t) }}
                      onClick={() => addAction(t)}
                    >
                      <span className="arb-menu__ico">
                        <Icn size={14} />
                      </span>
                      {d.label}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
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
              </div>
            );
          })()}

        {!sel && (
          <div className="arb-ins arb-ins--empty">
            <div className="arb-empty__ico">
              <Plus size={20} />
            </div>
            <div className="arb-empty__title">Selecciona un nodo</div>
            <p className="arb-empty__desc">
              Toca el <b>núcleo</b> para elegir el disparador, el <b>collar</b> para filtrar, o un{" "}
              <b>satélite</b> para configurar una acción. Usa <b>Agregar</b> para sumar acciones a
              la órbita.
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
