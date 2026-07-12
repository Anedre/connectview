import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  Ban,
  BellRing,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  CloudUpload,
  Eraser,
  Gauge,
  Globe,
  GraduationCap,
  Inbox,
  LogOut,
  Mail,
  MessageCircle,
  MoveRight,
  Route,
  PenLine,
  SlidersHorizontal,
  StickyNote,
  Tag,
  Timer,
  UserPlus,
} from "lucide-react";

/**
 * automations — catálogo del motor de reglas (#15, "Digital Pipeline" de ARIA).
 * Fuente ÚNICA que alimenta el builder (patrón NODE_KINDS de botFlow.ts):
 * los TRIGGER_DEFS/ACTION_DEFS definen label/icono/campos de cada tipo, y la
 * UI se genera desde aquí. El backend valida contra los mismos type strings
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
  | "remove_tag"
  | "apply_attribute"
  | "apply_score"
  | "set_program"
  | "unsubscribe"
  | "add_note"
  | "mark_salesforce_sync"
  | "unenroll_journey"
  | "notify_agent"
  | "start_journey";

export interface RuleCondition {
  field: "source" | "stageId" | "valoracion" | "channel" | "flowName";
  /** eq/neq comparan igualdad; contains = subcadena; exists/notexists = campo con/sin valor. */
  op: "eq" | "neq" | "contains" | "exists" | "notexists";
  value: string;
}

