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

export type JourneyNodeKind = "entry" | "send" | "wait" | "branch" | "action" | "exit";

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
  on?: "yes" | "no";
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

/** Efecto a ejecutar por el runner (side effect). */
export type JourneyEffect =
  | { type: "send"; channel: string; params: Record<string, unknown> }
  | { type: "action"; action: string; params: Record<string, unknown> };

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
function successor(j: JourneyDef, id: string, on?: "yes" | "no"): string | undefined {
  const edges = j.edges.filter((e) => e.from === id);
  if (on) return edges.find((e) => e.on === on)?.to || edges.find((e) => !e.on)?.to;
  return (edges.find((e) => !e.on) || edges[0])?.to;
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

      case "send": {
        effects.push({
          type: "send",
          channel: String(node.params?.channel || "whatsapp"),
          params: node.params || {},
        });
        const nxt = successor(j, node.id);
        if (!nxt) return { effects, nextNodeId: node.id, nextRunAt: nowIso, done: true };
        node = nodeById(j, nxt);
        break;
      }

      case "action": {
        effects.push({
          type: "action",
          action: String(node.params?.type || ""),
          params: node.params || {},
        });
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

      case "wait": {
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
