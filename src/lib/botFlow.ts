/**
 * botFlow.ts — data model + node catalog for the visual chat-flow builder
 * (roadmap #16, the Kommo "Salesbot" equivalent). A bot is a graph of steps
 * (nodes) + transitions (edges), stored as JSON in `connectview-bots` and
 * edited on a react-flow canvas.
 *
 * NODE_KINDS is the single source of truth: it drives the palette, each
 * node's rendering (icon / accent / inline summary / outlets) and the config
 * panel's fields. Adding a new step type = one catalog entry, nothing else —
 * which is exactly what makes this easy to push past Kommo over time.
 */

export type NodeKind =
  | "start"
  | "message"
  | "list"
  | "question"
  | "condition"
  | "template"
  | "delay"
  | "set_field"
  | "handoff"
  | "internal_note"
  | "ai_agent"
  | "webhook"
  | "jump"
  | "stop";

export interface BotNode {
  id: string;
  kind: NodeKind;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface BotEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

export interface Bot {
  botId: string;
  name: string;
  status: "draft" | "active" | "paused";
  trigger: string;
  nodes: BotNode[];
  edges: BotEdge[];
  updatedAt?: string;
}

export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "number"
  | "buttons"
  | "varlist"
  | "listrows"
  | "var"
  | "node-ref";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: string[];
  help?: string;
  /**
   * Rol del campo respecto a las variables del flujo (UX didáctica #16):
   * "define" → este campo CREA una variable reutilizable (p. ej. Guardar en).
   * "use"    → este campo ELIGE una variable ya creada (p. ej. Condición).
   * "insert" → contenido que puede INSERTAR variables con {{ }} (mensaje, nota…).
   * Sin valor → campo normal SIN UI de variables (p. ej. Cola, Prioridad).
   */
  variable?: "define" | "use" | "insert";
}

export interface Outlet {
  id: string;
  label?: string;
}

export interface NodeKindDef {
  kind: NodeKind;
  label: string;
  group: "Inicio" | "Mensajes" | "Lógica" | "Acciones" | "IA" | "Fin";
  /** Hex accent — used for the node stripe AND the minimap dot. */
  accent: string;
  /** lucide icon key, mapped to a component in StepNode.tsx. */
  icon: string;
  blurb: string;
  fields: FieldDef[];
  /** Source handles this node exposes (drives branching). */
  outlets: (data: Record<string, unknown>) => Outlet[];
  defaultData: () => Record<string, unknown>;
  /** One-line body shown inside the node card. */
  summary: (data: Record<string, unknown>) => string;
}

export type ButtonKind = "reply" | "url" | "phone";
export interface ButtonDef {
  id: string;
  label: string;
  type?: ButtonKind;
  /** URL or phone number for non-reply buttons. */
  value?: string;
}
export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

/** Reply buttons branch the flow; URL/phone buttons are terminal actions. */
export function replyButtons(buttons: unknown): ButtonDef[] {
  return (Array.isArray(buttons) ? (buttons as ButtonDef[]) : []).filter(
    (b) => !b.type || b.type === "reply"
  );
}

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" && v.length > 0 ? v : fallback;

export const OP_LABEL: Record<string, string> = {
  equals: "es igual a",
  contains: "contiene",
  exists: "tiene algún valor",
  gt: "mayor que",
  lt: "menor que",
  regex: "coincide (regex)",
};

export const UNIT_LABEL: Record<string, string> = {
  minutes: "minutos",
  hours: "horas",
  days: "días",
};

/**
 * The catalog. Order matters — it's the order shown in the palette, grouped.
 */
