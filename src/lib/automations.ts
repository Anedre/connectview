import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  BellRing,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  Globe,
  Inbox,
  Mail,
  MessageCircle,
  MoveRight,
  Route,
  PenLine,
  SlidersHorizontal,
  Tag,
  Timer,
  UserPlus,
} from "lucide-react";

/**
 * automations — catálogo del motor de reglas (#15, "Digital Pipeline" de ARIA).
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
  | "whatsapp_flow_completed"
  | "message_inbound"
  | "appointment_scheduled"
  | "tag_applied";
export type ActionType =
  | "send_whatsapp_template"
  | "move_stage"
  | "schedule_callback"
  | "webhook"
  | "send_email"
  | "apply_tag"
  | "apply_attribute"
  | "notify_agent"
  | "start_journey";

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
  /** Tipo de acción ejecutada, o "skipped" cuando la regla no cumplió condiciones. */
  action?: string;
  leadId?: string;
  contactId?: string;
  ok?: boolean;
  /** Motivo/mensaje de error (rojo) o de skip (ámbar) en el historial. */
  error?: string;
  /** Detalle humano de lo ejecutado (p.ej. "plantilla bienvenida → +51…"). */
  detail?: string;
  at?: string;
}

/** Respuesta del dry-run POST {action:"testRule"} — no ejecuta nada. */
export interface RuleTestResult {
  ok: boolean;
  conditionsPass: boolean;
  conditionsDetail: Array<{
    field: string;
    op: string;
    value: string;
    actual: string;
    pass: boolean;
  }>;
  actions: Array<{ type: string; preview: string }>;
  leadFound?: boolean;
  error?: string;
}

/** Campo de configuración de un trigger/acción — la UI lo renderiza genérico. */
export interface FieldDef {
  key: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "number"
    | "select"
    | "stage"
    | "template"
    | "agent"
    | "journey"
    | "url"
    | "variables";
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
  message_inbound: {
    label: "Mensaje entrante",
    description: "Un cliente escribe por un canal de mensajería (WhatsApp, IG, Messenger).",
    icon: Inbox,
    accent: "var(--accent-cyan)",
    fields: [
      {
        key: "channel",
        label: "Solo el canal",
        type: "select",
        options: [
          { value: "", label: "Cualquiera" },
          { value: "whatsapp", label: "WhatsApp" },
          { value: "instagram", label: "Instagram" },
          { value: "messenger", label: "Messenger" },
        ],
        defaultValue: "",
        hint: "Vacío = cualquier canal de mensajería.",
      },
    ],
  },
  appointment_scheduled: {
    label: "Cita agendada",
    description: "Se agenda una cita/reunión con un cliente (roadmap #26).",
    icon: CalendarCheck,
    accent: "var(--accent-green)",
    fields: [],
  },
  tag_applied: {
    label: "Etiqueta aplicada",
    description: "Se le aplica una etiqueta a un lead (manual o por otra regla).",
    icon: Tag,
    accent: "var(--accent-amber)",
    fields: [
      {
        key: "tag",
        label: "Solo la etiqueta",
        type: "text",
        placeholder: "nombre de la etiqueta",
        hint: "Vacío = cualquier etiqueta.",
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
  send_email: {
    label: "Enviar email",
    description: "Manda un email al correo del lead (por SES, con tracking de apertura).",
    icon: Mail,
    accent: "var(--accent-violet)",
    fields: [
      { key: "subject", label: "Asunto", type: "text", required: true, placeholder: "Asunto del correo" },
      {
        key: "body",
        label: "Mensaje",
        type: "textarea",
        required: true,
        hint: "Tokens: {{name}}, {{phone}}, {{stage}} se reemplazan con los datos del lead.",
      },
    ],
  },
  apply_tag: {
    label: "Aplicar etiqueta",
    description: "Agrega una etiqueta al lead (queda en sus atributos y puede disparar otras reglas).",
    icon: Tag,
    accent: "var(--accent-amber)",
    fields: [
      { key: "tag", label: "Etiqueta", type: "text", required: true, placeholder: "vip, no-contactar…" },
    ],
  },
  apply_attribute: {
    label: "Setear atributo",
    description: "Guarda un dato personalizado en el lead (attributes[campo] = valor).",
    icon: SlidersHorizontal,
    accent: "var(--accent-cyan)",
    fields: [
      { key: "field", label: "Campo", type: "text", required: true, placeholder: "prioridad, origen…" },
      {
        key: "value",
        label: "Valor",
        type: "text",
        required: true,
        placeholder: "alta",
        hint: "Tokens: {{name}}, {{phone}}, {{stage}} disponibles.",
      },
    ],
  },
  notify_agent: {
    label: "Avisar a un agente",
    description: "Crea una notificación in-app para un agente (aparece en sus tareas).",
    icon: BellRing,
    accent: "var(--accent-pink)",
    fields: [
      {
        key: "message",
        label: "Mensaje",
        type: "text",
        required: true,
        placeholder: "Lead caliente para llamar",
        hint: "Tokens: {{name}}, {{phone}}, {{stage}} disponibles.",
      },
      {
        key: "agent",
        label: "Agente",
        type: "agent",
        hint: "Opcional. Vacío = notificación general (sin asignar).",
      },
    ],
  },
  start_journey: {
    label: "Iniciar Journey",
    description: "Inscribe al lead en un recorrido del Engagement Studio (nurturing multi-paso).",
    icon: Route,
    accent: "var(--accent-green)",
    fields: [
      {
        key: "journeyId",
        label: "Journey",
        type: "journey",
        required: true,
        hint: "El recorrido debe estar Activo para que el lead avance por sus pasos.",
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
    id: "speed-to-lead-meta",
    name: "Speed-to-lead · Meta (FB/IG)",
    description: "Lead de un formulario de Facebook/Instagram → WhatsApp de bienvenida sub-minuto (mata Zapier).",
    build: () => ({
      name: "Speed-to-lead Meta",
      enabled: false,
      trigger: { type: "lead_created", params: {} },
      conditions: [{ field: "source", op: "eq", value: "facebook" }],
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
  "message_inbound",
  "appointment_scheduled",
  "tag_applied",
];
export const ACTION_ORDER: ActionType[] = [
  "send_whatsapp_template",
  "move_stage",
  "schedule_callback",
  "webhook",
  "send_email",
  "apply_tag",
  "apply_attribute",
  "notify_agent",
  "start_journey",
];
