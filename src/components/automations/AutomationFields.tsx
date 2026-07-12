import type { CSSProperties } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActionType, FieldDef } from "@/lib/automations";
import type { WaTemplate } from "@/components/whatsapp/WaTemplateConfigurator";

/**
 * AutomationFields — piezas compartidas del builder de Automatizaciones.
 * Extraídas de AutomationsPage para que las consuman TANTO el editor clásico
 * como el canvas radial (AutomationRadialBuilder). Fuente única de los controles
 * de campo (WfSelect/FieldInput/FieldsBlock) + el color por tipo de acción.
 */

/** Contexto de pickers que necesitan los campos (listas ya cargadas por hooks). */
export interface PickersCtx {
  stages: Array<{ id: string; label: string }>;
  templates: WaTemplate[];
  agents: Array<{ userId: string; username: string }>;
  journeys: Array<{ journeyId: string; name: string; status: string }>;
  programs: Array<{ id: string; name: string }>;
}

// Exports no-componente (const/fn) co-ubicados con los controles de campo — mismo
// patrón que PlusEdge. No rompen fast-refresh en la práctica.
/* eslint-disable react-refresh/only-export-components */
/** Color por TIPO de acción — variedad visual (recetas y satélites del radial). */
export const ACTION_COLOR: Record<ActionType, string> = {
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
export const colorForAction = (t: ActionType): string => ACTION_COLOR[t] ?? "var(--accent)";

const WF_NONE = "__wfnone__";
/** Select del kit para los campos del builder (reemplaza los `<select className="wf-input">`
 *  nativos). Mapea la opción vacía ("") a un sentinel porque base-ui trata "" como
 *  placeholder; el label del valor actual va como hijo de SelectValue (no se auto-renderiza). */
export function WfSelect({
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
export function FieldInput({
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
export function FieldsBlock({
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