export const NODE_KINDS: Record<NodeKind, NodeKindDef> = {
  start: {
    kind: "start",
    label: "Inicio",
    group: "Inicio",
    accent: "#1FAE6C",
    icon: "play",
    blurb: "Punto de entrada del bot",
    fields: [
      {
        key: "trigger",
        label: "Se dispara cuando",
        type: "select",
        options: [
          "Mensaje entrante (WhatsApp)",
          "Nuevo lead",
          "Palabra clave",
          "Manual / prueba",
        ],
      },
    ],
    outlets: () => [{ id: "out" }],
    defaultData: () => ({ trigger: "Mensaje entrante (WhatsApp)" }),
    summary: (d) => str(d.trigger, "Inicio"),
  },

  message: {
    kind: "message",
    label: "Enviar mensaje",
    group: "Mensajes",
    accent: "#22B8D9",
    icon: "message",
    blurb: "Texto + botones (respuesta, enlace o llamada)",
    fields: [
      {
        key: "text",
        label: "Mensaje",
        type: "textarea",
        placeholder: "Escribe lo que el bot dirá…",
        variable: "insert",
        help: "Podés personalizarlo con datos guardados usando «Insertar variable» (p. ej. ¡Hola {{nombre}}!).",
      },
      {
        key: "buttons",
        label: "Botones",
        type: "buttons",
        help: "Hasta 3. Los de «Respuesta» abren una rama en el flujo; los de enlace/llamada no.",
      },
    ],
    outlets: (d) => {
      const reply = replyButtons(d.buttons);
      return reply.length > 0
        ? reply.map((b) => ({ id: `b:${b.id}`, label: b.label || "Botón" }))
        : [{ id: "out" }];
    },
    defaultData: () => ({ text: "", buttons: [] as ButtonDef[] }),
    summary: (d) => str(d.text, "Mensaje vacío"),
  },

  list: {
    kind: "list",
    label: "Lista (WhatsApp)",
    group: "Mensajes",
    accent: "#17A2B8",
    icon: "list",
    blurb: "Menú de hasta 10 opciones con descripción",
    fields: [
      {
        key: "header",
        label: "Encabezado",
        type: "text",
        placeholder: "Programas UDEP",
        variable: "insert",
        help: "Título corto que aparece arriba de la lista.",
      },
      {
        key: "body",
        label: "Mensaje",
        type: "textarea",
        placeholder: "Elegí una opción para continuar:",
        variable: "insert",
      },
      {
        key: "buttonLabel",
        label: "Texto del botón",
        type: "text",
        placeholder: "Ver opciones",
        help: "El botón que abre la lista de opciones en WhatsApp.",
      },
      {
        key: "rows",
        label: "Opciones de la lista",
        type: "listrows",
        help: "Cada opción crea una rama: conectá su salida al siguiente paso.",
      },
    ],
    outlets: (d) => {
      const rows = Array.isArray(d.rows) ? (d.rows as ListRow[]) : [];
      return rows.length > 0
        ? rows.map((r) => ({ id: `r:${r.id}`, label: r.title || "Opción" }))
        : [{ id: "out" }];
    },
    defaultData: () => ({ header: "", body: "", buttonLabel: "Ver opciones", rows: [] as ListRow[] }),
    summary: (d) => str(d.body, str(d.header, "Lista de opciones")),
  },

  question: {
    kind: "question",
    label: "Preguntar y guardar",
    group: "Mensajes",
    accent: "#8B7EE8",
    icon: "help",
    blurb: "Pregunta y guarda la respuesta en una variable",
    fields: [
      {
        key: "prompt",
        label: "Pregunta",
        type: "textarea",
        placeholder: "¿Cuál es tu nombre completo?",
        variable: "insert",
        help: "Lo que el bot le pregunta al cliente. La respuesta se guarda en la variable de abajo.",
      },
      {
        key: "saveAs",
        label: "Guardar la respuesta como",
        type: "var",
        placeholder: "nombre",
        variable: "define",
        help: "Le ponés un nombre para reutilizarla después (p. ej. en un mensaje) con «Insertar variable».",
      },
      {
        key: "validate",
        label: "Validar como",
        type: "select",
        options: ["ninguna", "email", "teléfono", "número"],
        help: "El bot vuelve a preguntar si la respuesta no tiene el formato elegido.",
      },
    ],
    outlets: () => [{ id: "out" }],
    defaultData: () => ({ prompt: "", saveAs: "", validate: "ninguna" }),
    summary: (d) => str(d.prompt, "Pregunta…"),
  },

  condition: {
    kind: "condition",
    label: "Condición",
    group: "Lógica",
    accent: "#E0A23B",
    icon: "branch",
    blurb: "Ramifica según una variable o respuesta",
    fields: [
      {
        key: "variable",
        label: "¿Qué variable evaluar?",
        type: "var",
        placeholder: "carrera",
        variable: "use",
        help: "Elegí una variable guardada antes (p. ej. con «Preguntar y guardar»).",
      },
      {
        key: "op",
        label: "Operador",
        type: "select",
        options: ["equals", "contains", "exists", "gt", "lt", "regex"],
        help: "Cómo se compara la variable con el valor.",
      },
      { key: "value", label: "Valor", type: "text", placeholder: "Ingeniería" },
    ],
    outlets: () => [
      { id: "true", label: "Sí" },
      { id: "false", label: "No" },
    ],
    defaultData: () => ({ variable: "", op: "equals", value: "" }),
    summary: (d) =>
      `${str(d.variable, "var")} ${OP_LABEL[str(d.op, "equals")] || ""} ${str(
        d.value
      )}`.trim(),
  },

  template: {
    kind: "template",
    label: "Plantilla HSM",
    group: "Mensajes",
    accent: "#2BA8C7",
    icon: "template",
    blurb: "Envía una plantilla de WhatsApp aprobada",
    fields: [
      {
        key: "templateName",
        label: "Nombre de plantilla",
        type: "text",
        placeholder: "udep_info_pregrado",
      },
      { key: "language", label: "Idioma", type: "select", options: ["es", "en"] },
      {
        key: "variables",
        label: "Variables",
        type: "varlist",
        help: "Cada valor llena {{1}}, {{2}}… en orden. Dejalo vacío si la plantilla no tiene.",
      },
    ],
    outlets: () => [{ id: "out" }],
    defaultData: () => ({ templateName: "", language: "es", variables: [] as string[] }),
    summary: (d) => {
      const n = Array.isArray(d.variables) ? (d.variables as string[]).filter(Boolean).length : 0;
      const name = str(d.templateName, "(sin plantilla)");
      return n > 0 ? `${name} · ${n} var.` : name;
    },
  },

  delay: {
    kind: "delay",
    label: "Esperar",
    group: "Lógica",
    accent: "#6B7A99",
    icon: "clock",
    blurb: "Pausa antes del siguiente paso",
    fields: [
      { key: "amount", label: "Cantidad", type: "number", placeholder: "30" },
      {
        key: "unit",
        label: "Unidad",
        type: "select",
        options: ["minutes", "hours", "days"],
      },
    ],
    outlets: () => [{ id: "out" }],
    defaultData: () => ({ amount: 30, unit: "minutes" }),
    summary: (d) =>
      `Esperar ${str(String(d.amount), "0")} ${UNIT_LABEL[str(d.unit, "minutes")]}`,
  },

  set_field: {
    kind: "set_field",
    label: "Asignar campo",
    group: "Acciones",
    accent: "#8B7EE8",
    icon: "tag",
    blurb: "Actualiza un campo del lead/perfil",
    fields: [
      {
        key: "field",
        label: "Campo a guardar",
        type: "text",
        placeholder: "etapa",
        variable: "define",
        help: "Nombre del dato del lead/perfil que vas a actualizar. Queda como variable reutilizable.",
      },
      {
        key: "value",
        label: "Valor",
        type: "text",
        placeholder: "Interesado",
        variable: "insert",
        help: "Texto fijo o una variable con «Insertar variable» (p. ej. {{nombre}}).",
      },
    ],
    outlets: () => [{ id: "out" }],
    defaultData: () => ({ field: "", value: "" }),
    summary: (d) => `${str(d.field, "campo")} = ${str(d.value, "—")}`,
  },

  handoff: {
    kind: "handoff",
    label: "Derivar a agente",
    group: "Acciones",
    accent: "#1FAE6C",
    icon: "agent",
    blurb: "Pasa la conversación a una persona",
    fields: [
      {
        key: "queue",
        label: "Cola / equipo",
        type: "text",
        placeholder: "Admisión",
        help: "A qué equipo de Connect entra la conversación.",
      },
      {
        key: "priority",
        label: "Prioridad",
        type: "select",
        options: ["normal", "alta", "urgente"],
        help: "Ordena la conversación en la cola del agente.",
      },
      {
        key: "assignTo",
        label: "Asignar a (opcional)",
        type: "text",
        placeholder: "usuario o vacío",
        help: "Dejá vacío para que tome cualquier agente disponible de la cola.",
      },
      {
        key: "note",
        label: "Nota para el agente",
        type: "textarea",
        placeholder: "Contexto del lead…",
        variable: "insert",
        help: "Contexto que ve el agente al recibir el chat. Podés insertar variables.",
      },
    ],
    outlets: () => [{ id: "out", label: "Tras derivar" }],
    defaultData: () => ({ queue: "", priority: "normal", assignTo: "", note: "" }),
    summary: (d) => (str(d.queue) ? `Cola: ${str(d.queue)}` : "A cualquier agente"),
  },

  internal_note: {
    kind: "internal_note",
    label: "Nota interna",
    group: "Acciones",
    accent: "#6B7A99",
    icon: "note",
    blurb: "Aviso solo para el equipo",
    fields: [
      {
        key: "text",
        label: "Texto",
        type: "textarea",
        placeholder: "Lead caliente — llamar hoy",
        variable: "insert",
        help: "Aviso solo para tu equipo (no lo ve el cliente). Podés insertar variables.",
      },
      { key: "to", label: "Para (usuario)", type: "text", placeholder: "supervisor", help: "Opcional: a quién avisar." },
    ],
    outlets: () => [{ id: "out" }],
    defaultData: () => ({ text: "", to: "" }),
    summary: (d) => str(d.text, "Nota interna"),
  },

  webhook: {
    kind: "webhook",
    label: "Webhook",
    group: "Acciones",
    accent: "#8B7EE8",
    icon: "webhook",
    blurb: "Llama a un servicio externo (HTTP)",
    fields: [
      { key: "method", label: "Método", type: "select", options: ["POST", "GET"], help: "POST para enviar datos, GET para consultarlos." },
      {
        key: "url",
        label: "URL",
        type: "text",
        placeholder: "https://api.tu-sistema.com/lead",
        variable: "insert",
        help: "A dónde llama el bot. Podés meter variables en la ruta (p. ej. /lead/{{id}}).",
      },
      {
        key: "body",
        label: "Cuerpo (JSON)",
        type: "textarea",
        placeholder: '{ "phone": "{{phone}}" }',
        variable: "insert",
        help: "Datos que se envían. Usá variables con «Insertar variable».",
      },
    ],
    outlets: () => [
      { id: "ok", label: "OK" },
      { id: "error", label: "Error" },
    ],
    defaultData: () => ({ method: "POST", url: "", body: "" }),
    summary: (d) => `${str(d.method, "POST")} ${str(d.url, "—")}`,
  },

  ai_agent: {
    kind: "ai_agent",
    label: "Agente IA",
    group: "IA",
    accent: "#9B6DFF",
    icon: "bot",
    blurb: "Una IA conduce la conversación hacia un objetivo",
    fields: [
      {
        key: "model",
        label: "¿Qué IA / agente usar?",
        type: "select",
        options: [
          "Claude Opus 4.8 (Bedrock)",
          "Claude Sonnet 4.6 (Bedrock)",
          "Claude Haiku 4.5 (Bedrock)",
          "Amazon Q in Connect",
          "Amazon Lex (bot existente)",
        ],
      },
      {
        key: "objective",
        label: "Objetivo",
        type: "textarea",
        placeholder: "Calificar al lead: presupuesto, plazo y carrera de interés.",
        variable: "insert",
        help: "Qué tiene que lograr la IA en la conversación.",
      },
      {
        key: "instructions",
        label: "Instrucciones / persona",
        type: "textarea",
        placeholder: "Sos un asesor de admisión cordial. Respondé corto, en español…",
        variable: "insert",
        help: "Tono y reglas de la IA. Podés insertar variables ya capturadas.",
      },
      {
        key: "handoffWhen",
        label: "Derivar a humano cuando",
        type: "text",
        placeholder: "el cliente lo pida o se frustre",
        help: "Si pasa esto, la IA pasa la conversación a un agente (rama «Derivar»).",
      },
      { key: "maxTurns", label: "Máx. de turnos", type: "number", placeholder: "6", help: "Tope de idas y vueltas antes de cerrar o derivar." },
    ],
    outlets: () => [
      { id: "resolved", label: "Resuelto" },
      { id: "handoff", label: "Derivar a humano" },
    ],
    defaultData: () => ({
      model: "Claude Sonnet 4.6 (Bedrock)",
      objective: "",
      instructions: "",
      handoffWhen: "",
      maxTurns: 6,
    }),
    summary: (d) => {
      const m = str(d.model, "IA").replace(" (Bedrock)", "");
      const o = str(d.objective);
      return o ? `${m} · ${o}` : m;
    },
  },

  jump: {
    kind: "jump",
    label: "Ir a paso",
    group: "Lógica",
    accent: "#6B7A99",
    icon: "jump",
    blurb: "Salta a otro paso sin duplicar",
    fields: [{ key: "targetNodeId", label: "Ir a", type: "node-ref" }],
    outlets: () => [],
    defaultData: () => ({ targetNodeId: "" }),
    summary: () => "Ir a otro paso",
  },

  stop: {
    kind: "stop",
    label: "Fin",
    group: "Fin",
    accent: "#E5484D",
    icon: "stop",
    blurb: "Termina el bot",
    fields: [],
    outlets: () => [],
    defaultData: () => ({}),
    summary: () => "Fin del bot",
  },
};

