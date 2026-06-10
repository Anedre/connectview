import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  CalendarClock,
  ClipboardList,
  Globe,
  MessageCircle,
  MoveRight,
  PenLine,
  Timer,
  UserPlus,
} from "lucide-react";

/**
 * automations — catálogo del motor de reglas (#15, "Digital Pipeline" de AIRA).
 * Fuente ÚNICA que alimenta el builder (patrón NODE_KINDS de botFlow.ts):
 * los TRIGGER_DEFS/ACTION_DEFS definen label/icono/campos de cada tipo, y la
 * UI se genera desde acá. El backend valida contra los mismos type strings
 * (amplify/functions/manage-automations + automation-engine).
 */

export type TriggerType =
  | "lead_created"
  | "lead_stage_changed"
  | "lead_inactive"
  | "wrapup_saved"
  | "whatsapp_flow_completed";
export type ActionType =
  | "send_whatsapp_template"
  | "move_stage"
  | "schedule_callback"
  | "webhook";

export interface RuleCondition {
  field: "source" | "stageId" | "valoracion" | "channel" | "flowName";
  op: "eq" | "neq";
  value: string;
}

export interface AutomationRule {
  ruleId?: string;
  name: string;
  enabled: boolean;
  trigger: { type: TriggerType; params?: Record<string, unknown> };
  conditions?: RuleCondition[];
  actions: Array<{ type: ActionType; params?: Record<string, unknown> }>;
  firedCount?: number;
  lastFiredAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AutomationRun {
  sk: string;
  ruleId: string;
  ruleName?: string;
  trigger?: string;
  action?: string;
  leadId?: string;
  contactId?: string;
  ok?: boolean;
  error?: string;
  at?: string;
}

/** Campo de configuración de un trigger/acción — la UI lo renderiza genérico. */
export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "stage" | "template" | "agent" | "url" | "variables";
  placeholder?: string;
  hint?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string | number;
}

export const TRIGGER_DEFS: Record<
  TriggerType,
  { label: string; description: string; icon: LucideIcon; accent: string; fields: FieldDef[] }
> = {
  lead_created: {
    label: "Lead nuevo",
    description: "Entra un lead al embudo (form web, manual, campaña).",
    icon: UserPlus,
    accent: "var(--accent-cyan)",
    fields: [],
  },
  lead_stage_changed: {
    label: "Cambio de etapa",
    description: "Un lead se mueve de etapa en el embudo.",
    icon: ArrowRightLeft,
    accent: "var(--accent-violet)",
    fields: [
      {
        key: "stageId",
        label: "Solo al llegar a la etapa",
        type: "stage",
        hint: "Vacío = cualquier etapa destino.",
      },
    ],
  },
  lead_inactive: {
    label: "Lead inactivo",
    description: "Un lead lleva N días sin actividad (se evalúa cada 5 min).",
    icon: Timer,
    accent: "var(--accent-amber)",
    fields: [
      {
        key: "days",
        label: "Días sin actividad",
        type: "number",
        required: true,
        defaultValue: 7,
        hint: "Se dispara una vez por episodio de inactividad (se re-arma con actividad nueva).",
      },
      { key: "stageId", label: "Solo en la etapa", type: "stage", hint: "Vacío = cualquier etapa." },
    ],
  },
  wrapup_saved: {
    label: "Wrap-up guardado",
    description: "Un agente tipifica un contacto (cualquier canal).",
    icon: PenLine,
    accent: "var(--accent-green)",
    fields: [],
  },
  whatsapp_flow_completed: {
    label: "Formulario completado",
    description: "Un cliente completa un formulario de WhatsApp (Flow #10).",
    icon: ClipboardList,
    accent: "var(--accent-pink)",
    fields: [
      {
        key: "flowName",
        label: "Solo el formulario",
        type: "text",
        placeholder: "nombre del Flow",
        hint: "Vacío = cualquier formulario.",
      },
    ],
  },
};

export const CONDITION_FIELDS: Array<{ value: RuleCondition["field"]; label: string }> = [
  { value: "source", label: "Fuente del lead" },
  { value: "stageId", label: "Etapa" },
  { value: "valoracion", label: "Valoración (wrap-up)" },
  { value: "channel", label: "Canal (wrap-up)" },
  { value: "flowName", label: "Formulario (Flow)" },
];

export const ACTION_DEFS: Record<
  ActionType,
  { label: string; description: string; icon: LucideIcon; accent: string; fields: FieldDef[] }
