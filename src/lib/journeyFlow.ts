import {
  LogIn,
  Send,
  Clock,
  GitBranch,
  Shuffle,
  Zap,
  Flag,
  Tag,
  Pencil,
  ListChecks,
  BellRing,
  PhoneOutgoing,
  Webhook,
  Route,
  Target,
  DoorOpen,
  MessageCircle,
  Mail,
  ArrowRightLeft,
  TrendingUp,
  StickyNote,
  MailCheck,
  GraduationCap,
  CloudUpload,
  UserMinus,
  Briefcase,
  CalendarClock,
  Hourglass,
  GitFork,
  type LucideIcon,
} from "lucide-react";
import type { JourneyNode, JourneyNodeKind, JourneyEdge } from "@/hooks/useJourneys";
import type { FilterRule } from "@/hooks/useSegments";

/**
 * journeyFlow — catálogo ÚNICO de los pasos de un Journey, al estilo de
 * `botFlow.NODE_KINDS`. Es la fuente de verdad que alimenta la palette, el
 * NodePicker, el nodo del lienzo (JourneyStepNode), el inspector y la validación.
 * Agregar un paso nuevo = 1 entrada en `JourneyNodeKind` (useJourneys) + 1 entrada
 * aquí + 1 ícono. El MOTOR (planAdvance / journey-runner) ejecuta cada kind: los
 * pasos que solo cambian datos/CRM son `action` con un `type` (moveStage, tag,
 * webhook…), así el runner ya sabe correrlos.
 *
 * Rediseño 2026-07: Journeys pasa de la "línea de vida" vertical al mismo
 * build-flow horizontal de Bots (canvas React Flow). Este catálogo es la base.
 */

export type JourneyParams = Record<string, unknown>;

/** Una salida (outlet) del nodo → de aquí cuelga un edge. Los ids comunes son
 *  "out" (lineal), "yes"/"no" (rama), "a"/"b" (A/B); los bloques dinámicos
 *  (switch, esperar-evento) usan ids propios ("c0", "default", "met", "timeout"…). */
export interface JourneyOutlet {
  id: string;
  label?: string;
}

export interface JourneyKindDef {
  kind: JourneyNodeKind;
  /** Grupo en la palette (orden = JOURNEY_PALETTE_GROUPS). */
  group: string;
  label: string;
  /** Frase corta bajo el label (palette / picker). */
  blurb: string;
  /** Clave en JOURNEY_ICONS. */
  icon: string;
  /** Color de acento (token var(--…) o hex). */
  accent: string;
  /** Salidas del nodo, según sus params (ramas variables). */
  outlets: (p: JourneyParams) => JourneyOutlet[];
  /** Resumen legible que se pinta en el cuerpo del nodo. */
  summary: (p: JourneyParams) => string;
  /** Params iniciales al crear el nodo. */
  defaultParams?: () => JourneyParams;
  /** No aparece en la palette (se siembra una sola vez, p. ej. la Entrada). */
  notInPalette?: boolean;
  /** Paso terminal (sin salidas). */
  terminal?: boolean;
}

/** Íconos por clave string (para el picker/palette/nodo, como FLOW_ICONS en Bots). */
export const JOURNEY_ICONS: Record<string, LucideIcon> = {
  entry: LogIn,
  send: Send,
  whatsapp: MessageCircle,
  email: Mail,
  wait: Clock,
  branch: GitBranch,
  split: Shuffle,
  action: Zap,
  exit: Flag,
  tag: Tag,
  field: Pencil,
  task: ListChecks,
  notify: BellRing,
  dialer: PhoneOutgoing,
  webhook: Webhook,
  journey: Route,
  goal: Target,
  leave: DoorOpen,
  stage: ArrowRightLeft,
  score: TrendingUp,
  note: StickyNote,
  subscription: MailCheck,
  program: GraduationCap,
  sfpush: CloudUpload,
  unenroll: UserMinus,
  business: Briefcase,
  weekday: CalendarClock,
  event: Hourglass,
  switch: GitFork,
};

export function journeyIcon(key: string): LucideIcon {
  return JOURNEY_ICONS[key] || JOURNEY_ICONS.action;
}

/** Orden de los grupos en la palette (la Entrada se siembra, no se lista). */
export const JOURNEY_PALETTE_GROUPS = ["Mensajes", "Tiempo", "Lógica", "Acciones", "Fin"];

const single: JourneyOutlet[] = [{ id: "out" }];

/** Días de la semana (0=domingo) para "Esperar a día/hora". */
export const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function channelLabel(v: unknown): string {
  return v === "whatsapp" ? "WhatsApp" : v === "email" ? "Email" : "todos";
}

