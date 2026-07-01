import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw, Trash2, History, Pencil, ChevronLeft, Webhook } from "lucide-react";
import { getApiEndpoints } from "@/lib/api";
import { PageHeader } from "@/components/vox/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { useTaxonomy } from "@/hooks/useTaxonomy";
import { useUsers } from "@/hooks/useUsers";
import {
  ACTION_DEFS,
  ACTION_ORDER,
  CONDITION_FIELDS,
  RULE_TEMPLATES,
  TRIGGER_DEFS,
  TRIGGER_ORDER,
  type ActionType,
  type AutomationRule,
  type AutomationRun,
  type FieldDef,
  type RuleCondition,
  type TriggerType,
} from "@/lib/automations";
import type { WaTemplate } from "@/components/whatsapp/WaTemplateConfigurator";
import { WebhookDeliveriesPanel } from "@/components/automations/WebhookDeliveriesPanel";

/**
 * AutomationsPage — /automations (#15, "Digital Pipeline" de ARIA): reglas
 * trigger → condiciones → acciones que el automation-engine ejecuta solo.
 * Patrón FlowBuilderPage (lista + picker de plantillas + editor) con los
 * primitivos del design system. Las reglas NO se encadenan entre sí
 * (anti-loop del engine) — el copy del editor lo aclara.
 */

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border-2)",
  background: "var(--bg-2)",
  color: "var(--text-1)",
  fontSize: 13,
};

