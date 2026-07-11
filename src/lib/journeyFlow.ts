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

/** Una salida (outlet) del nodo → de aquí cuelga un edge. */
export interface JourneyOutlet {
  id: "out" | "yes" | "no" | "a" | "b";
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
};

export function journeyIcon(key: string): LucideIcon {
  return JOURNEY_ICONS[key] || JOURNEY_ICONS.action;
}

/** Orden de los grupos en la palette (la Entrada se siembra, no se lista). */
export const JOURNEY_PALETTE_GROUPS = ["Mensajes", "Tiempo", "Lógica", "Acciones", "Fin"];

const single: JourneyOutlet[] = [{ id: "out" }];

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
    if (n.kind === "send" && !p.templateName && !p.subject)
      out.push({ message: "Un paso Enviar no tiene plantilla/asunto.", nodeId: n.id });
    if (n.kind === "wait" && !Number(p.days) && !(Array.isArray(p.untilRule) && p.untilRule.length))
      out.push({ message: "Una Espera no tiene tiempo definido.", nodeId: n.id });
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