// ── El catálogo ──────────────────────────────────────────────────────────────
export const JOURNEY_KINDS: Record<JourneyNodeKind, JourneyKindDef> = {
  entry: {
    kind: "entry",
    group: "—",
    label: "Entrada",
    blurb: "Cómo entran los leads al recorrido",
    icon: "entry",
    accent: "#22B87A",
    outlets: () => single,
    summary: () => "Los leads entran aquí",
    notInPalette: true,
  },

  send: {
    kind: "send",
    group: "Mensajes",
    label: "Enviar mensaje",
    blurb: "WhatsApp o email al lead",
    icon: "send",
    accent: "#22B8D9",
    notInPalette: true, // back-compat: la palette usa send_whatsapp / send_email
    outlets: () => single,
    defaultParams: () => ({ channel: "whatsapp" }),
    summary: (p) => {
      const ch = p.channel === "email" ? "Email" : "WhatsApp";
      const t = str(p.templateName) || str(p.subject);
      return t ? `${ch} · ${t}` : `${ch} · (sin plantilla)`;
    },
  },

  wait: {
    kind: "wait",
    group: "Tiempo",
    label: "Esperar",
    blurb: "Días fijos o hasta que se cumpla algo",
    icon: "wait",
    accent: "#E0A72E",
    outlets: () => single,
    defaultParams: () => ({ days: 1 }),
    summary: (p) => {
      if (Array.isArray(p.untilRule) && p.untilRule.length) return "hasta que se cumpla…";
      const d = Number(p.days ?? 0);
      return d > 0 ? `${d} día${d === 1 ? "" : "s"}` : "(sin definir)";
    },
  },

  branch: {
    kind: "branch",
    group: "Lógica",
    label: "Ramificar",
    blurb: "Dos caminos según condiciones del lead",
    icon: "branch",
    accent: "#8B5CF6",
    outlets: () => [
      { id: "yes", label: "Sí" },
      { id: "no", label: "No" },
    ],
    defaultParams: () => ({ rules: [] as FilterRule[], match: "all" }),
    summary: (p) => {
      const n = Array.isArray(p.rules) ? p.rules.length : 0;
      const m = p.match === "any" ? "cualquiera" : "todas";
      return n ? `${n} ${n === 1 ? "condición" : "condiciones"} · ${m}` : "Sin condiciones";
    },
  },

  split: {
    kind: "split",
    group: "Lógica",
    label: "Test A/B",
    blurb: "Reparte los leads en dos variantes",
    icon: "split",
    accent: "#5B7CFA",
    outlets: () => [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    defaultParams: () => ({ percent: 50 }),
    summary: (p) => {
      const pct = clampPct(p.percent);
      return `${pct}% A · ${100 - pct}% B`;
    },
  },

  action: {
    kind: "action",
    group: "Acciones",
    label: "Acción",
    blurb: "Mover de etapa, webhook o encolar al dialer",
    icon: "action",
    accent: "#F2734B",
    notInPalette: true, // back-compat: la palette usa los bloques de acción específicos
    outlets: () => single,
    defaultParams: () => ({ type: "moveStage" }),
    summary: (p) => {
      if (p.type === "moveStage") return `Mover a etapa "${str(p.stageId) || "?"}"`;
      if (p.type === "webhook") return "Llamar webhook";
      if (p.type === "enqueueDialer") return "Llamar (encolar al dialer)";
      return "Acción (sin definir)";
    },
  },

  exit: {
    kind: "exit",
    group: "Fin",
    label: "Fin",
    blurb: "El lead sale del recorrido",
    icon: "exit",
    accent: "#64748B",
    outlets: () => [],
    summary: () => "El lead sale del recorrido",
    terminal: true,
  },

  // ── Fase 2: bloques nuevos (canales separados + acciones CRM + lógica) ──────
  send_whatsapp: {
    kind: "send_whatsapp",
    group: "Mensajes",
    label: "Enviar WhatsApp",
    blurb: "Manda una plantilla de WhatsApp",
    icon: "whatsapp",
    accent: "#22B87A",
    outlets: () => single,
    defaultParams: () => ({}),
    summary: (p) => `WhatsApp · ${str(p.templateName) || "(sin plantilla)"}`,
  },
  send_email: {
    kind: "send_email",
    group: "Mensajes",
    label: "Enviar email",
    blurb: "Manda un correo al lead",
    icon: "email",
    accent: "#3B82F6",
    outlets: () => single,
    defaultParams: () => ({}),
    summary: (p) => `Email · ${str(p.subject) || "(sin asunto)"}`,
  },
  move_stage: {
    kind: "move_stage",
    group: "Acciones",
    label: "Mover de etapa",
    blurb: "Cambia la etapa del lead en el pipeline",
    icon: "stage",
    accent: "#F2734B",
    outlets: () => single,
    defaultParams: () => ({ stageId: "" }),
    summary: (p) => `Mover a "${str(p.stageId) || "?"}"`,
  },
  tag: {
    kind: "tag",
    group: "Acciones",
    label: "Etiqueta",
    blurb: "Agrega o quita una etiqueta al lead",
    icon: "tag",
    accent: "#8B5CF6",
    outlets: () => single,
    defaultParams: () => ({ op: "add", tag: "" }),
    summary: (p) => `${p.op === "remove" ? "Quitar" : "Agregar"} etiqueta "${str(p.tag) || "?"}"`,
  },
  set_field: {
    kind: "set_field",
    group: "Acciones",
    label: "Actualizar campo",
    blurb: "Escribe un valor en un campo del lead",
    icon: "field",
    accent: "#0EA5E9",
    outlets: () => single,
    defaultParams: () => ({ field: "", value: "" }),
    summary: (p) => `${str(p.field) || "campo"} = ${str(p.value) || "?"}`,
  },
  notify_agent: {
    kind: "notify_agent",
    group: "Acciones",
    label: "Avisar a un agente",
    blurb: "Crea una tarea/aviso para el equipo",
    icon: "notify",
    accent: "#F59E0B",
    outlets: () => single,
    defaultParams: () => ({ message: "" }),
    summary: (p) => (str(p.message) ? `Avisar: ${str(p.message)}` : "Avisar a un agente"),
  },
  enqueue_dialer: {
    kind: "enqueue_dialer",
    group: "Acciones",
    label: "Llamar (dialer)",
    blurb: "Encola una llamada saliente automática",
    icon: "dialer",
    accent: "#10B981",
    outlets: () => single,
    defaultParams: () => ({}),
    summary: (p) =>
      str(p.campaignId) ? `Llamar · ${str(p.campaignName) || "campaña"}` : "Llamar (dialer)",
  },
  webhook: {
    kind: "webhook",
    group: "Acciones",
    label: "Llamar webhook",
    blurb: "Hace un POST a una URL externa",
    icon: "webhook",
    accent: "#64748B",
    outlets: () => single,
    defaultParams: () => ({ url: "" }),
    summary: (p) => `POST ${str(p.url) || "(sin URL)"}`,
  },
  start_journey: {
    kind: "start_journey",
    group: "Acciones",
    label: "Iniciar journey",
    blurb: "Inscribe al lead en otro recorrido",
    icon: "journey",
    accent: "#6366F1",
    outlets: () => single,
    defaultParams: () => ({ journeyId: "" }),
    summary: (p) => `Iniciar journey ${str(p.journeyName) || str(p.journeyId) || "?"}`,
  },
  leave: {
    kind: "leave",
    group: "Lógica",
    label: "Salir si…",
    blurb: "Saca al lead del recorrido si cumple una condición",
    icon: "leave",
    accent: "#EF4444",
    outlets: () => single,
    defaultParams: () => ({ rules: [] as FilterRule[], match: "all" }),
    summary: (p) => {
      const n = Array.isArray(p.rules) ? p.rules.length : 0;
      return n
        ? `Salir si ${n} ${n === 1 ? "condición" : "condiciones"}`
        : "Salir si… (sin condición)";
    },
  },
  goal: {
    kind: "goal",
    group: "Fin",
    label: "Objetivo",
    blurb: "Marca conversión y termina el recorrido",
    icon: "goal",
    accent: "#16A34A",
    outlets: () => [],
    summary: () => "Objetivo alcanzado (convierte)",
    terminal: true,
  },

  // ── Fase 3 — +10 módulos ────────────────────────────────────────────────────
  score: {
    kind: "score",
    group: "Acciones",
    label: "Puntuar (score ±)",
    blurb: "Suma o resta puntos al score del lead",
    icon: "score",
    accent: "#10B981",
    outlets: () => single,
    defaultParams: () => ({ delta: 10 }),
    summary: (p) => {
      const d = Number(p.delta ?? 0);
      return `${d >= 0 ? "+" : ""}${d} al score`;
    },
  },
  note: {
    kind: "note",
    group: "Acciones",
    label: "Nota interna",
    blurb: "Deja una nota en el historial del lead",
    icon: "note",
    accent: "#A78BFA",
    outlets: () => single,
    defaultParams: () => ({ text: "" }),
    summary: (p) => (str(p.text) ? `Nota: ${str(p.text)}` : "Nota interna"),
  },
  subscription: {
    kind: "subscription",
    group: "Acciones",
    label: "Suscripción",
    blurb: "Suscribe o da de baja al lead de un canal",
    icon: "subscription",
    accent: "#22B87A",
    outlets: () => single,
    defaultParams: () => ({ op: "subscribe", channel: "all" }),
    summary: (p) =>
      `${p.op === "unsubscribe" ? "Dar de baja" : "Suscribir"} · ${channelLabel(p.channel)}`,
  },
  set_program: {
    kind: "set_program",
    group: "Acciones",
    label: "Asignar programa",
    blurb: "Cambia el programa / unidad del lead",
    icon: "program",
    accent: "#6366F1",
    outlets: () => single,
    defaultParams: () => ({ programId: "" }),
    summary: (p) =>
      str(p.programName) || str(p.programId)
        ? `Programa: ${str(p.programName) || str(p.programId)}`
        : "Asignar programa",
  },
  sf_push: {
    kind: "sf_push",
    group: "Acciones",
    label: "Enviar a Salesforce",
    blurb: "Sincroniza el lead a Salesforce",
    icon: "sfpush",
    accent: "#00A1E0",
    outlets: () => single,
    defaultParams: () => ({}),
    summary: () => "Sincroniza el lead a Salesforce",
  },
  unenroll: {
    kind: "unenroll",
    group: "Acciones",
    label: "Sacar de un journey",
    blurb: "Quita al lead de OTRO recorrido",
    icon: "unenroll",
    accent: "#EF4444",
    outlets: () => single,
    defaultParams: () => ({ journeyId: "" }),
    summary: (p) =>
      str(p.journeyName) || str(p.journeyId)
        ? `Sacar de ${str(p.journeyName) || str(p.journeyId)}`
        : "Sacar de un journey",
  },
  wait_business: {
    kind: "wait_business",
    group: "Tiempo",
    label: "Esperar a horario laboral",
    blurb: "Pausa hasta la próxima ventana laboral",
    icon: "business",
    accent: "#E0A72E",
    outlets: () => single,
    defaultParams: () => ({ start: 9, end: 18 }),
    summary: (p) => `Hasta horario ${Number(p.start ?? 9)}–${Number(p.end ?? 18)}h`,
  },
  wait_weekday: {
    kind: "wait_weekday",
    group: "Tiempo",
    label: "Esperar a día/hora",
    blurb: "Pausa hasta el próximo día de la semana y hora",
    icon: "weekday",
    accent: "#E0A72E",
    outlets: () => single,
    defaultParams: () => ({ weekday: 1, hour: 9 }),
    summary: (p) => `Hasta ${WEEKDAYS[Number(p.weekday ?? 1)] || "lunes"} ${Number(p.hour ?? 9)}h`,
  },
  wait_event: {
    kind: "wait_event",
    group: "Lógica",
    label: "Esperar respuesta",
    blurb: "Espera a que el lead cumpla algo, con límite de días",
    icon: "event",
    accent: "#8B5CF6",
    outlets: () => [
      { id: "met", label: "Cumplió" },
      { id: "timeout", label: "No a tiempo" },
    ],
    defaultParams: () => ({ rules: [] as FilterRule[], match: "all", days: 3 }),
    summary: (p) => `Espera ${Number(p.days ?? 3)}d una respuesta`,
  },
  switch: {
    kind: "switch",
    group: "Lógica",
    label: "Ramificar múltiple",
    blurb: "Varios caminos según el valor de un campo",
    icon: "switch",
    accent: "#5B7CFA",
    outlets: (p) => {
      const cases = Array.isArray(p.cases) ? (p.cases as { id?: string; label?: string }[]) : [];
      return [
        ...cases.map((c, i) => ({ id: c.id || `c${i}`, label: c.label || `Caso ${i + 1}` })),
        { id: "default", label: "Otro" },
      ];
    },
    defaultParams: () => ({
      field: "grade",
      cases: [
        { id: "c0", label: "A", value: "A" },
        { id: "c1", label: "B", value: "B" },
      ],
    }),
    summary: (p) => {
      const n = Array.isArray(p.cases) ? p.cases.length : 0;
      return `Por ${str(p.field) || "campo"} · ${n} caso${n === 1 ? "" : "s"}`;
    },
  },
};

/** Pasos insertables desde la palette (todos menos la Entrada). */
export const INSERTABLE_KINDS: JourneyNodeKind[] = (
  Object.keys(JOURNEY_KINDS) as JourneyNodeKind[]
).filter((k) => !JOURNEY_KINDS[k].notInPalette);

// ── Helpers ──────────────────────────────────────────────────────────────────
export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}
export function clampPct(v: unknown): number {
  return Math.max(0, Math.min(100, Number(v ?? 50)));
}