/** Palette grouping order. */
export const PALETTE_GROUPS: NodeKindDef["group"][] = [
  "Mensajes",
  "Lógica",
  "Acciones",
  "IA",
  "Fin",
];

let _seq = 0;
function uid(prefix = "n"): string {
  _seq += 1;
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 6)
      : Math.floor(Math.random() * 1e6).toString(36);
  return `${prefix}_${rand}${_seq}`;
}

/** Build a fresh node of a given kind at a position. */
export function makeNode(kind: NodeKind, position: { x: number; y: number }): BotNode {
  return { id: uid(), kind, position, data: NODE_KINDS[kind].defaultData() };
}

/** Un aviso de validación, con el paso al que apunta (para saltar a él). */
export interface BotIssue {
  message: string;
  nodeId?: string;
}

/** Lightweight validation surfaced in the builder (non-blocking warnings). */
export function validateBot(bot: Bot): BotIssue[] {
  const issues: BotIssue[] = [];
  const starts = bot.nodes.filter((n) => n.kind === "start");
  if (starts.length === 0) issues.push({ message: "Falta un paso de Inicio." });
  if (starts.length > 1) issues.push({ message: "Hay más de un paso de Inicio.", nodeId: starts[1].id });

  const targets = new Set(bot.edges.map((e) => e.target));
  const sources = new Set(bot.edges.map((e) => e.source));
  for (const n of bot.nodes) {
    if (n.kind === "start") continue;
    if (!targets.has(n.id))
      issues.push({ message: `«${NODE_KINDS[n.kind].label}» no está conectado.`, nodeId: n.id });
  }
  for (const n of bot.nodes) {
    const hasOutlets = NODE_KINDS[n.kind].outlets(n.data).length > 0;
    if (hasOutlets && n.kind !== "stop" && !sources.has(n.id)) {
      issues.push({ message: `«${NODE_KINDS[n.kind].label}» no lleva a ningún lado.`, nodeId: n.id });
    }
  }
  return issues;
}

