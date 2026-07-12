import { useEffect, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getApiEndpoints } from "@/lib/api";
import { EmptyState } from "@/components/ui/empty-state";
import { FeatureCompare, FeatureCompareButton } from "@/components/aria/FeatureCompare";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { useUsers } from "@/hooks/useUsers";
import { useJourneys } from "@/hooks/useJourneys";
import { usePrograms } from "@/hooks/usePrograms";
import {
  ACTION_DEFS,
  ACTION_ORDER,
  CONDITION_FIELDS,
  CONDITION_OPS,
  RULE_TEMPLATES,
  TRIGGER_DEFS,
  TRIGGER_ORDER,
  type ActionType,
  type AutomationRule,
  type AutomationRun,
  type FieldDef,
  type RuleCondition,
  type RuleTestResult,
  type TriggerType,
} from "@/lib/automations";
import type { WaTemplate } from "@/components/whatsapp/WaTemplateConfigurator";
import { WebhookDeliveriesPanel } from "@/components/automations/WebhookDeliveriesPanel";
import { Icon, Btn, Stat, Pill, HeroBand, Num } from "@/components/aria";

/**
 * AutomationsPage — /automations (#15, "Digital Pipeline" de ARIA).
 *
 * El editor es una RECETA VERTICAL (estilo HubSpot Workflows / Zapier /
 * ActiveCampaign): DISPARADOR → conector → CONDICIONES → conector → ACCIONES
 * apiladas y numeradas, de arriba abajo. Se distingue a propósito del canvas
 * HORIZONTAL con nodos arrastrables de los Bots: aquí el flujo es lineal y
 * editable, sin handles. El acento es GOLD (var(--gold)); cada acción se tiñe
 * por su tipo para dar variedad.
 *
 * Toda la lógica de datos (load/save/delete/runs/testRule/toggle/plantillas)
 * se conserva intacta — el motor (manage-automations + automation-engine)
 * valida contra los mismos type strings. Las reglas NO se encadenan entre sí.
 */

/** Color por TIPO de acción — variedad visual en la receta. */
const ACTION_COLOR: Record<ActionType, string> = {
  send_email: "var(--gold)",
  apply_tag: "var(--cyan)",
  remove_tag: "var(--gold)",
  apply_attribute: "var(--iris)",
  apply_score: "var(--iris)",
  set_program: "var(--cyan)",
  unsubscribe: "var(--coral)",
  notify_agent: "var(--coral)",
  send_whatsapp_template: "var(--green)",
  move_stage: "var(--accent)",
  webhook: "var(--text-3)",
  schedule_callback: "var(--gold)",
  start_journey: "var(--green)",
};
const colorForAction = (t: ActionType): string => ACTION_COLOR[t] ?? "var(--accent)";

interface PickersCtx {
  stages: Array<{ id: string; label: string }>;
  templates: WaTemplate[];
  agents: Array<{ userId: string; username: string }>;
  journeys: Array<{ journeyId: string; name: string; status: string }>;
  programs: Array<{ id: string; name: string }>;
}

const WF_NONE = "__wfnone__";
/** Select del kit para los campos del builder (reemplaza los `<select className="wf-input">`
 *  nativos). Mapea la opción vacía ("") a un sentinel porque base-ui trata "" como
 *  placeholder; el label del valor actual va como hijo de SelectValue (no se auto-renderiza). */