export function outletsOf(node: JourneyNode): JourneyOutlet[] {
  return JOURNEY_KINDS[node.kind].outlets((node.params as JourneyParams) || {});
}
export function summaryOf(node: JourneyNode): string {
  return JOURNEY_KINDS[node.kind].summary((node.params as JourneyParams) || {});
}

// ── Validación (avisos, no bloqueantes) ──────────────────────────────────────
export interface JourneyIssue {
  message: string;
  nodeId?: string;
}

export function validateJourney(nodes: JourneyNode[], edges: JourneyEdge[]): JourneyIssue[] {
  const out: JourneyIssue[] = [];
  const entries = nodes.filter((n) => n.kind === "entry");
  if (entries.length === 0) out.push({ message: "Falta el nodo de Entrada." });
  if (entries.length > 1) out.push({ message: "Hay más de una Entrada — deja solo una." });
  const entry = entries[0];
  if (entry && !edges.some((e) => e.from === entry.id))
    out.push({ message: "La Entrada no lleva a ningún paso.", nodeId: entry.id });
  if (!nodes.some((n) => n.kind === "exit"))
    out.push({ message: "Agrega un Fin para cerrar el recorrido." });

  for (const n of nodes) {
    const p = (n.params as JourneyParams) || {};
    if (n.kind === "branch") {
      const outs = edges.filter((e) => e.from === n.id).map((e) => e.on || "out");
      if (!outs.includes("yes") || !outs.includes("no"))
        out.push({ message: "La rama necesita salida Sí y No.", nodeId: n.id });
    }
    if (n.kind === "split") {
      const outs = edges.filter((e) => e.from === n.id).map((e) => e.on || "out");
      if (!outs.includes("a") || !outs.includes("b"))
        out.push({ message: "El test A/B necesita salida A y B.", nodeId: n.id });
    }
    if ((n.kind === "send" || n.kind === "send_whatsapp") && !p.templateName && !p.subject)
      out.push({ message: "Un envío de WhatsApp no tiene plantilla.", nodeId: n.id });
    if (n.kind === "send_email" && !p.subject)
      out.push({ message: "Un envío de email no tiene asunto.", nodeId: n.id });
    if (
      n.kind === "wait" &&
      !Number(p.days) &&
      !(Array.isArray(p.untilRule) && p.untilRule.length) &&
      !p.untilDate
    )
      out.push({ message: "Una Espera no tiene tiempo definido.", nodeId: n.id });
    if (n.kind === "move_stage" && !p.stageId)
      out.push({ message: "Falta la etapa destino.", nodeId: n.id });
    if (n.kind === "tag" && !p.tag) out.push({ message: "La etiqueta está vacía.", nodeId: n.id });
    if (n.kind === "set_field" && !p.field)
      out.push({ message: "Falta el campo a actualizar.", nodeId: n.id });
    if (n.kind === "webhook" && !p.url)
      out.push({ message: "El webhook no tiene URL.", nodeId: n.id });
    if (n.kind === "start_journey" && !p.journeyId)
      out.push({ message: "No elegiste el journey a iniciar.", nodeId: n.id });
    if (n.kind === "leave" && !(Array.isArray(p.rules) && p.rules.length))
      out.push({ message: "«Salir si…» no tiene condición (saldría siempre).", nodeId: n.id });
    if (n.kind === "set_program" && !p.programId)
      out.push({ message: "Falta el programa a asignar.", nodeId: n.id });
    if (n.kind === "unenroll" && !p.journeyId)
      out.push({ message: "No elegiste el journey del que sacar al lead.", nodeId: n.id });
    if (n.kind === "wait_event" && !(Array.isArray(p.rules) && p.rules.length))
      out.push({ message: "«Esperar respuesta» no tiene condición que esperar.", nodeId: n.id });
    if (n.kind === "switch" && !p.field)
      out.push({ message: "«Ramificar múltiple» no tiene campo.", nodeId: n.id });
    // Suelto: sin edge entrante y no es Entrada (con una Entrada existente).
    if (
      n.kind !== "entry" &&
      !edges.some((e) => e.to === n.id) &&
      nodes.some((x) => x.kind === "entry")
    )
      out.push({
        message: `Paso "${JOURNEY_KINDS[n.kind].label}" suelto (sin entrada).`,
        nodeId: n.id,
      });
  }
  return out;
}