/** A realistic seed flow (UDEP admisión) — also powers the standalone demo. */
export function defaultBot(): Bot {
  return {
    botId: "demo",
    name: "Admisión UDEP · bienvenida",
    status: "draft",
    trigger: "Mensaje entrante (WhatsApp)",
    nodes: [
      { id: "start", kind: "start", position: { x: 240, y: 0 }, data: { trigger: "Mensaje entrante (WhatsApp)" } },
      {
        id: "msg1",
        kind: "message",
        position: { x: 180, y: 120 },
        data: {
          text: "¡Hola! 👋 Soy el asistente de Admisión UDEP. ¿En qué te puedo ayudar?",
          buttons: [
            { id: "pre", label: "Pregrado" },
            { id: "pos", label: "Posgrado" },
            { id: "ase", label: "Hablar con asesor" },
          ],
        },
      },
      {
        id: "q1",
        kind: "question",
        position: { x: -120, y: 470 },
        data: { prompt: "¡Genial! ¿Qué carrera de pregrado te interesa?", saveAs: "carrera", validate: "ninguna" },
      },
      {
        id: "tpl1",
        kind: "template",
        position: { x: -120, y: 690 },
        data: { templateName: "udep_info_pregrado", language: "es", variables: ["carrera"] },
      },
      { id: "stop1", kind: "stop", position: { x: -120, y: 910 }, data: {} },
      {
        id: "msgpos",
        kind: "message",
        position: { x: 240, y: 470 },
        data: { text: "Tenemos maestrías y diplomados. Te paso el catálogo y un asesor te contactará.", buttons: [] },
      },
      { id: "stoppos", kind: "stop", position: { x: 240, y: 690 }, data: {} },
      {
        id: "hand1",
        kind: "handoff",
        position: { x: 560, y: 470 },
        data: { queue: "Admisión", note: "Lead pidió hablar con un asesor desde el bot." },
      },
      { id: "stopase", kind: "stop", position: { x: 560, y: 690 }, data: {} },
    ],
    edges: [
      { id: "e0", source: "start", sourceHandle: "out", target: "msg1" },
      { id: "e1", source: "msg1", sourceHandle: "b:pre", target: "q1" },
      { id: "e2", source: "msg1", sourceHandle: "b:pos", target: "msgpos" },
      { id: "e3", source: "msg1", sourceHandle: "b:ase", target: "hand1" },
      { id: "e4", source: "q1", sourceHandle: "out", target: "tpl1" },
      { id: "e5", source: "tpl1", sourceHandle: "out", target: "stop1" },
      { id: "e6", source: "msgpos", sourceHandle: "out", target: "stoppos" },
      { id: "e7", source: "hand1", sourceHandle: "out", target: "stopase" },
    ],
  };
}

/* ─────────────────────── Predefined templates ───────────────────────
 * Kommo-style starter flows. Each `build()` returns a ready-to-edit Bot
 * (botId "" so saving creates a new one). Surfaced in the "Nuevo bot"
 * picker so users start from a real flow, not a blank canvas.
 */
/** Channels a template can run on — drives the badge in the card preview and
 * the channel filter in the gallery (Kommo-style). */
export type BotChannel =
  | "whatsapp"
  | "instagram"
  | "telegram"
  | "messenger"
  | "tiktok"
  | "email"
  | "webchat";
export interface ChannelDef {
  id: BotChannel;
  label: string;
  color: string;
}
export const BOT_CHANNELS: ChannelDef[] = [
  { id: "whatsapp", label: "WhatsApp", color: "#25D366" },
  { id: "instagram", label: "Instagram", color: "#E1306C" },
  { id: "telegram", label: "Telegram", color: "#229ED9" },
  { id: "messenger", label: "Messenger", color: "#0084FF" },
  { id: "tiktok", label: "TikTok", color: "#111111" },
  { id: "email", label: "Correo", color: "#6B7A99" },
  { id: "webchat", label: "Chat en vivo", color: "#22B8D9" },
];

/** Catalog categories — the tabs across the top of the gallery. */
export type BotCategory = "leads" | "comercial" | "cultivar" | "trabajo";
export interface CategoryDef {
  id: BotCategory;
  label: string;
}
export const BOT_CATEGORIES: CategoryDef[] = [
  { id: "leads", label: "Generar leads" },
  { id: "comercial", label: "Información comercial" },
  { id: "cultivar", label: "Cultivar leads" },
  { id: "trabajo", label: "Reducir trabajo" },
];

/** Short chat-mockup shown on a template card — the "imagen alusiva". */
export interface TemplatePreview {
  /** Bot's opening line, shown in the chat bubble. */
  bubble: string;
  /** Optional user reply chip. */
  reply?: string;
  /** Big decorative emoji. */
  emoji?: string;
}

export interface BotTemplate {
  id: string;
  name: string;
  description: string;
  /** lucide icon key handled in the picker. */
  icon: string;
  accent: string;
  /** Catalog tab. Omit for the always-first "blank" entry. */
  category?: BotCategory;
  /** Channels this template targets — first one drives the card badge. */
  channels?: BotChannel[];
  /** Card chat-mockup. */
  preview?: TemplatePreview;
  build: () => Bot;
}

const blankStart = (): BotNode => ({
  id: "start",
  kind: "start",
  position: { x: 260, y: 0 },
  data: { trigger: "Mensaje entrante (WhatsApp)" },
});