function WfSelect({
  value,
  onChange,
  options,
  className,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  style?: CSSProperties;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Select
      value={value === "" ? WF_NONE : value}
      onValueChange={(nv) => onChange(!nv || nv === WF_NONE ? "" : nv)}
    >
      <SelectTrigger className={className} style={style}>
        <SelectValue>{current?.label ?? "—"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value || WF_NONE} value={o.value === "" ? WF_NONE : o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Renderiza un campo (FieldDef) según su tipo — fuente única para trigger y acciones. */
function FieldInput({
  field,
  value,
  onChange,
  ctx,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  ctx: PickersCtx;
}) {
  const v = value ?? field.defaultValue ?? "";
  if (field.type === "stage") {
    return (
      <WfSelect
        value={String(v)}
        onChange={onChange}
        className="w-full"
        options={[
          { value: "", label: "— cualquiera —" },
          ...ctx.stages.map((s) => ({ value: s.id, label: s.label })),
        ]}
      />
    );
  }
  if (field.type === "template") {
    return (
      <WfSelect
        value={String(v)}
        onChange={onChange}
        className="w-full"
        options={[
          { value: "", label: "— elige una plantilla —" },
          ...ctx.templates.map((t) => ({
            value: t.name,
            label: `${t.name}${t.variableCount ? ` · ${t.variableCount} var` : ""}`,
          })),
        ]}
      />
    );
  }
  if (field.type === "agent") {
    // Agent-picker si hay agentes cargados; si no, cae a input de texto (userId)
    // para no romper el default y permitir configurar sin la lista disponible.
    if (ctx.agents.length > 0) {
      return (
        <WfSelect
          value={String(v)}
          onChange={onChange}
          className="w-full"
          options={[
            { value: "", label: "— sin asignar —" },
            ...ctx.agents.map((a) => ({ value: a.userId, label: a.username })),
          ]}
        />
      );
    }
    return (
      <input
        className="wf-input"
        value={String(v)}
        placeholder={field.placeholder || "userId del agente (opcional)"}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === "journey") {
    return (
      <WfSelect
        value={String(v)}
        onChange={onChange}
        className="w-full"
        options={[
          { value: "", label: "— elige un journey —" },
          ...ctx.journeys.map((j) => ({
            value: j.journeyId,
            label: `${j.name || "(sin nombre)"}${j.status !== "active" ? ` · ${j.status}` : ""}`,
          })),
        ]}
      />
    );
  }
  if (field.type === "program") {
    // Program-picker si hay programas; si no, cae a input de texto (programId)
    // para poder configurar la regla aunque la lista aún no cargue.
    if (ctx.programs.length > 0) {
      return (
        <WfSelect
          value={String(v)}
          onChange={onChange}
          className="w-full"
          options={[
            { value: "", label: "— elige un programa —" },
            ...ctx.programs.map((pr) => ({ value: pr.id, label: pr.name || pr.id })),
          ]}
        />
      );
    }
    return (
      <input
        className="wf-input"
        value={String(v)}
        placeholder={field.placeholder || "ID del programa"}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === "select") {
    return (
      <WfSelect
        value={String(v)}
        onChange={onChange}
        className="w-full"
        options={(field.options || []).map((o) => ({ value: o.value, label: o.label }))}
      />
    );
  }
  if (field.type === "textarea") {
    return (
      <textarea
        className="wf-input wf-input--area"
        rows={4}
        value={String(v)}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === "number") {
    return (
      <input
        type="number"
        className="wf-input"
        value={String(v)}
        min={0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }
  if (field.type === "variables") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <input
        className="wf-input"
        value={arr.join(", ")}
        placeholder="{{name}}, valor fijo, {{phone}}"
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    );
  }
  return (
    <input
      className="wf-input"
      value={String(v)}
      placeholder={field.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Rejilla de campos (label + hint + control) de un trigger/acción. */
function FieldsBlock({
  fields,
  params,
  onParams,
  ctx,
  accent,
}: {
  fields: FieldDef[];
  params: Record<string, unknown>;
  onParams: (p: Record<string, unknown>) => void;
  ctx: PickersCtx;
  accent: string;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="wf-fields" style={{ ["--wf-c" as string]: accent }}>
      {fields.map((f) => (
        <label
          key={f.key}
          className={"wf-field" + (f.type === "textarea" ? " wf-field--wide" : "")}
        >
          <span className="wf-field__label">
            {f.label}
            {f.required && <span style={{ color: "var(--red)" }}> *</span>}
          </span>
          <FieldInput
            field={f}
            value={params[f.key]}
            onChange={(v) => onParams({ ...params, [f.key]: v })}
            ctx={ctx}
          />
          {f.hint && <span className="wf-field__hint">{f.hint}</span>}
        </label>
      ))}
    </div>
  );
}

/** Conector vertical entre bloques de la receta (línea + ● gold + etiqueta). */
function Connector({ label }: { label: string }) {
  return (
    <div className="wf-connector" aria-hidden>
      <span className="wf-connector__line" />
      <span className="wf-connector__dot" />
      <span className="wf-connector__label">{label}</span>
      <span className="wf-connector__line" />
    </div>
  );
}

/** Bloque-paso de la receta: kicker + título + cuerpo, con acento por color. */
function Step({
  kicker,
  title,
  accent,
  icon,
  right,
  children,
}: {
  kicker: string;
  title: React.ReactNode;
  accent: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="wf-step" style={{ ["--wf-c" as string]: accent }}>
      <header className="wf-step__head">
        {icon && <span className="wf-step__ico">{icon}</span>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="wf-step__kicker">{kicker}</div>
          <div className="wf-step__title">{title}</div>
        </div>
        {right}
      </header>
      <div className="wf-step__body">{children}</div>
    </section>
  );
}

export function AutomationsPage() {
  const ep = getApiEndpoints();
  const { confirm, confirmDialog } = useConfirm();
  const { tree } = useTaxonomy();
  const { users } = useUsers();
  const { journeys } = useJourneys();
  const { programs } = usePrograms();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [waTemplates, setWaTemplates] = useState<WaTemplate[]>([]);
  const [runsFor, setRunsFor] = useState<AutomationRule | null>(null);
  const [runs, setRuns] = useState<AutomationRun[] | null>(null);
  const [showWebhooks, setShowWebhooks] = useState(false);
  // Dry-run ("Probar regla") — leadId opcional + resultado del testRule.
  const [testFor, setTestFor] = useState<AutomationRule | null>(null);
  const [testLeadId, setTestLeadId] = useState("");
  const [testResult, setTestResult] = useState<RuleTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  // React Compiler: cálculo directo (sin useMemo). Se re-deriva por render.
  const ctx: PickersCtx = {
    stages: tree.map((s) => ({ id: s.id, label: s.label })),
    templates: waTemplates,
    agents: users
      .filter((u) => u.userId)
      .map((u) => ({ userId: u.userId as string, username: u.username })),
    journeys: journeys.map((j) => ({ journeyId: j.journeyId, name: j.name, status: j.status })),
    programs: programs.map((pr) => ({ id: pr.programId, name: pr.name })),
  };

  const load = async () => {
    if (!ep?.manageAutomations) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(ep.manageAutomations);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "error");
      setRules(Array.isArray(d.rules) ? d.rules : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron cargar las reglas");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ep?.listWhatsAppTemplates) return;
    fetch(ep.listWhatsAppTemplates)
      .then((r) => r.json())
      .then((j) => setWaTemplates(j.templates || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (rule: AutomationRule) => {
    if (!ep?.manageAutomations) return;
    if (!rule.name.trim()) {
      toast.error("Pon un nombre");
      return;
    }
    if (rule.actions.length === 0) {
      toast.error("Agrega al menos una acción");
      return;
    }
    for (const a of rule.actions) {
      for (const f of ACTION_DEFS[a.type].fields) {
        if (f.required && !a.params?.[f.key]) {
          toast.error(`Falta "${f.label}" en la acción ${ACTION_DEFS[a.type].label}`);
          return;
        }
      }
    }
    setSaving(true);
    try {
      const r = await fetch(ep.manageAutomations, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      const d = await r.json();
      if (!r.ok || !d.saved) throw new Error(d?.error || "no se pudo guardar");
      toast.success("Automatización guardada");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (rule: AutomationRule) => {
    await save({ ...rule, enabled: !rule.enabled });
  };

  const remove = async (rule: AutomationRule) => {
    if (!ep?.manageAutomations || !rule.ruleId) return;
    const okd = await confirm({
      title: `¿Eliminar "${rule.name}"?`,
      description: "Las ejecuciones pasadas se conservan hasta expirar.",
      destructive: true,
      confirmLabel: "Eliminar",
    });
    if (!okd) return;
    try {
      await fetch(`${ep.manageAutomations}?ruleId=${encodeURIComponent(rule.ruleId)}`, {
        method: "DELETE",
      });
      toast.success("Automatización eliminada");
      load();
    } catch {
      toast.error("No se pudo eliminar");
    }
  };

  const openRuns = async (rule: AutomationRule) => {
    if (!ep?.manageAutomations || !rule.ruleId) return;
    setRunsFor(rule);
    setRuns(null);
    try {
      const r = await fetch(`${ep.manageAutomations}?runs=${encodeURIComponent(rule.ruleId)}`);
      const d = await r.json();
      setRuns(Array.isArray(d.runs) ? d.runs : []);
    } catch {
      setRuns([]);
    }
  };

  // Abre el modal de dry-run. Si la regla no está guardada aún (sin ruleId),
  // avisa: testRule corre server-side contra la regla persistida.
  const openTest = (rule: AutomationRule) => {
    setTestFor(rule);
    setTestLeadId("");
    setTestResult(null);
  };

  const runTest = async () => {
    if (!ep?.manageAutomations || !testFor?.ruleId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch(ep.manageAutomations, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "testRule",
          ruleId: testFor.ruleId,
          ...(testLeadId.trim() ? { leadId: testLeadId.trim() } : {}),
        }),
      });
      const d = (await r.json()) as RuleTestResult;
      if (!r.ok) throw new Error(d?.error || "no se pudo probar");
      setTestResult(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al probar la regla");
    } finally {
      setTesting(false);
    }
  };

  // ── Editor · receta vertical ──
  if (editing) {
    const trig = TRIGGER_DEFS[editing.trigger.type];
    const TrigIcn = trig.icon;
    const conds = editing.conditions || [];
    return (
      <div className="page wf-page">
        <HeroBand
          right={
            <div className="row gap10">
              <Btn variant="ghost" size="sm" icon="chevL" onClick={() => setEditing(null)}>
                Volver
              </Btn>
              <Btn
                variant="primary"
                size="sm"
                icon="check"
                disabled={saving}
                onClick={() => save(editing)}
              >
                {saving ? "Guardando…" : "Guardar"}
              </Btn>
            </div>
          }
        />

        {/* Cabecera del editor: nombre + estado + probar */}
        <div className="wf-editor-head">
          <div className="wf-editor-title">
            <span className="wf-editor-badge">
              <Icon name="zap" size={13} weight="bold" />
              Receta
            </span>
            <input
              className="wf-name"
              value={editing.name}
              placeholder="Nombre de la automatización"
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </div>
          <div className="row gap8">
            {editing.ruleId && (
              <Btn variant="ghost" size="sm" icon="play" onClick={() => openTest(editing)}>
                Probar regla
              </Btn>
            )}
            <Btn
              variant={editing.enabled ? "primary" : "subtle"}
              size="sm"
              icon={editing.enabled ? "check" : "pause"}
              onClick={() => setEditing({ ...editing, enabled: !editing.enabled })}
              title="Las reglas pausadas no se ejecutan"
            >
              {editing.enabled ? "Activa" : "Pausada"}
            </Btn>
          </div>
        </div>

        <p className="wf-lead">
          Se lee de arriba hacia abajo: <b>cuándo</b> pasa algo, <b>solo si</b> se cumplen las
          condiciones, <b>entonces</b> ARIA ejecuta las acciones en orden. Las reglas no se
          encadenan entre sí.
        </p>

        {/* ═══ LIENZO VERTICAL ═══ */}
        <div className="wf-canvas">
          {/* DISPARADOR */}
          <Step
            kicker="Cuándo"
            title="Disparador"
            accent="var(--gold)"
            icon={<TrigIcn size={17} />}
          >
            <div className="wf-triggers">
              {TRIGGER_ORDER.map((t) => {
                const d = TRIGGER_DEFS[t];
                const Icn = d.icon;
                const active = editing.trigger.type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setEditing({ ...editing, trigger: { type: t, params: {} } })}
                    className={"wf-pick" + (active ? " wf-pick--on" : "")}
                    style={{ ["--wf-c" as string]: d.accent }}
                  >
                    <span className="wf-pick__ico">
                      <Icn size={15} />
                    </span>
                    <span className="wf-pick__body">
                      <span className="wf-pick__label">{d.label}</span>
                      <span className="wf-pick__desc">{d.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <FieldsBlock
              fields={trig.fields}
              params={editing.trigger.params || {}}
              onParams={(p) =>
                setEditing({ ...editing, trigger: { ...editing.trigger, params: p } })
              }
              ctx={ctx}
              accent="var(--gold)"
            />
          </Step>

          <Connector label="solo si" />

          {/* CONDICIONES */}
          <Step
            kicker="Solo si"
            title="Condiciones"
            accent="var(--iris)"
            icon={<Icon name="filter" size={16} />}
          >
            {conds.length === 0 ? (
              <div className="wf-empty-cond">
                Sin condiciones — la regla <b>se ejecuta siempre</b> que dispare.
              </div>
            ) : (
              <div className="wf-conds">
                {conds.map((c, i) => (
                  <div key={i} className="wf-cond">
                    <WfSelect
                      value={c.field}
                      onChange={(nf) => {
                        const conditions = [...conds];
                        conditions[i] = { ...c, field: nf as RuleCondition["field"] };
                        setEditing({ ...editing, conditions });
                      }}
                      options={CONDITION_FIELDS.map((f) => ({ value: f.value, label: f.label }))}
                      style={{ flex: "0 0 190px" }}
                    />
                    <WfSelect
                      value={c.op}
                      onChange={(op) => {
                        const conditions = [...conds];
                        conditions[i] = { ...c, op: op as RuleCondition["op"] };
                        setEditing({ ...editing, conditions });
                      }}
                      options={CONDITION_OPS.map((o) => ({ value: o.value, label: o.label }))}
                      style={{ flex: "0 0 158px" }}
                    />
                    {/* El valor sólo aplica a eq/neq/contains; exists/notexists no lo usan. */}
                    {(CONDITION_OPS.find((o) => o.value === c.op)?.needsValue ?? true) &&
                      (c.field === "stageId" ? (
                        <WfSelect
                          value={c.value}
                          onChange={(nv) => {
                            const conditions = [...conds];
                            conditions[i] = { ...c, value: nv };
                            setEditing({ ...editing, conditions });
                          }}
                          options={[
                            { value: "", label: "— elige —" },
                            ...ctx.stages.map((s) => ({ value: s.id, label: s.label })),
                          ]}
                          style={{ flex: 1 }}
                        />
                      ) : (
                        <input
                          className="wf-input"
                          style={{ flex: 1 }}
                          value={c.value}
                          placeholder={
                            c.field === "valoracion" ? "positiva / negativa / neutra" : "valor"
                          }
                          onChange={(e) => {
                            const conditions = [...conds];
                            conditions[i] = { ...c, value: e.target.value };
                            setEditing({ ...editing, conditions });
                          }}
                        />
                      ))}
                    <button
                      type="button"
                      className="wf-icon-btn"
                      aria-label="Quitar condición"
                      onClick={() =>
                        setEditing({
                          ...editing,
                          conditions: conds.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="wf-add"
              onClick={() =>
                setEditing({
                  ...editing,
                  conditions: [...conds, { field: "source", op: "eq", value: "" }],
                })
              }
            >
              <Plus size={14} /> Agregar condición
            </button>
          </Step>

          <Connector label="entonces" />

          {/* ACCIONES */}
          <Step
            kicker="Entonces"
            title="Acciones"
            accent="var(--gold)"
            icon={<Icon name="bolt" size={16} />}
            right={
              <span className="wf-step__count">
                {editing.actions.length} {editing.actions.length === 1 ? "acción" : "acciones"}
              </span>
            }
          >
            {editing.actions.length === 0 && (
              <div className="wf-empty-cond">
                Todavía no hay acciones. Agrega al menos una para poder guardar.
              </div>
            )}
            <div className="wf-actions">
              {editing.actions.map((a, i) => {
                const d = ACTION_DEFS[a.type];
                const Icn = d.icon;
                const c = colorForAction(a.type);
                const last = i === editing.actions.length - 1;
                return (
                  <div key={i} className="wf-action" style={{ ["--wf-c" as string]: c }}>
                    <div className="wf-action__rail">
                      <span className="wf-action__num">{i + 1}</span>
                      {!last && <span className="wf-action__thread" />}
                    </div>
                    <div className="wf-action__card">
                      <div className="wf-action__top">
                        <span className="wf-action__ico">
                          <Icn size={15} />
                        </span>
                        <WfSelect
                          value={a.type}
                          onChange={(nv) => {
                            const nextType = nv as ActionType;
                            const params: Record<string, unknown> = {};
                            for (const f of ACTION_DEFS[nextType].fields)
                              if (f.defaultValue !== undefined) params[f.key] = f.defaultValue;
                            const actions = [...editing.actions];
                            actions[i] = { type: nextType, params };
                            setEditing({ ...editing, actions });
                          }}
                          options={ACTION_ORDER.map((t) => ({
                            value: t,
                            label: ACTION_DEFS[t].label,
                          }))}
                          style={{ flex: 1, fontWeight: 650 }}
                        />
                        <div className="wf-action__moves">
                          <button
                            type="button"
                            className="wf-icon-btn"
                            aria-label="Subir acción"
                            disabled={i === 0}
                            onClick={() => {
                              const actions = [...editing.actions];
                              [actions[i - 1], actions[i]] = [actions[i], actions[i - 1]];
                              setEditing({ ...editing, actions });
                            }}
                          >
                            <Icon name="chevU" size={14} weight="bold" />
                          </button>
                          <button
                            type="button"
                            className="wf-icon-btn"
                            aria-label="Bajar acción"
                            disabled={last}
                            onClick={() => {
                              const actions = [...editing.actions];
                              [actions[i], actions[i + 1]] = [actions[i + 1], actions[i]];
                              setEditing({ ...editing, actions });
                            }}
                          >
                            <Icon name="chevD" size={14} weight="bold" />
                          </button>
                          <button
                            type="button"
                            className="wf-icon-btn wf-icon-btn--danger"
                            aria-label="Quitar acción"
                            onClick={() =>
                              setEditing({
                                ...editing,
                                actions: editing.actions.filter((_, j) => j !== i),
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <p className="wf-action__desc">{d.description}</p>
                      <FieldsBlock
                        fields={d.fields}
                        params={a.params || {}}
                        onParams={(p) => {
                          const actions = [...editing.actions];
                          actions[i] = { ...a, params: p };
                          setEditing({ ...editing, actions });
                        }}
                        ctx={ctx}
                        accent={c}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Paleta para añadir acciones — teñida por tipo */}
            <div className="wf-palette">
              {ACTION_ORDER.map((t) => {
                const d = ACTION_DEFS[t];
                const Icn = d.icon;
                const c = colorForAction(t);
                return (
                  <button
                    key={t}
                    type="button"
                    className="wf-chip"
                    style={{ ["--wf-c" as string]: c }}
                    onClick={() => {
                      const params: Record<string, unknown> = {};
                      for (const f of d.fields)
                        if (f.defaultValue !== undefined) params[f.key] = f.defaultValue;
                      setEditing({
                        ...editing,
                        actions: [...editing.actions, { type: t, params }],
                      });
                    }}
                  >
                    <Icn size={13} />
                    {d.label}
                  </button>
                );
              })}
            </div>
          </Step>
        </div>

        {/* Modal · Probar regla (dry-run) */}
        <TestModal
          rule={testFor}
          leadId={testLeadId}
          onLeadId={setTestLeadId}
          result={testResult}
          testing={testing}
          onRun={runTest}
          onClose={() => setTestFor(null)}
        />

        {confirmDialog}
      </div>
    );
  }

  // ── Picker de plantillas ──
  if (picking) {
    return (
      <div className="page wf-page">
        <HeroBand
          right={
            <Btn variant="ghost" size="sm" icon="chevL" onClick={() => setPicking(false)}>
              Volver
            </Btn>
          }
        />
        <div className="wf-tpl-head">
          <div className="wf-editor-badge" style={{ ["--wf-c" as string]: "var(--gold)" }}>
            <Icon name="sparkle" size={13} weight="bold" />
            Punto de partida
          </div>
          <h2 className="wf-tpl-title">Elige una receta base</h2>
          <p className="wf-lead" style={{ margin: 0 }}>
            Plantillas listas o desde cero — todo es editable después.
          </p>
        </div>
        <div className="wf-tpl-grid">
          {RULE_TEMPLATES.map((t) => {
            const rule = t.build();
            const d = TRIGGER_DEFS[rule.trigger.type];
            const Icn = d.icon;
            return (
              <button
                key={t.id}
                type="button"
                className="wf-tpl"
                style={{ ["--wf-c" as string]: d.accent }}
                onClick={() => {
                  setPicking(false);
                  setEditing(rule);
                }}
              >
                <span className="wf-tpl__ico">
                  <Icn size={18} />
                </span>
                <div className="wf-tpl__name">{t.name}</div>
                <div className="wf-tpl__desc">{t.description}</div>
                <div className="wf-tpl__meta">
                  <Pill tone="gold" icon="zap">
                    {d.label}
                  </Pill>
                  <span className="wf-tpl__actions">
                    {rule.actions.length} {rule.actions.length === 1 ? "acción" : "acciones"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Lista ──
  const kept = rules.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  const activeCount = rules.filter((r) => r.enabled).length;
  const totalRuns = rules.reduce((s, r) => s + (r.firedCount || 0), 0);

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <HeroBand
        right={
          <div className="row gap10">
            <FeatureCompareButton current="automations" />
            <Btn variant="ghost" size="sm" icon="refresh" onClick={load} disabled={loading}>
              Actualizar
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              icon="external"
              onClick={() => setShowWebhooks(true)}
              title="Entregas de webhooks salientes (#17)"
            >
              Webhooks
            </Btn>
            <Btn variant="primary" size="sm" icon="plus" onClick={() => setPicking(true)}>
              Nueva regla
            </Btn>
          </div>
        }
      />

      <div
        className="dim"
        style={{ fontSize: 13, marginTop: -8, marginBottom: 18, maxWidth: 760, lineHeight: 1.55 }}
      >
        Reglas que reaccionan al instante: cuando pasa algo (un lead entra, alguien escribe), ARIA
        ejecuta la acción — sin esperas ni conversación.
      </div>

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
          icon="zap"
          color="var(--gold)"
          label="Reglas totales"
          value={<Num value={rules.length} />}
          sub="triggers configurados"
        />
        <Stat
          icon="check"
          color="var(--green)"
          label="Activas"
          value={<Num value={activeCount} />}
          sub={`${rules.length - activeCount} pausadas`}
        />
        <Stat
          icon="trending"
          color="var(--cyan)"
          label="Ejecuciones"
          value={<Num value={totalRuns} />}
          sub="acumuladas en todas las reglas"
        />
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
            placeholder="Buscar regla…"
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

      {/* Entregas de webhooks (#17) — visibilidad + reintentar */}
      <Modal
        open={showWebhooks}
        onOpenChange={setShowWebhooks}
        title="Entregas de webhooks · retry"
        className="max-w-3xl"
      >
        <div style={{ marginTop: 12, maxHeight: 540, overflow: "auto" }}>
          <WebhookDeliveriesPanel />
        </div>
      </Modal>

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
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <EmptyState
              icon={<Plus />}
              title={
                rules.length === 0 ? "Todavía no hay automatizaciones" : "Ninguna regla coincide"
              }
              description="Reglas que reaccionan al instante: cuando pasa algo (un lead entra, alguien escribe), ARIA ejecuta la acción — sin esperas ni conversación. Ej.: «lead nuevo del form web → plantilla de bienvenida por WhatsApp»."
              action={
                <Btn variant="primary" icon="plus" onClick={() => setPicking(true)}>
                  Crear la primera
                </Btn>
              }
            />
          </div>
          <div className="card" style={{ padding: 18 }}>
            <FeatureCompare current="automations" />
          </div>
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
          {kept.map((r) => {
            const d = TRIGGER_DEFS[r.trigger.type];
            const Icn = d.icon;
            return (
              <div
                key={r.ruleId}
                className={"card " + (r.enabled ? "card__accent-bar" : "")}
                style={{
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  ...(r.enabled ? ({ "--_c": "var(--gold)" } as React.CSSProperties) : {}),
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
                      color: d.accent,
                      flexShrink: 0,
                    }}
                  >
                    <Icn size={15} />
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
                      {r.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {d.label}
                      {(r.conditions?.length || 0) > 0 && ` · ${r.conditions!.length} cond.`}
                      {` · ${r.actions.length} ${r.actions.length === 1 ? "acción" : "acciones"}`}
                    </div>
                  </div>
                  <Switch
                    checked={r.enabled}
                    onCheckedChange={() => toggle(r)}
                    accent="var(--green)"
                    aria-label={r.enabled ? "Pausar regla" : "Activar regla"}
                  />
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {r.actions.map((a, i) => {
                    const ad = ACTION_DEFS[a.type];
                    const AIcn = ad.icon;
                    return (
                      <Pill key={i}>
                        <AIcn size={11} style={{ color: colorForAction(a.type) }} /> {ad.label}
                      </Pill>
                    );
                  })}
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
                  <span style={{ flex: 1, fontVariantNumeric: "tabular-nums" }}>
                    {r.firedCount || 0} ejecuciones
                    {r.lastFiredAt
                      ? ` · última ${new Date(r.lastFiredAt).toLocaleString("es-PE", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : ""}
                  </span>
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="play"
                    onClick={() => openTest(r)}
                    title="Probar regla (dry-run)"
                  />
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="history"
                    onClick={() => openRuns(r)}
                    title="Ver ejecuciones"
                  />
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="settings"
                    onClick={() => setEditing({ ...r })}
                    title="Editar"
                  />
                  <Btn variant="ghost" size="sm" onClick={() => remove(r)} title="Eliminar">
                    <Trash2 size={13} />
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal · Probar regla (dry-run) — también desde la lista */}
      <TestModal
        rule={testFor}
        leadId={testLeadId}
        onLeadId={setTestLeadId}
        result={testResult}
        testing={testing}
        onRun={runTest}
        onClose={() => setTestFor(null)}
      />

      {/* Ejecuciones — historial detallado (ok / error / skipped) */}
      <Modal
        open={runsFor !== null}
        onOpenChange={(o) => {
          if (!o) setRunsFor(null);
        }}
        title={runsFor ? `Ejecuciones · ${runsFor.name}` : ""}
        className="max-w-2xl"
      >
        <div className="wf-runs">
          {runs === null ? (
            <div className="skel" style={{ height: 80, borderRadius: 10 }} />
          ) : runs.length === 0 ? (
            <EmptyState
              title="Sin ejecuciones todavía"
              description="Cuando la regla dispare, vas a ver aquí cada acción con su resultado."
            />
          ) : (
            runs.map((run) => {
              const isSkip = run.action === "skipped";
              const state = isSkip ? "skip" : run.ok ? "ok" : "err";
              const label = isSkip
                ? "No cumplió condiciones"
                : ACTION_DEFS[run.action as ActionType]?.label || run.action || "—";
              return (
                <div key={run.sk} className={"wf-run wf-run--" + state}>
                  <span className="wf-run__dot" />
                  <div className="wf-run__body">
                    <div className="wf-run__title">
                      {label}
                      <span className="wf-run__trig">
                        {" · "}
                        {TRIGGER_DEFS[run.trigger as TriggerType]?.label || run.trigger}
                      </span>
                    </div>
                    {run.detail && <div className="wf-run__detail">{run.detail}</div>}
                    {run.error ? (
                      <div className={"wf-run__msg wf-run__msg--" + (isSkip ? "skip" : "err")}>
                        {isSkip ? "no cumplió: " : ""}
                        {run.error}
                      </div>
                    ) : isSkip ? (
                      <div className="wf-run__msg wf-run__msg--skip">
                        no cumplió las condiciones
                      </div>
                    ) : null}
                  </div>
                  <span className="wf-run__at">
                    {run.at
                      ? new Date(run.at).toLocaleString("es-PE", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : ""}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}

/** Modal de dry-run "Probar regla" — condiciones (✓/✗) + previews de acciones. */
function TestModal({
  rule,
  leadId,
  onLeadId,
  result,
  testing,
  onRun,
  onClose,
}: {
  rule: AutomationRule | null;
  leadId: string;
  onLeadId: (v: string) => void;
  result: RuleTestResult | null;
  testing: boolean;
  onRun: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={rule !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={rule ? `Probar · ${rule.name}` : ""}
      description="Simulación (dry-run): evalúa las condiciones y previsualiza las acciones. No ejecuta ni envía nada."
      className="max-w-lg"
    >
      <div className="wf-test">
        <label className="wf-field" style={{ ["--wf-c" as string]: "var(--gold)" }}>
          <span className="wf-field__label">Lead de prueba (opcional)</span>
          <div className="row gap8">
            <input
              className="wf-input"
              style={{ flex: 1 }}
              value={leadId}
              placeholder="leadId — vacío = datos de ejemplo"
              onChange={(e) => onLeadId(e.target.value)}
            />
            <Btn variant="primary" size="sm" icon="play" disabled={testing} onClick={onRun}>
              {testing ? "Probando…" : "Probar"}
            </Btn>
          </div>
        </label>

        {result && (
          <div className="wf-test__out">
            {result.leadFound === false && leadId.trim() && (
              <div className="wf-run__msg wf-run__msg--skip" style={{ marginBottom: 4 }}>
                No se encontró el lead {leadId.trim()} — se usaron datos de ejemplo.
              </div>
            )}

            {/* Condiciones */}
            <div className="wf-test__section">
              <div className="wf-test__kicker">
                Condiciones{" "}
                <span
                  className={
                    "wf-test__verdict wf-test__verdict--" + (result.conditionsPass ? "ok" : "no")
                  }
                >
                  {result.conditionsPass ? "se cumplen" : "no se cumplen"}
                </span>
              </div>
              {result.conditionsDetail.length === 0 ? (
                <div className="wf-empty-cond">Sin condiciones — se ejecuta siempre.</div>
              ) : (
                <div className="wf-test__conds">
                  {result.conditionsDetail.map((c, i) => (
                    <div
                      key={i}
                      className={"wf-test__cond wf-test__cond--" + (c.pass ? "ok" : "no")}
                    >
                      <span className="wf-test__mark">{c.pass ? "✓" : "✗"}</span>
                      <span className="wf-test__cond-txt">
                        {(() => {
                          const od = CONDITION_OPS.find((o) => o.value === c.op);
                          return (
                            <>
                              <b>{c.field}</b> {od?.label ?? c.op}
                              {(od?.needsValue ?? true) ? ` “${c.value}”` : ""}
                            </>
                          );
                        })()}
                      </span>
                      <span className="wf-test__actual">actual: {c.actual || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Acciones */}
            <div className="wf-test__section">
              <div className="wf-test__kicker">
                Acciones{" "}
                <span className="wf-test__hint">
                  {result.conditionsPass ? "se ejecutarían" : "NO se ejecutan (condición falla)"}
                </span>
              </div>
              <div className="wf-test__acts">
                {result.actions.map((a, i) => {
                  const def = ACTION_DEFS[a.type as ActionType];
                  const Icn = def?.icon;
                  const c = colorForAction(a.type as ActionType);
                  return (
                    <div key={i} className="wf-test__act" style={{ ["--wf-c" as string]: c }}>
                      <span className="wf-test__act-ico">
                        {Icn ? <Icn size={14} /> : <Icon name="bolt" size={14} />}
                      </span>
                      <span className="wf-test__act-txt">
                        <b>{def?.label || a.type}</b>
                        <span className="wf-test__preview">{a.preview}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