interface PickersCtx {
  stages: Array<{ id: string; label: string }>;
  templates: WaTemplate[];
  agents: Array<{ userId: string; username: string }>;
}

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
      <select style={inputStyle} value={String(v)} onChange={(e) => onChange(e.target.value)}>
        <option value="">— cualquiera —</option>
        {ctx.stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "template") {
    return (
      <select style={inputStyle} value={String(v)} onChange={(e) => onChange(e.target.value)}>
        <option value="">— elegí una plantilla —</option>
        {ctx.templates.map((t) => (
          <option key={t.name} value={t.name}>
            {t.name}
            {t.variableCount ? ` · ${t.variableCount} var` : ""}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "agent") {
    return (
      <select style={inputStyle} value={String(v)} onChange={(e) => onChange(e.target.value)}>
        <option value="">— sin asignar —</option>
        {ctx.agents.map((a) => (
          <option key={a.userId} value={a.userId}>
            {a.username}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "select") {
    return (
      <select style={inputStyle} value={String(v)} onChange={(e) => onChange(e.target.value)}>
        {(field.options || []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "number") {
    return (
      <input
        type="number"
        style={inputStyle}
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
        style={inputStyle}
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
      style={inputStyle}
      value={String(v)}
      placeholder={field.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function FieldsBlock({
  fields,
  params,
  onParams,
  ctx,
}: {
  fields: FieldDef[];
  params: Record<string, unknown>;
  onParams: (p: Record<string, unknown>) => void;
  ctx: PickersCtx;
}) {
  if (fields.length === 0) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 12,
        marginTop: 12,
      }}
    >
      {fields.map((f) => (
        <FormField key={f.key} label={f.label} hint={f.hint} required={f.required}>
          {(a) => (
            <div id={a.id}>
              <FieldInput
                field={f}
                value={params[f.key]}
                onChange={(v) => onParams({ ...params, [f.key]: v })}
                ctx={ctx}
              />
            </div>
          )}
        </FormField>
      ))}
    </div>
  );
}

/** Bloque del editor con eyebrow de sección (CUANDO / SI / ENTONCES). */
function Section({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        style={{
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 700,
          color: "var(--accent-amber)",
        }}
      >
        {kicker}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, margin: "2px 0 12px" }}>{title}</div>
      {children}
    </div>
  );
}

export function AutomationsPage() {
  const ep = getApiEndpoints();
  const { confirm, confirmDialog } = useConfirm();
  const { tree } = useTaxonomy();
  const { users } = useUsers();
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

  const ctx: PickersCtx = useMemo(
    () => ({
      stages: tree.map((s) => ({ id: s.id, label: s.label })),
      templates: waTemplates,
      agents: users
        .filter((u) => u.userId)
        .map((u) => ({ userId: u.userId as string, username: u.username })),
    }),
    [tree, waTemplates, users],
  );

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
      toast.error("Poné un nombre");
      return;
    }
    if (rule.actions.length === 0) {
      toast.error("Agregá al menos una acción");
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

  // ── Editor ──
  if (editing) {
    const trig = TRIGGER_DEFS[editing.trigger.type];
    return (
      <div className="view">
        <PageHeader
          crumb="Crecimiento · Automatizaciones"
          title={editing.ruleId ? "Editar automatización" : "Nueva automatización"}
          sub="Trigger → condiciones → acciones. Las reglas no se encadenan entre sí."
          actions={
            <>
              <button className="btn" onClick={() => setEditing(null)}>
                <ChevronLeft size={14} /> Volver
              </button>
              <button className="btn btn--primary" disabled={saving} onClick={() => save(editing)}>
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </>
          }
        />

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
          <input
            style={{ ...inputStyle, fontSize: 15, fontWeight: 600, flex: 1 }}
            value={editing.name}
            placeholder="Nombre de la automatización"
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
          <button
            className={`btn ${editing.enabled ? "btn--primary" : ""}`}
            onClick={() => setEditing({ ...editing, enabled: !editing.enabled })}
            title="Las reglas desactivadas no se ejecutan"
          >
            {editing.enabled ? "Activa" : "Pausada"}
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* CUANDO */}
          <Section kicker="Cuando" title="¿Qué dispara la regla?">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 10,
              }}
            >
              {TRIGGER_ORDER.map((t) => {
                const d = TRIGGER_DEFS[t];
                const Icn = d.icon;
                const active = editing.trigger.type === t;
                return (
                  <button
                    key={t}
                    onClick={() => setEditing({ ...editing, trigger: { type: t, params: {} } })}
                    className="card"
                    style={{
                      padding: 12,
                      textAlign: "left",
                      cursor: "pointer",
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      border: `1px solid ${active ? d.accent : "var(--border-1)"}`,
                      boxShadow: active ? `0 0 0 1px ${d.accent}` : undefined,
                    }}
                  >
                    <span
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        flexShrink: 0,
                        background: "var(--bg-2)",
                        color: d.accent,
                      }}
                    >
                      <Icn size={15} />
                    </span>
                    <span>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                        {d.label}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 11.5,
                          color: "var(--text-3)",
                          marginTop: 2,
                        }}
                      >
                        {d.description}
                      </span>
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
            />
          </Section>

          {/* SI */}
          <Section kicker="Si" title="Condiciones (opcional, todas deben cumplirse)">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(editing.conditions || []).map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select
                    style={{ ...inputStyle, width: 180 }}
                    value={c.field}
                    onChange={(e) => {
                      const conditions = [...(editing.conditions || [])];
                      conditions[i] = { ...c, field: e.target.value as RuleCondition["field"] };
                      setEditing({ ...editing, conditions });
                    }}
                  >
                    {CONDITION_FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select
                    style={{ ...inputStyle, width: 110 }}
                    value={c.op}
                    onChange={(e) => {
                      const conditions = [...(editing.conditions || [])];
                      conditions[i] = { ...c, op: e.target.value as RuleCondition["op"] };
                      setEditing({ ...editing, conditions });
                    }}
                  >
                    <option value="eq">es</option>
                    <option value="neq">no es</option>
                  </select>
                  {c.field === "stageId" ? (
                    <select
                      style={{ ...inputStyle, flex: 1 }}
                      value={c.value}
                      onChange={(e) => {
                        const conditions = [...(editing.conditions || [])];
                        conditions[i] = { ...c, value: e.target.value };
                        setEditing({ ...editing, conditions });
                      }}
                    >
                      <option value="">— elegí —</option>
                      {ctx.stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      style={{ ...inputStyle, flex: 1 }}
                      value={c.value}
                      placeholder={
                        c.field === "valoracion" ? "positiva / negativa / neutra" : "valor"
                      }
                      onChange={(e) => {
                        const conditions = [...(editing.conditions || [])];
                        conditions[i] = { ...c, value: e.target.value };
                        setEditing({ ...editing, conditions });
                      }}
                    />
                  )}
                  <button
                    className="btn btn--ghost btn--sm"
                    aria-label="Quitar condición"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        conditions: (editing.conditions || []).filter((_, j) => j !== i),
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <button
                className="btn btn--sm"
                style={{ alignSelf: "flex-start" }}
                onClick={() =>
                  setEditing({
                    ...editing,
                    conditions: [
                      ...(editing.conditions || []),
                      { field: "source", op: "eq", value: "" },
                    ],
                  })
                }
              >
                <Plus size={13} /> Agregar condición
              </button>
            </div>
          </Section>

          {/* ENTONCES */}
          <Section kicker="Entonces" title="Acciones (en orden)">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {editing.actions.map((a, i) => {
                const d = ACTION_DEFS[a.type];
                const Icn = d.icon;
                return (
                  <div
                    key={i}
                    className="card"
                    style={{ padding: 14, border: "1px solid var(--border-1)" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span
                        style={{
                          display: "grid",
                          placeItems: "center",
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: "var(--bg-2)",
                          color: d.accent,
                        }}
                      >
                        <Icn size={14} />
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                        {i + 1}. {d.label}
                      </span>
                      <button
                        className="btn btn--ghost btn--sm"
                        aria-label="Quitar acción"
                        onClick={() =>
                          setEditing({
                            ...editing,
                            actions: editing.actions.filter((_, j) => j !== i),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <FieldsBlock
                      fields={d.fields}
                      params={a.params || {}}
                      onParams={(p) => {
                        const actions = [...editing.actions];
                        actions[i] = { ...a, params: p };
                        setEditing({ ...editing, actions });
                      }}
                      ctx={ctx}
                    />
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {ACTION_ORDER.map((t) => {
                  const d = ACTION_DEFS[t];
                  const Icn = d.icon;
                  return (
                    <button
                      key={t}
                      className="btn btn--sm"
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
                      <Icn size={13} style={{ color: d.accent }} /> {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Section>
        </div>
        {confirmDialog}
      </div>
    );
  }

  // ── Picker de plantillas ──
  if (picking) {
    return (
      <div className="view">
        <PageHeader
          crumb="Crecimiento · Automatizaciones"
          title="Elegí un punto de partida"
          sub="Plantillas listas o desde cero — todo es editable después."
          actions={
            <button className="btn" onClick={() => setPicking(false)}>
              <ChevronLeft size={14} /> Volver
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
          {RULE_TEMPLATES.map((t) => {
            const rule = t.build();
            const d = TRIGGER_DEFS[rule.trigger.type];
            const Icn = d.icon;
            return (
              <button
                key={t.id}
                className="card"
                style={{
                  textAlign: "left",
                  padding: 18,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  border: "1px solid var(--border-1)",
                }}
                onClick={() => {
                  setPicking(false);
                  setEditing(rule);
                }}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: "var(--bg-2)",
                    color: d.accent,
                  }}
                >
                  <Icn size={18} />
                </span>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
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

  // ── Lista ──
  const kept = rules.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  const activeCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="view">
      <PageHeader
        crumb="Crecimiento"
        title="Automatizaciones"
        count={`${rules.length} ${rules.length === 1 ? "regla" : "reglas"} · ${activeCount} activas`}
        sub="Los leads avanzan solos: triggers del embudo y del wrap-up disparan acciones."
        search={{ value: q, onChange: setQ, placeholder: "Buscar regla…" }}
        actions={
          <>
            <button className="btn" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> Actualizar
            </button>
            <button
              className="btn"
              onClick={() => setShowWebhooks(true)}
              title="Entregas de webhooks salientes (#17)"
            >
              <Webhook size={14} /> Webhooks
            </button>
            <button className="btn btn--primary" onClick={() => setPicking(true)}>
              <Plus size={14} /> Nueva regla
            </button>
          </>
        }
      />

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
        <div className="card">
          <EmptyState
            icon={<Plus />}
            title={
              rules.length === 0 ? "Todavía no hay automatizaciones" : "Ninguna regla coincide"
            }
            description="Creá reglas tipo «lead nuevo del form web → plantilla de bienvenida por WhatsApp» y dejá que el embudo trabaje solo."
            action={
              <button className="btn btn--primary" onClick={() => setPicking(true)}>
                <Plus size={14} /> Crear la primera
              </button>
            }
          />
        </div>
      ) : (
        <div
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
                className="card"
                style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}
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
                  <button
                    className={`chip ${r.enabled ? "chip--green" : ""}`}
                    style={{ cursor: "pointer", border: "none" }}
                    onClick={() => toggle(r)}
                    title={r.enabled ? "Click para pausar" : "Click para activar"}
                  >
                    <span className="dot" /> {r.enabled ? "Activa" : "Pausada"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {r.actions.map((a, i) => {
                    const ad = ACTION_DEFS[a.type];
                    const AIcn = ad.icon;
                    return (
                      <span key={i} className="chip" style={{ gap: 5 }}>
                        <AIcn size={11} style={{ color: ad.accent }} /> {ad.label}
                      </span>
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
                      ? ` · última ${new Date(r.lastFiredAt).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                      : ""}
                  </span>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => openRuns(r)}
                    title="Ver ejecuciones"
                  >
                    <History size={13} />
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => setEditing({ ...r })}
                    title="Editar"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => remove(r)}
                    title="Eliminar"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ejecuciones */}
      <Modal
        open={runsFor !== null}
        onOpenChange={(o) => {
          if (!o) setRunsFor(null);
        }}
        title={runsFor ? `Ejecuciones · ${runsFor.name}` : ""}
        className="max-w-2xl"
      >
        <div
          style={{
            marginTop: 12,
            maxHeight: 420,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {runs === null ? (
            <div className="skel" style={{ height: 80, borderRadius: 10 }} />
          ) : runs.length === 0 ? (
            <EmptyState
              title="Sin ejecuciones todavía"
              description="Cuando la regla dispare, vas a ver acá cada acción con su resultado."
            />
          ) : (
            runs.map((run) => (
              <div
                key={run.sk}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  background: "var(--bg-2)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: run.ok ? "var(--accent-green)" : "var(--accent-red)",
                  }}
                  title={run.ok ? "OK" : run.error}
                />
                <span style={{ flex: 1 }}>
                  {ACTION_DEFS[run.action as ActionType]?.label || run.action}
                  <span style={{ color: "var(--text-3)" }}>
                    {" "}
                    · {TRIGGER_DEFS[run.trigger as TriggerType]?.label || run.trigger}
                  </span>
                  {run.error && (
                    <span style={{ display: "block", color: "var(--accent-red)", fontSize: 11 }}>
                      {run.error}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    color: "var(--text-3)",
                    fontVariantNumeric: "tabular-nums",
                    flexShrink: 0,
                  }}
                >
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
            ))
          )}
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}
