/**
 * journeys — modelo + lógica de avance del motor de JOURNEYS (Fase 3 · Engagement
 * Studio). Un journey es una secuencia con estado por-lead: entrar → paso →
 * esperar → ramificar → …→ salir. Reemplaza el drip de Pardot (P1 del audit).
 *
 * `planAdvance` es la parte PURA (dado journey + nodo actual + lead + now →
 * qué efectos disparar + dónde queda el enrollment + cuándo lo retomamos). Los
 * EFECTOS (enviar WhatsApp/email, mover etapa, encolar dialer…) los ejecuta el
 * `journey-runner` con los senders/executors existentes. Así la lógica se testea
 * sin AWS y el runner queda fino.
 *
 * Modelo de "descanso": el enrollment SIEMPRE descansa en el nodo pendiente de
 * ejecutar. Un `wait` no descansa EN sí mismo: setea `nextRunAt` futuro y deja el
 * enrollment en su SUCESOR (así el próximo tick que venza ejecuta el sucesor con
 * el lead fresco — clave para que un `branch` tras un `wait` vea la respuesta).
 */
import { evaluateLeadFilter, type FilterRule, type FilterableLead } from "./leadFilter";

export type JourneyNodeKind =
  | "entry"
  | "send"
  | "wait"
  | "branch"
  | "split"
  | "action"
  | "exit"
  // Fase 2 — bloques nuevos. send_*/action-like se resuelven a efectos send/action
  // (el runner ya sabe ejecutarlos); goal/leave son terminales/guard.
  | "send_whatsapp"
  | "send_email"
  | "move_stage"
  | "tag"
  | "set_field"
  | "notify_agent"
  | "enqueue_dialer"
  | "webhook"
  | "start_journey"
  | "leave"
  | "goal";

/** Mapea un kind "action-like" al nombre de acción que ejecuta el runner. */
const ACTION_OF: Partial<Record<JourneyNodeKind, string>> = {
  move_stage: "moveStage",
  tag: "tag",
  set_field: "setField",
  notify_agent: "notify",
  enqueue_dialer: "enqueueDialer",
  webhook: "webhook",
  start_journey: "startJourney",
};

export interface JourneyNode {
  id: string;
  kind: JourneyNodeKind;
  // send: { channel:"whatsapp"|"email", templateName?, subject?, body? }
  // wait: { days:number } | { untilRule: FilterRule[], untilMatch?: "all"|"any" }
  // branch: { rules: FilterRule[], match?: "all"|"any" }  → edges on "yes"/"no"
  // action: { type:"moveStage"|"task"|"webhook"|"enqueueDialer", ...params }
  params?: Record<string, unknown>;
}

export interface JourneyEdge {
  from: string;
  to: string;
  /** Salida tomada: branch→"yes"/"no", split A/B→"a"/"b", lineal→undefined. */
  on?: string;
}

export interface JourneyDef {
  tenantId?: string;
  journeyId: string;
  name: string;
  status: "draft" | "active" | "paused";
  /** Cómo entra un lead: por trigger, por segmento, o manual. */
  entry?: { trigger?: string; segmentId?: string; manual?: boolean };
  /** ¿Un lead que ya salió puede re-entrar? Default false. */
  reenroll?: boolean;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  goal?: { segmentId?: string; stageId?: string };
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Enrollment {
  journeyId: string;
  leadId: string;
  currentNodeId: string;
  status: "active" | "done" | "exited";
  enteredAt: string;
  nextRunAt: string;
  history: { node: string; at: string }[];
}

/** Efecto a ejecutar por el runner (side effect). `nodeId` = origen (idempotencia). */
export type JourneyEffect =
  | { type: "send"; nodeId: string; channel: string; params: Record<string, unknown> }
  | { type: "action"; nodeId: string; action: string; params: Record<string, unknown> };

export interface AdvancePlan {
  effects: JourneyEffect[];
  /** Nodo donde queda el enrollment tras este tick. */
  nextNodeId: string;
  /** Cuándo retomarlo (ISO). */
  nextRunAt: string;
  /** ¿El journey terminó para este lead? */
  done: boolean;
}

const DAY_MS = 86_400_000;

function nodeById(j: JourneyDef, id: string): JourneyNode | undefined {
  return j.nodes.find((n) => n.id === id);
}
/** Sucesor por defecto (edge sin `on`, o el primero). */
function successor(j: JourneyDef, id: string, on?: string): string | undefined {
  const edges = j.edges.filter((e) => e.from === id);
  if (on) return edges.find((e) => e.on === on)?.to || edges.find((e) => !e.on)?.to;
  return (edges.find((e) => !e.on) || edges[0])?.to;
}

/** Hash determinístico → bucket 0..99 (para el split A/B estable por lead). */
function hashPercent(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}

/**
 * Calcula el avance desde el nodo actual: encadena nodos instantáneos
 * (send/action/branch) acumulando efectos hasta toparse con un `wait` (que
 * setea la demora) o un `exit`/sin-salida (que termina). Puro.
 *
 * @param lead lead fresco (para evaluar branches y waits condicionales).
 * @param nowMs "now" inyectable (tests); default Date.now().
 */
export function planAdvance(
  j: JourneyDef,
  currentNodeId: string,
  lead: FilterableLead,
  nowMs: number = Date.now(),
): AdvancePlan {
  const nowIso = new Date(nowMs).toISOString();
  const effects: JourneyEffect[] = [];
  let node = nodeById(j, currentNodeId);
  let guard = 0;

  while (node && guard++ < 50) {
    switch (node.kind) {
      case "exit":
        return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };

      case "entry": {
        const nxt = successor(j, node.id);
        if (!nxt) return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };
        node = nodeById(j, nxt);
        break;
      }

      case "send":
      case "send_whatsapp":
      case "send_email": {
        const channel =
          node.kind === "send_email"
            ? "email"
            : node.kind === "send_whatsapp"
              ? "whatsapp"
              : String(node.params?.channel || "whatsapp");
        effects.push({ type: "send", nodeId: node.id, channel, params: node.params || {} });
        const nxt = successor(j, node.id);
        if (!nxt) return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };
        node = nodeById(j, nxt);
        break;
      }