export const BOT_TEMPLATES: BotTemplate[] = [
  {
    id: "blank",
    name: "En blanco",
    description: "Empezá desde cero con solo el paso de Inicio.",
    icon: "plus",
    accent: "#6B7A99",
    build: () => ({
      botId: "",
      name: "Nuevo bot",
      status: "draft",
      trigger: "Mensaje entrante (WhatsApp)",
      nodes: [blankStart()],
      edges: [],
    }),
  },
  {
    id: "welcome",
    name: "Bienvenida + menú",
    description: "Saluda y ofrece opciones (Pregrado / Posgrado / Asesor).",
    icon: "message",
    accent: "#22B8D9",
    category: "comercial",
    channels: ["whatsapp"],
    preview: { bubble: "¡Hola! 👋 Soy el asistente. ¿En qué te puedo ayudar?", reply: "Pregrado", emoji: "👋" },
    build: () => defaultBot(),
  },
  {
    id: "qualify",
    name: "Calificación de lead",
    description: "Pide nombre, interés y presupuesto, y deriva a un asesor.",
    icon: "help",
    accent: "#8B7EE8",
    category: "leads",
    channels: ["whatsapp", "instagram"],
    preview: { bubble: "Para ayudarte mejor, ¿cuál es tu nombre completo?", reply: "María 😊", emoji: "📝" },
    build: () => ({
      botId: "",
      name: "Calificación de lead",
      status: "draft",
      trigger: "Mensaje entrante (WhatsApp)",
      nodes: [
        blankStart(),
        { id: "q1", kind: "question", position: { x: 240, y: 120 }, data: { prompt: "¡Hola! Para ayudarte mejor, ¿cuál es tu nombre completo?", saveAs: "nombre", validate: "ninguna" } },
        { id: "q2", kind: "question", position: { x: 240, y: 300 }, data: { prompt: "Gracias {{nombre}}. ¿Qué programa te interesa?", saveAs: "interes", validate: "ninguna" } },
        { id: "set1", kind: "set_field", position: { x: 240, y: 480 }, data: { field: "etapa", value: "Interesado" } },
        { id: "hand1", kind: "handoff", position: { x: 240, y: 620 }, data: { queue: "Admisión", priority: "alta", assignTo: "", note: "Lead calificado por el bot: {{nombre}} — interés: {{interes}}" } },
        { id: "stop1", kind: "stop", position: { x: 240, y: 800 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "q1" },
        { id: "e1", source: "q1", sourceHandle: "out", target: "q2" },
        { id: "e2", source: "q2", sourceHandle: "out", target: "set1" },
        { id: "e3", source: "set1", sourceHandle: "out", target: "hand1" },
        { id: "e4", source: "hand1", sourceHandle: "out", target: "stop1" },
      ],
    }),
  },
  {
    id: "faq",
    name: "Preguntas frecuentes",
    description: "Menú tipo lista de WhatsApp con respuestas automáticas.",
    icon: "list",
    accent: "#17A2B8",
    category: "trabajo",
    channels: ["whatsapp", "webchat"],
    preview: { bubble: "Elegí un tema y te respondo al instante:", reply: "Pagos y becas", emoji: "💡" },
    build: () => ({
      botId: "",
      name: "Preguntas frecuentes",
      status: "draft",
      trigger: "Mensaje entrante (WhatsApp)",
      nodes: [
        blankStart(),
        {
          id: "list1",
          kind: "list",
          position: { x: 220, y: 120 },
          data: {
            header: "¿En qué te ayudamos?",
            body: "Elegí un tema y te respondo al instante:",
            buttonLabel: "Ver temas",
            rows: [
              { id: "pagos", title: "Pagos y becas", description: "Costos, financiamiento" },
              { id: "horario", title: "Horarios", description: "Turnos y modalidad" },
              { id: "asesor", title: "Hablar con un asesor" },
            ],
          },
        },
        { id: "mp", kind: "message", position: { x: -80, y: 380 }, data: { text: "Tenemos planes de pago y becas por mérito. Te envío el detalle. 💸", buttons: [] } },
        { id: "mh", kind: "message", position: { x: 240, y: 380 }, data: { text: "Hay turnos mañana y noche, presencial y virtual. 📅", buttons: [] } },
        { id: "ha", kind: "handoff", position: { x: 560, y: 380 }, data: { queue: "Admisión", priority: "normal", assignTo: "", note: "Pidió asesor desde FAQ." } },
        { id: "s1", kind: "stop", position: { x: -80, y: 560 }, data: {} },
        { id: "s2", kind: "stop", position: { x: 240, y: 560 }, data: {} },
        { id: "s3", kind: "stop", position: { x: 560, y: 560 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "list1" },
        { id: "e1", source: "list1", sourceHandle: "r:pagos", target: "mp" },
        { id: "e2", source: "list1", sourceHandle: "r:horario", target: "mh" },
        { id: "e3", source: "list1", sourceHandle: "r:asesor", target: "ha" },
        { id: "e4", source: "mp", sourceHandle: "out", target: "s1" },
        { id: "e5", source: "mh", sourceHandle: "out", target: "s2" },
        { id: "e6", source: "ha", sourceHandle: "out", target: "s3" },
      ],
    }),
  },
  {
    id: "ai",
    name: "Agente IA",
    description: "Una IA conduce la conversación y deriva si hace falta.",
    icon: "bot",
    accent: "#9B6DFF",
    category: "comercial",
    channels: ["whatsapp", "instagram", "messenger"],
    preview: { bubble: "Soy tu asesor con IA, disponible 24/7 🤖", reply: "¿Cuánto cuesta?", emoji: "🤖" },
    build: () => ({
      botId: "",
      name: "Agente IA · admisión",
      status: "draft",
      trigger: "Mensaje entrante (WhatsApp)",
      nodes: [
        blankStart(),
        {
          id: "ai1",
          kind: "ai_agent",
          position: { x: 230, y: 140 },
          data: {
            model: "Claude Sonnet 4.6 (Bedrock)",
            objective: "Resolver dudas de admisión y agendar una cita si hay interés.",
            instructions: "Sos un asesor de admisión UDEP cordial y conciso. Respondé en español.",
            handoffWhen: "el cliente pida un humano o se frustre",
            maxTurns: 6,
          },
        },
        { id: "hand1", kind: "handoff", position: { x: 480, y: 360 }, data: { queue: "Admisión", priority: "alta", assignTo: "", note: "Derivado por el Agente IA." } },
        { id: "stopOk", kind: "stop", position: { x: 60, y: 360 }, data: {} },
        { id: "stopH", kind: "stop", position: { x: 480, y: 540 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "ai1" },
        { id: "e1", source: "ai1", sourceHandle: "resolved", target: "stopOk" },
        { id: "e2", source: "ai1", sourceHandle: "handoff", target: "hand1" },
        { id: "e3", source: "hand1", sourceHandle: "out", target: "stopH" },
      ],
    }),
  },
  {
    id: "reactivate",
    name: "Reactivación",
    description: "Plantilla de seguimiento para leads inactivos + espera.",
    icon: "clock",
    accent: "#E0A23B",
    category: "cultivar",
    channels: ["whatsapp"],
    preview: { bubble: "¿Seguís interesado? Estoy para ayudarte 😊", reply: "Sí, cuéntame", emoji: "🔔" },
    build: () => ({
      botId: "",
      name: "Reactivación de lead",
      status: "draft",
      trigger: "Lead sin actividad",
      nodes: [
        { id: "start", kind: "start", position: { x: 260, y: 0 }, data: { trigger: "Lead sin actividad" } },
        { id: "tpl1", kind: "template", position: { x: 240, y: 130 }, data: { templateName: "udep_reactivacion", language: "es", variables: ["nombre"] } },
        { id: "wait1", kind: "delay", position: { x: 240, y: 300 }, data: { amount: 2, unit: "days" } },
        {
          id: "msg1",
          kind: "message",
          position: { x: 220, y: 440 },
          data: { text: "¿Seguís interesado? Estoy para ayudarte 😊", buttons: [{ id: "si", label: "Sí, cuéntame", type: "reply" }, { id: "no", label: "Ahora no", type: "reply" }] },
        },
        { id: "hand1", kind: "handoff", position: { x: -40, y: 660 }, data: { queue: "Admisión", priority: "normal", assignTo: "", note: "Reactivado: quiere info." } },
        { id: "s1", kind: "stop", position: { x: -40, y: 840 }, data: {} },
        { id: "s2", kind: "stop", position: { x: 460, y: 660 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "tpl1" },
        { id: "e1", source: "tpl1", sourceHandle: "out", target: "wait1" },
        { id: "e2", source: "wait1", sourceHandle: "out", target: "msg1" },
        { id: "e3", source: "msg1", sourceHandle: "b:si", target: "hand1" },
        { id: "e4", source: "msg1", sourceHandle: "b:no", target: "s2" },
        { id: "e5", source: "hand1", sourceHandle: "out", target: "s1" },
      ],
    }),
  },
  {
    id: "citas",
    name: "Reserva de citas",
    description: "Agenda citas automáticamente y deriva el horario a tu equipo.",
    icon: "calendar",
    accent: "#E0A23B",
    category: "leads",
    channels: ["whatsapp"],
    preview: { bubble: "¡Hola! 👋 ¿Querés agendar una cita con nosotros?", reply: "Sí, agendar ✅", emoji: "📅" },
    build: () => ({
      botId: "",
      name: "Reserva de citas",
      status: "draft",
      trigger: "Mensaje entrante (WhatsApp)",
      nodes: [
        blankStart(),
        { id: "m1", kind: "message", position: { x: 240, y: 120 }, data: { text: "¡Hola! 👋 ¿Querés agendar una cita con nosotros?", buttons: [{ id: "si", label: "Sí, agendar", type: "reply" }, { id: "no", label: "Ahora no", type: "reply" }] } },
        { id: "q1", kind: "question", position: { x: -40, y: 360 }, data: { prompt: "¿Qué día y horario te queda mejor?", saveAs: "horario", validate: "ninguna" } },
        { id: "h1", kind: "handoff", position: { x: -40, y: 560 }, data: { queue: "Agenda", priority: "normal", assignTo: "", note: "Quiere cita: {{horario}}" } },
        { id: "s1", kind: "stop", position: { x: -40, y: 740 }, data: {} },
        { id: "s2", kind: "stop", position: { x: 480, y: 360 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "m1" },
        { id: "e1", source: "m1", sourceHandle: "b:si", target: "q1" },
        { id: "e2", source: "m1", sourceHandle: "b:no", target: "s2" },
        { id: "e3", source: "q1", sourceHandle: "out", target: "h1" },
        { id: "e4", source: "h1", sourceHandle: "out", target: "s1" },
      ],
    }),
  },
  {
    id: "telefono",
    name: "Te llamamos",
    description: "Captura el teléfono de leads que quieren que los llames.",
    icon: "phone",
    accent: "#10B981",
    category: "leads",
    channels: ["instagram", "tiktok"],
    preview: { bubble: "Dejá tu número y un asesor te llama 📞", reply: "+51 9...", emoji: "📞" },
    build: () => ({
      botId: "",
      name: "Te llamamos",
      status: "draft",
      trigger: "Mensaje entrante (WhatsApp)",
      nodes: [
        blankStart(),
        { id: "m1", kind: "message", position: { x: 240, y: 120 }, data: { text: "¡Te llamamos! 📞 Dejanos tu número y un asesor se comunica con vos.", buttons: [] } },
        { id: "q1", kind: "question", position: { x: 240, y: 300 }, data: { prompt: "¿A qué número te llamamos?", saveAs: "telefono", validate: "teléfono" } },
        { id: "set1", kind: "set_field", position: { x: 240, y: 480 }, data: { field: "telefono", value: "{{telefono}}" } },
        { id: "h1", kind: "handoff", position: { x: 240, y: 620 }, data: { queue: "Ventas", priority: "alta", assignTo: "", note: "Pidió llamada al {{telefono}}" } },
        { id: "s1", kind: "stop", position: { x: 240, y: 800 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "m1" },
        { id: "e1", source: "m1", sourceHandle: "out", target: "q1" },
        { id: "e2", source: "q1", sourceHandle: "out", target: "set1" },
        { id: "e3", source: "set1", sourceHandle: "out", target: "h1" },
        { id: "e4", source: "h1", sourceHandle: "out", target: "s1" },
      ],
    }),
  },
  {
    id: "nps",
    name: "Encuesta NPS",
    description: "Mide la satisfacción del 1 al 10 y ramifica según el puntaje.",
    icon: "star",
    accent: "#8B7EE8",
    category: "trabajo",
    channels: ["whatsapp"],
    preview: { bubble: "Del 1 al 10, ¿qué tan probable es que nos recomiendes? 🌟", reply: "9 🌟", emoji: "⭐" },
    build: () => ({
      botId: "",
      name: "Encuesta NPS",
      status: "draft",
      trigger: "Mensaje entrante (WhatsApp)",
      nodes: [
        blankStart(),
        { id: "q1", kind: "question", position: { x: 240, y: 120 }, data: { prompt: "Del 1 al 10, ¿qué tan probable es que nos recomiendes? 🌟", saveAs: "nps", validate: "número" } },
        { id: "c1", kind: "condition", position: { x: 240, y: 320 }, data: { variable: "nps", op: "gt", value: "8" } },
        { id: "mok", kind: "message", position: { x: -40, y: 520 }, data: { text: "¡Gracias! 🙌 Nos alegra que tengas una buena experiencia.", buttons: [] } },
        { id: "mlow", kind: "question", position: { x: 480, y: 520 }, data: { prompt: "Gracias por tu honestidad. ¿Qué podríamos mejorar?", saveAs: "feedback", validate: "ninguna" } },
        { id: "s1", kind: "stop", position: { x: -40, y: 700 }, data: {} },
        { id: "s2", kind: "stop", position: { x: 480, y: 720 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "q1" },
        { id: "e1", source: "q1", sourceHandle: "out", target: "c1" },
        { id: "e2", source: "c1", sourceHandle: "true", target: "mok" },
        { id: "e3", source: "c1", sourceHandle: "false", target: "mlow" },
        { id: "e4", source: "mok", sourceHandle: "out", target: "s1" },
        { id: "e5", source: "mlow", sourceHandle: "out", target: "s2" },
      ],
    }),
  },
  {
    id: "descuento",
    name: "Código de descuento",
    description: "Recompensá a tus seguidores con un código por palabra clave.",
    icon: "gift",
    accent: "#EC4899",
    category: "cultivar",
    channels: ["instagram"],
    preview: { bubble: "¡Gracias por seguirnos! 🎁 Tu código: DESC20", reply: "¡Genial!", emoji: "🎁" },
    build: () => ({
      botId: "",
      name: "Código de descuento",
      status: "draft",
      trigger: "Palabra clave",
      nodes: [
        { id: "start", kind: "start", position: { x: 260, y: 0 }, data: { trigger: "Palabra clave" } },
        { id: "m1", kind: "message", position: { x: 240, y: 130 }, data: { text: "¡Gracias por seguirnos! 🎁 Acá tenés tu código: DESC20 — 20% off en tu primera compra.", buttons: [{ id: "comprar", label: "Quiero comprar", type: "reply" }] } },
        { id: "h1", kind: "handoff", position: { x: 240, y: 360 }, data: { queue: "Ventas", priority: "normal", assignTo: "", note: "Usó el código DESC20." } },
        { id: "s1", kind: "stop", position: { x: 240, y: 560 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "m1" },
        { id: "e1", source: "m1", sourceHandle: "b:comprar", target: "h1" },
        { id: "e2", source: "h1", sourceHandle: "out", target: "s1" },
      ],
    }),
  },
  {
    id: "carrito",
    name: "Carrito abandonado",
    description: "Recupera ventas: recuerda el carrito y ofrece ayuda.",
    icon: "clock",
    accent: "#F59E0B",
    category: "cultivar",
    channels: ["whatsapp"],
    preview: { bubble: "¿Olvidaste algo en tu carrito? 🛒 Lo guardé para vos.", reply: "Ver carrito", emoji: "🛒" },
    build: () => ({
      botId: "",
      name: "Carrito abandonado",
      status: "draft",
      trigger: "Lead sin actividad",
      nodes: [
        { id: "start", kind: "start", position: { x: 260, y: 0 }, data: { trigger: "Lead sin actividad" } },
        { id: "wait1", kind: "delay", position: { x: 240, y: 130 }, data: { amount: 1, unit: "hours" } },
        { id: "m1", kind: "message", position: { x: 220, y: 280 }, data: { text: "¿Olvidaste algo en tu carrito? 🛒 Lo guardé para vos.", buttons: [{ id: "ver", label: "Ver mi carrito", type: "reply" }, { id: "no", label: "No, gracias", type: "reply" }] } },
        { id: "h1", kind: "handoff", position: { x: -40, y: 520 }, data: { queue: "Ventas", priority: "alta", assignTo: "", note: "Quiere retomar su carrito." } },
        { id: "s1", kind: "stop", position: { x: -40, y: 700 }, data: {} },
        { id: "s2", kind: "stop", position: { x: 480, y: 520 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "wait1" },
        { id: "e1", source: "wait1", sourceHandle: "out", target: "m1" },
        { id: "e2", source: "m1", sourceHandle: "b:ver", target: "h1" },
        { id: "e3", source: "m1", sourceHandle: "b:no", target: "s2" },
        { id: "e4", source: "h1", sourceHandle: "out", target: "s1" },
      ],
    }),
  },
  {
    id: "sorteo",
    name: "Sorteo / Giveaway",
    description: "Confirma la participación por palabra clave y etiqueta al lead.",
    icon: "gift",
    accent: "#06B6D4",
    category: "cultivar",
    channels: ["instagram"],
    preview: { bubble: "¡Ya estás participando! 🎉 Mucha suerte 🍀", reply: "SORTEO", emoji: "🎉" },
    build: () => ({
      botId: "",
      name: "Sorteo",
      status: "draft",
      trigger: "Palabra clave",
      nodes: [
        { id: "start", kind: "start", position: { x: 260, y: 0 }, data: { trigger: "Palabra clave" } },
        { id: "m1", kind: "message", position: { x: 240, y: 140 }, data: { text: "¡Ya estás participando en el sorteo! 🎉 Anunciamos al ganador el viernes. 🍀", buttons: [] } },
        { id: "set1", kind: "set_field", position: { x: 240, y: 320 }, data: { field: "etapa", value: "Participante sorteo" } },
        { id: "s1", kind: "stop", position: { x: 240, y: 480 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "m1" },
        { id: "e1", source: "m1", sourceHandle: "out", target: "set1" },
        { id: "e2", source: "set1", sourceHandle: "out", target: "s1" },
      ],
    }),
  },
  {
    id: "bienvenida-ig",
    name: "Bienvenida Instagram",
    description: "Saluda a tus nuevos seguidores y ofrece las novedades.",
    icon: "message",
    accent: "#EC4899",
    category: "comercial",
    channels: ["instagram"],
    preview: { bubble: "¡Gracias por seguirnos! 💜 ¿Te muestro lo nuevo?", reply: "¡Sí!", emoji: "💜" },
    build: () => ({
      botId: "",
      name: "Bienvenida Instagram",
      status: "draft",
      trigger: "Mensaje entrante (WhatsApp)",
      nodes: [
        blankStart(),
        { id: "m1", kind: "message", position: { x: 240, y: 130 }, data: { text: "¡Gracias por seguirnos! 💜 ¿Querés que te muestre las novedades?", buttons: [{ id: "si", label: "Sí, mostrame", type: "reply" }, { id: "no", label: "Ahora no", type: "reply" }] } },
        { id: "m2", kind: "message", position: { x: -40, y: 360 }, data: { text: "¡Genial! Acá tenés lo último. 🛍️ Cualquier duda, escribime.", buttons: [] } },
        { id: "s1", kind: "stop", position: { x: -40, y: 540 }, data: {} },
        { id: "s2", kind: "stop", position: { x: 480, y: 360 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "m1" },
        { id: "e1", source: "m1", sourceHandle: "b:si", target: "m2" },
        { id: "e2", source: "m1", sourceHandle: "b:no", target: "s2" },
        { id: "e3", source: "m2", sourceHandle: "out", target: "s1" },
      ],
    }),
  },
  {
    id: "resena",
    name: "Pedir reseña",
    description: "Pide una reseña tras la compra; deriva si hay una crítica.",
    icon: "star",
    accent: "#22C55E",
    category: "trabajo",
    channels: ["whatsapp"],
    preview: { bubble: "¿Nos dejarías una reseña? ⭐ ¡Nos ayuda un montón!", reply: "¡Claro!", emoji: "🌟" },
    build: () => ({
      botId: "",
      name: "Pedir reseña",
      status: "draft",
      trigger: "Mensaje entrante (WhatsApp)",
      nodes: [
        blankStart(),
        { id: "m1", kind: "message", position: { x: 240, y: 130 }, data: { text: "¿Cómo fue tu experiencia? ⭐ ¿Nos dejarías una reseña?", buttons: [{ id: "si", label: "Sí, con gusto", type: "reply" }, { id: "no", label: "No ahora", type: "reply" }] } },
        { id: "m2", kind: "message", position: { x: -40, y: 360 }, data: { text: "¡Gracias! 🙌 Podés dejarla acá: https://g.page/r/tu-negocio", buttons: [] } },
        { id: "s1", kind: "stop", position: { x: -40, y: 540 }, data: {} },
        { id: "s2", kind: "stop", position: { x: 480, y: 360 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "m1" },
        { id: "e1", source: "m1", sourceHandle: "b:si", target: "m2" },
        { id: "e2", source: "m1", sourceHandle: "b:no", target: "s2" },
        { id: "e3", source: "m2", sourceHandle: "out", target: "s1" },
      ],
    }),
  },
  {
    id: "catalogo",
    name: "Catálogo de productos",
    description: "Menú tipo lista para que el cliente explore tus productos.",
    icon: "list",
    accent: "#3B82F6",
    category: "comercial",
    channels: ["whatsapp"],
    preview: { bubble: "Mirá nuestro catálogo 🛍️ Elegí una categoría:", reply: "Ofertas", emoji: "🛍️" },
    build: () => ({
      botId: "",
      name: "Catálogo de productos",
      status: "draft",
      trigger: "Mensaje entrante (WhatsApp)",
      nodes: [
        blankStart(),
        { id: "list1", kind: "list", position: { x: 220, y: 130 }, data: { header: "Nuestro catálogo", body: "Elegí una categoría para ver los productos:", buttonLabel: "Ver categorías", rows: [{ id: "ofertas", title: "Ofertas", description: "Lo más vendido en descuento" }, { id: "nuevos", title: "Novedades" }, { id: "asesor", title: "Hablar con un asesor" }] } },
        { id: "m1", kind: "message", position: { x: -80, y: 400 }, data: { text: "¡Mirá nuestras ofertas! 🔥 Te paso el link.", buttons: [] } },
        { id: "m2", kind: "message", position: { x: 240, y: 400 }, data: { text: "Estas son las novedades de la semana. ✨", buttons: [] } },
        { id: "h1", kind: "handoff", position: { x: 560, y: 400 }, data: { queue: "Ventas", priority: "normal", assignTo: "", note: "Pidió asesor desde el catálogo." } },
        { id: "s1", kind: "stop", position: { x: -80, y: 580 }, data: {} },
        { id: "s2", kind: "stop", position: { x: 240, y: 580 }, data: {} },
        { id: "s3", kind: "stop", position: { x: 560, y: 580 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "list1" },
        { id: "e1", source: "list1", sourceHandle: "r:ofertas", target: "m1" },
        { id: "e2", source: "list1", sourceHandle: "r:nuevos", target: "m2" },
        { id: "e3", source: "list1", sourceHandle: "r:asesor", target: "h1" },
        { id: "e4", source: "m1", sourceHandle: "out", target: "s1" },
        { id: "e5", source: "m2", sourceHandle: "out", target: "s2" },
        { id: "e6", source: "h1", sourceHandle: "out", target: "s3" },
      ],
    }),
  },
  {
    id: "soporte",
    name: "Mesa de ayuda",
    description: "Triage de soporte: clasifica la consulta y deriva al equipo.",
    icon: "agent",
    accent: "#0EA5E9",
    category: "trabajo",
    channels: ["webchat", "whatsapp"],
    preview: { bubble: "¿Con qué necesitás ayuda hoy? 🛟", reply: "Soporte técnico", emoji: "🛟" },
    build: () => ({
      botId: "",
      name: "Mesa de ayuda",
      status: "draft",
      trigger: "Mensaje entrante (WhatsApp)",
      nodes: [
        blankStart(),
        { id: "list1", kind: "list", position: { x: 220, y: 130 }, data: { header: "¿Cómo te ayudamos?", body: "Elegí el tipo de consulta:", buttonLabel: "Ver opciones", rows: [{ id: "tecnico", title: "Soporte técnico" }, { id: "facturacion", title: "Facturación" }, { id: "otro", title: "Otra consulta" }] } },
        { id: "h1", kind: "handoff", position: { x: -40, y: 400 }, data: { queue: "Soporte", priority: "alta", assignTo: "", note: "Soporte técnico." } },
        { id: "h2", kind: "handoff", position: { x: 240, y: 400 }, data: { queue: "Facturación", priority: "normal", assignTo: "", note: "Consulta de facturación." } },
        { id: "h3", kind: "handoff", position: { x: 520, y: 400 }, data: { queue: "Soporte", priority: "normal", assignTo: "", note: "Otra consulta." } },
        { id: "s1", kind: "stop", position: { x: -40, y: 580 }, data: {} },
        { id: "s2", kind: "stop", position: { x: 240, y: 580 }, data: {} },
        { id: "s3", kind: "stop", position: { x: 520, y: 580 }, data: {} },
      ],
      edges: [
        { id: "e0", source: "start", sourceHandle: "out", target: "list1" },
        { id: "e1", source: "list1", sourceHandle: "r:tecnico", target: "h1" },
        { id: "e2", source: "list1", sourceHandle: "r:facturacion", target: "h2" },
        { id: "e3", source: "list1", sourceHandle: "r:otro", target: "h3" },
        { id: "e4", source: "h1", sourceHandle: "out", target: "s1" },
        { id: "e5", source: "h2", sourceHandle: "out", target: "s2" },
        { id: "e6", source: "h3", sourceHandle: "out", target: "s3" },
      ],
    }),
  },
];