/** Operadores de condición — etiqueta + si necesitan un valor a la derecha. */
export const CONDITION_OPS: Array<{
  value: RuleCondition["op"];
  label: string;
  needsValue: boolean;
}> = [
  { value: "eq", label: "es igual a", needsValue: true },
  { value: "neq", label: "es distinto de", needsValue: true },
  { value: "contains", label: "contiene", needsValue: true },
  { value: "exists", label: "tiene algún valor", needsValue: false },
  { value: "notexists", label: "está vacío", needsValue: false },
];

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
    | "program"
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
      {
        key: "stageId",
        label: "Solo en la etapa",
        type: "stage",
        hint: "Vacío = cualquier etapa.",
      },
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
      {
        key: "subject",
        label: "Asunto",
        type: "text",
        required: true,
        placeholder: "Asunto del correo",
      },
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
    description:
      "Agrega una etiqueta al lead (queda en sus atributos y puede disparar otras reglas).",
    icon: Tag,
    accent: "var(--accent-amber)",
    fields: [
      {
        key: "tag",
        label: "Etiqueta",
        type: "text",
        required: true,
        placeholder: "vip, no-contactar…",
      },
    ],
  },
  remove_tag: {
    label: "Quitar etiqueta",
    description: "Saca una etiqueta del lead (p. ej. limpiar 'nuevo' o 'sin-contactar').",
    icon: Eraser,
    accent: "var(--accent-amber)",
    fields: [
      {
        key: "tag",
        label: "Etiqueta a quitar",
        type: "text",
        required: true,
        placeholder: "nuevo, sin-contactar…",
        hint: "Si el lead no la tiene, no pasa nada.",
      },
    ],
  },
  apply_attribute: {
    label: "Setear atributo",
    description: "Guarda un dato personalizado en el lead (attributes[campo] = valor).",
    icon: SlidersHorizontal,
    accent: "var(--accent-cyan)",
    fields: [
      {
        key: "field",
        label: "Campo",
        type: "text",
        required: true,
        placeholder: "prioridad, origen…",
      },
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
  apply_score: {
    label: "Puntuar lead",
    description: "Suma o resta puntos al score del lead (para priorizar y calificar).",
    icon: Gauge,
    accent: "var(--accent-violet)",
    fields: [
      {
        key: "delta",
        label: "Puntos (+/−)",
        type: "number",
        required: true,
        defaultValue: 10,
        hint: "Positivo suma, negativo resta. Ej.: +10 abrió WhatsApp, −5 rebotó.",
      },
    ],
  },
  set_program: {
    label: "Asignar programa",
    description: "Vincula el lead a un programa/unidad (segmenta reportes y ruteo).",
    icon: GraduationCap,
    accent: "var(--accent-cyan)",
    fields: [
      {
        key: "programId",
        label: "Programa",
        type: "program",
        required: true,
        hint: "El lead queda asociado a esta unidad comercial.",
      },
    ],
  },
  unsubscribe: {
    label: "Dar de baja",
    description:
      "Marca al lead como 'no contactar' por un canal (supresión real, respeta opt-out).",
    icon: Ban,
    accent: "var(--accent-pink)",
    fields: [
      {
        key: "channel",
        label: "Canal",
        type: "select",
        required: true,
        options: [
          { value: "all", label: "Todos (WhatsApp + Email)" },
          { value: "whatsapp", label: "Solo WhatsApp" },
          { value: "email", label: "Solo Email" },
        ],
        defaultValue: "all",
        hint: "Deja de enviarle por ese canal hasta que vuelva a suscribirse.",
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
  add_note: {
    label: "Dejar nota",
    description: "Escribe una nota interna en el historial del lead (queda para el equipo).",
    icon: StickyNote,
    accent: "var(--accent-amber)",
    fields: [
      {
        key: "text",
        label: "Nota",
        type: "textarea",
        required: true,
        placeholder: "Contexto para el agente…",
        hint: "Tokens: {{name}}, {{phone}}, {{stage}} disponibles.",
      },
    ],
  },
  mark_salesforce_sync: {
    label: "Enviar a Salesforce",
    description: "Marca el lead para sincronizarlo a Salesforce en la próxima pasada del sync.",
    icon: CloudUpload,
    accent: "var(--accent-cyan)",
    fields: [],
  },
  unenroll_journey: {
    label: "Salir de un Journey",
    description: "Saca al lead de un recorrido en curso (deja de recibir sus pasos).",
    icon: LogOut,
    accent: "var(--accent-pink)",
    fields: [
      {
        key: "journeyId",
        label: "Journey",
        type: "journey",
        required: true,
        hint: "Si el lead no estaba inscrito, no pasa nada.",
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
    description: "Armala desde cero: elige trigger, condiciones y acciones.",
    build: () => ({
      name: "Nueva automatización",
      enabled: false,
      trigger: { type: "lead_created", params: {} },
      conditions: [],
      actions: [],
    }),
  },
  {
    id: "hot-lead-playbook",
    name: "Lead caliente · jugada completa",
    description:
      "Formulario Meta de un lead calificado → orquesta 8 pasos: puntúa, etiqueta, asigna programa, saluda, avisa, agenda, mueve de etapa y lo inscribe en un journey. Úsala para ver el builder al máximo.",
    build: () => ({
      name: "Lead caliente Meta → jugada completa",
      enabled: false,
      trigger: { type: "whatsapp_flow_completed", params: {} },
      conditions: [
        { field: "source", op: "contains", value: "meta" },
        { field: "valoracion", op: "neq", value: "negativa" },
        { field: "stageId", op: "exists", value: "" },
      ],
      actions: [
        { type: "apply_score", params: { delta: 25 } },
        { type: "apply_tag", params: { tag: "lead-caliente" } },
        { type: "set_program", params: { programId: "" } },
        {
          type: "send_whatsapp_template",
          params: { templateName: "", variables: ["{{name}}"] },
        },
        {
          type: "notify_agent",
          params: { message: "🔥 {{name}} completó el formulario — llámalo YA", agent: "" },
        },
        {
          type: "schedule_callback",
          params: { offsetHours: 2, channel: "voice", notes: "Lead caliente: contactar en 2h" },
        },
        { type: "move_stage", params: { stageId: "" } },
        { type: "start_journey", params: { journeyId: "" } },
      ],
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
    description:
      "Lead de un formulario de Facebook/Instagram → WhatsApp de bienvenida sub-minuto (mata Zapier).",
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
  {
    id: "score-engagement",
    name: "Scoring · sube por engagement",
    description: "El lead escribe por WhatsApp → +10 al score y etiqueta 'interesado' (prioriza).",
    build: () => ({
      name: "Scoring por engagement",
      enabled: false,
      trigger: { type: "message_inbound", params: { channel: "whatsapp" } },
      conditions: [],
      actions: [
        { type: "apply_score", params: { delta: 10 } },
        { type: "apply_tag", params: { tag: "interesado" } },
      ],
    }),
  },
  {
    id: "closed-cleanup",
    name: "Cierre → no molestar + limpiar",
    description:
      "El lead llega a una etapa de cierre → se da de baja del marketing y se etiqueta 'cliente'.",
    build: () => ({
      name: "Cierre: dar de baja y etiquetar",
      enabled: false,
      trigger: { type: "lead_stage_changed", params: {} },
      conditions: [],
      actions: [
        { type: "unsubscribe", params: { channel: "all" } },
        { type: "remove_tag", params: { tag: "interesado" } },
        { type: "apply_tag", params: { tag: "cliente" } },
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
  "send_email",
  "move_stage",
  "schedule_callback",
  "apply_tag",
  "remove_tag",
  "apply_attribute",
  "apply_score",
  "set_program",
  "unsubscribe",
  "notify_agent",
  "add_note",
  "start_journey",
  "unenroll_journey",
  "webhook",
  "mark_salesforce_sync",
];