> = {
  send_whatsapp_template: {
    label: "Enviar plantilla WhatsApp",
    description: "Manda una plantilla HSM aprobada al teléfono del lead.",
    icon: MessageCircle,
    accent: "var(--accent-green)",
    fields: [
      { key: "templateName", label: "Plantilla", type: "template", required: true },
      {
        key: "variables",
        label: "Variables ({{1}}, {{2}}…)",
        type: "variables",
        hint: "Tokens: {{name}}, {{phone}}, {{stage}} se reemplazan con los datos del lead.",
      },
    ],
  },
  move_stage: {
    label: "Mover de etapa",
    description: "Cambia la etapa del lead en el embudo (y sincroniza SF).",
    icon: MoveRight,
    accent: "var(--accent-violet)",
    fields: [{ key: "stageId", label: "Etapa destino", type: "stage", required: true }],
  },
  schedule_callback: {
    label: "Agendar seguimiento",
    description: "Crea un follow-up (llamada/WhatsApp/email) a futuro.",
    icon: CalendarClock,
    accent: "var(--accent-amber)",
    fields: [
      {
        key: "offsetHours",
        label: "En cuántas horas",
        type: "number",
        required: true,
        defaultValue: 24,
      },
      {
        key: "channel",
        label: "Canal",
        type: "select",
        options: [
          { value: "voice", label: "Llamada" },
          { value: "whatsapp", label: "WhatsApp" },
          { value: "email", label: "Email" },
        ],
        defaultValue: "voice",
      },
      { key: "notes", label: "Nota", type: "text", placeholder: "Seguimiento automático" },
      {
        key: "assignedAgentUserId",
        label: "Asignar a agente",
        type: "agent",
        hint: "Opcional para llamadas; recomendado para WhatsApp/email.",
      },
    ],
  },
  webhook: {
    label: "Webhook saliente",
    description: "POST JSON a tu endpoint (integraciones propias).",
    icon: Globe,
    accent: "var(--accent-cyan)",
    fields: [
      {
        key: "url",
        label: "URL",
        type: "url",
        required: true,
        placeholder: "https://…",
        hint: "1 intento, timeout 5s (reintentos multi-día: próximamente).",
      },
    ],
  },
};

/** Plantillas predefinidas — onboarding del builder (patrón BOT_TEMPLATES). */
export const RULE_TEMPLATES: Array<{
  id: string;
  name: string;
  description: string;
  build: () => AutomationRule;
}> = [
  {
    id: "blank",
    name: "En blanco",
    description: "Armala desde cero: elegí trigger, condiciones y acciones.",
    build: () => ({
      name: "Nueva automatización",
      enabled: false,
      trigger: { type: "lead_created", params: {} },
      conditions: [],
      actions: [],
    }),
  },
  {
    id: "welcome-web",
    name: "Bienvenida a leads del form web",
    description: "Lead nuevo con fuente Web → plantilla de bienvenida por WhatsApp.",
    build: () => ({
      name: "Bienvenida leads web",
      enabled: false,
      trigger: { type: "lead_created", params: {} },
      conditions: [{ field: "source", op: "eq", value: "Web Form" }],
      actions: [
        { type: "send_whatsapp_template", params: { templateName: "", variables: ["{{name}}"] } },
      ],
    }),
  },
  {
    id: "reactivate-7d",
    name: "Reactivación · 7 días inactivo",
    description: "Lead sin actividad 7 días → plantilla de reactivación.",
    build: () => ({
      name: "Reactivación 7 días",
      enabled: false,
      trigger: { type: "lead_inactive", params: { days: 7 } },
      conditions: [],
      actions: [
        { type: "send_whatsapp_template", params: { templateName: "", variables: ["{{name}}"] } },
      ],
    }),
  },
  {
    id: "wrapup-negative",
    name: "Wrap-up negativo → seguimiento",
    description: "Tipificación con valoración negativa → callback en 24h.",
    build: () => ({
      name: "Rescate de gestiones negativas",
      enabled: false,
      trigger: { type: "wrapup_saved", params: {} },
      conditions: [{ field: "valoracion", op: "eq", value: "negativa" }],
      actions: [
        {
          type: "schedule_callback",
          params: { offsetHours: 24, channel: "voice", notes: "Rescate: gestión negativa" },
        },
      ],
    }),
  },
];

export const TRIGGER_ORDER: TriggerType[] = [
  "lead_created",
  "lead_stage_changed",
  "lead_inactive",
  "wrapup_saved",
  "whatsapp_flow_completed",
];
export const ACTION_ORDER: ActionType[] = [
  "send_whatsapp_template",
  "move_stage",
  "schedule_callback",
  "webhook",
];