      case "action":
      case "move_stage":
      case "tag":
      case "set_field":
      case "notify_agent":
      case "enqueue_dialer":
      case "webhook":
      case "start_journey": {
        const action =
          node.kind === "action" ? String(node.params?.type || "") : ACTION_OF[node.kind] || "";
        effects.push({ type: "action", nodeId: node.id, action, params: node.params || {} });
        const nxt = successor(j, node.id);
        if (!nxt) return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };
        node = nodeById(j, nxt);
        break;
      }

      case "goal": {
        // Objetivo: marca conversión (efecto) y termina el recorrido para este lead.
        effects.push({
          type: "action",
          nodeId: node.id,
          action: "goal",
          params: node.params || {},
        });
        return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };
      }

      case "leave": {
        // Salir si…: si el lead cumple las reglas, sale ya; si no, continúa.
        const rules = (node.params?.rules as FilterRule[]) || [];
        const match = (node.params?.match as "all" | "any") || "all";
        if (rules.length > 0 && evaluateLeadFilter(lead, rules, match))
          return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };
        const nxt = successor(j, node.id);
        if (!nxt) return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };
        node = nodeById(j, nxt);
        break;
      }

      case "branch": {
        const rules = (node.params?.rules as FilterRule[]) || [];
        const match = (node.params?.match as "all" | "any") || "all";
        const yes = evaluateLeadFilter(lead, rules, match);
        const nxt = successor(j, node.id, yes ? "yes" : "no");
        if (!nxt) return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };
        node = nodeById(j, nxt);
        break;
      }

      case "split": {
        // A/B test: reparte estable por lead. `percent` = % que va a la rama "a".
        const pct = Math.max(0, Math.min(100, Number(node.params?.percent ?? 50)));
        const seed =
          String(
            (lead as { leadId?: string; phone?: string }).leadId ||
              (lead as { phone?: string }).phone ||
              "",
          ) + node.id;
        const on = hashPercent(seed) < pct ? "a" : "b";
        const nxt = successor(j, node.id, on);
        if (!nxt) return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };
        node = nodeById(j, nxt);
        break;
      }

      case "wait": {
        // Espera hasta una fecha/hora concreta: descansa en el SUCESOR hasta esa fecha.
        const untilDate = node.params?.untilDate as string | undefined;
        if (untilDate) {
          const target = Date.parse(untilDate);
          const nxt = successor(j, node.id);
          if (!nxt) return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };
          if (!Number.isFinite(target) || target <= nowMs) {
            node = nodeById(j, nxt); // ya venció (o inválida) → seguir ya
            break;
          }
          return {
            effects,
            nextNodeId: nxt,
            nextRunAt: new Date(target).toISOString(),
            done: false,
          };
        }
        // Espera condicional: re-evalúa cada tick hasta cumplirse; entonces sigue.
        const untilRule = node.params?.untilRule as FilterRule[] | undefined;
        if (untilRule && untilRule.length) {
          const met = evaluateLeadFilter(
            lead,
            untilRule,
            (node.params?.untilMatch as "all" | "any") || "all",
          );
          if (!met) {
            // Sigue esperando: descansa EN el wait, re-chequea al próximo tick.
            return {
              effects,
              nextNodeId: node.id,
              nextRunAt: new Date(nowMs + 5 * 60_000).toISOString(),
              done: false,
            };
          }
        } else {
          // Espera fija por días: descansa en el SUCESOR, con la demora.
          const days = Number(node.params?.days) || 0;
          const nxt = successor(j, node.id);
          if (!nxt) return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };
          return {
            effects,
            nextNodeId: nxt,
            nextRunAt: new Date(nowMs + days * DAY_MS).toISOString(),
            done: false,
          };
        }
        // untilRule cumplida → seguir al sucesor ya mismo.
        const nxt = successor(j, node.id);
        if (!nxt) return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };
        node = nodeById(j, nxt);
        break;
      }

      default:
        return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };
    }
  }

  // Cap de seguridad o nodo inexistente → terminar (evita loops).
  return { effects, nextNodeId: currentNodeId, nextRunAt: nowIso, done: true };
}

/** Nodo de entrada del journey (kind:"entry", o el primero sin edges entrantes). */
export function entryNodeId(j: JourneyDef): string | undefined {
  const entry = j.nodes.find((n) => n.kind === "entry");
  if (entry) return entry.id;
  const hasIncoming = new Set(j.edges.map((e) => e.to));
  return j.nodes.find((n) => !hasIncoming.has(n.id))?.id || j.nodes[0]?.id;
}
