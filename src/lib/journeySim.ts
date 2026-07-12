import type { Journey } from "@/hooks/useJourneys";
import type { FilterRule } from "@/hooks/useSegments";
import { JOURNEY_KINDS, type JourneyParams } from "@/lib/journeyFlow";

/**
 * journeySim — simulador DRY-RUN (puro, frontend) del recorrido que estás
 * creando. Camina el grafo con un lead de muestra: evalúa ramas y "Salir si…",
 * MUTA el lead en las acciones (mover etapa / etiqueta / campo) para que los
 * pasos siguientes vean el efecto, y acumula el tiempo de las esperas — SIN
 * enviar nada real. Es el equivalente de `planAdvance` pero para previsualizar el
 * camino en el editor (no toca AWS). Los envíos/acciones se REGISTRAN como "qué
 * haría", no se ejecutan.
 */
export type SimTone = "send" | "action" | "branch" | "wait" | "exit" | "goal" | "leave";

export interface SimStep {
  nodeId: string;
  kind: string;
  label: string;
  icon: string;
  accent: string;
  /** Qué haría este paso ("Enviaría WhatsApp: hola", "Rama Sí (cumple)"…). */
  detail: string;
  tone: SimTone;
}

export interface SimResult {
  steps: SimStep[];
  /** Cómo terminó el recorrido para este lead. */
  ended: "exit" | "goal" | "leave" | "loop" | "deadend";
  /** Total de días esperados a lo largo del camino. */
  waitedDays: number;
}

/** Evalúa una regla contra el lead (mismo set de ops que useSegments/leadFilter). */
function evalRule(lead: Record<string, unknown>, r: FilterRule): boolean {
  const v = lead[r.field];
  const val = r.value;
  switch (r.op) {
    case "eq":
      return String(v ?? "") === String(val ?? "");
    case "neq":
      return String(v ?? "") !== String(val ?? "");
    case "contains":
      return String(v ?? "")
        .toLowerCase()
        .includes(String(val ?? "").toLowerCase());
    case "gte":
      return Number(v) >= Number(val);
    case "lte":
      return Number(v) <= Number(val);
    case "in":
      return String(val ?? "")
        .split(",")
        .map((s) => s.trim())
        .includes(String(v ?? ""));
    case "exists":
      return v !== undefined && v !== null && v !== "";
    case "notexists":
      return v === undefined || v === null || v === "";
    default:
      return false;
  }
}
function evalRules(
  lead: Record<string, unknown>,
  rules: FilterRule[],
  match: "all" | "any",
): boolean {
  return match === "any"
    ? rules.some((r) => evalRule(lead, r))
    : rules.every((r) => evalRule(lead, r));
}

function str(v: unknown, fb = ""): string {
  return typeof v === "string" ? v : v == null ? fb : String(v);
}

export function simulateJourney(j: Journey, sampleLead: Record<string, unknown>): SimResult {
  const lead: Record<string, unknown> = { ...sampleLead };
  const byId = new Map(j.nodes.map((n) => [n.id, n]));
  const succ = (id: string, on?: string): string | undefined => {
    const es = j.edges.filter((e) => e.from === id);
    if (on) return es.find((e) => e.on === on)?.to ?? es.find((e) => !e.on)?.to;
    return (es.find((e) => !e.on) ?? es[0])?.to;
  };

  const steps: SimStep[] = [];
  const visited = new Set<string>();
  let waitedDays = 0;
  let ended: SimResult["ended"] = "deadend";
  const start = j.nodes.find((n) => n.kind === "entry") ?? j.nodes[0];
  let cur: string | undefined = start?.id;
  let guard = 0;

  const push = (nodeId: string, kind: string, detail: string, tone: SimTone) => {
    const def = JOURNEY_KINDS[kind as keyof typeof JOURNEY_KINDS];
    steps.push({
      nodeId,
      kind,
      label: def?.label ?? kind,
      icon: def?.icon ?? "action",
      accent: def?.accent ?? "#64748B",
      detail,
      tone,
    });
  };

  while (cur && guard++ < 100) {
    const node = byId.get(cur);
    if (!node) {
      ended = "deadend";
      break;
    }
    if (visited.has(cur)) {
      push(node.id, node.kind, "Vuelve a un paso ya visitado (ciclo).", "action");
      ended = "loop";
      break;
    }
    visited.add(cur);
    const p = (node.params as JourneyParams) || {};

    switch (node.kind) {
      case "entry":
        push(node.id, node.kind, "El lead entra al recorrido.", "action");
        cur = succ(cur);
        break;

      case "send":
      case "send_whatsapp": {
        const t = str(p.templateName) || str(p.subject);
        push(node.id, node.kind, `Enviaría WhatsApp${t ? `: ${t}` : " (sin plantilla)"}`, "send");
        cur = succ(cur);
        break;
      }
      case "send_email": {
        const t = str(p.subject);
        push(node.id, node.kind, `Enviaría email${t ? `: ${t}` : " (sin asunto)"}`, "send");
        cur = succ(cur);
        break;
      }

      case "wait": {
        if (str(p.untilDate)) {
          push(node.id, node.kind, `Esperaría hasta ${str(p.untilDate)}`, "wait");
        } else if (Array.isArray(p.untilRule) && p.untilRule.length) {
          push(node.id, node.kind, "Esperaría hasta que se cumpla la condición.", "wait");
        } else {
          const d = Number(p.days || 0);
          waitedDays += d;
          push(node.id, node.kind, `Esperaría ${d} día${d === 1 ? "" : "s"}.`, "wait");
        }
        cur = succ(cur);
        break;
      }

      case "branch": {
        const rules = (p.rules as FilterRule[]) || [];
        const yes = evalRules(lead, rules, (p.match as "all" | "any") || "all");
        push(
          node.id,
          node.kind,
          yes ? "Rama Sí (el lead cumple)." : "Rama No (no cumple).",
          "branch",
        );
        cur = succ(cur, yes ? "yes" : "no");
        break;
      }
      case "split": {
        const pct = Math.max(0, Math.min(100, Number(p.percent ?? 50)));
        push(node.id, node.kind, `Test A/B → sigo la rama A (${pct}%). B = el resto.`, "branch");
        cur = succ(cur, "a");
        break;
      }

      case "move_stage": {
        const s = str(p.stageId);
        lead.stageId = s;
        push(node.id, node.kind, `Movería a etapa "${s || "?"}".`, "action");
        cur = succ(cur);
        break;
      }
      case "tag": {
        const tag = str(p.tag);
        const rm = p.op === "remove";
        const curTags = Array.isArray(lead.tags) ? (lead.tags as unknown[]).map(String) : [];
        lead.tags = rm ? curTags.filter((t) => t !== tag) : Array.from(new Set([...curTags, tag]));
        push(
          node.id,
          node.kind,
          `${rm ? "Quitaría" : "Agregaría"} la etiqueta "${tag || "?"}".`,
          "action",
        );
        cur = succ(cur);
        break;
      }
      case "set_field": {
        const f = str(p.field);
        if (f) lead[f] = p.value;
        push(node.id, node.kind, `${f || "campo"} = ${str(p.value) || "(vacío)"}.`, "action");
        cur = succ(cur);
        break;
      }
      case "notify_agent":
        push(
          node.id,
          node.kind,
          `Avisaría a un agente${str(p.message) ? `: ${str(p.message)}` : "."}`,
          "action",
        );
        cur = succ(cur);
        break;
      case "enqueue_dialer":
        push(node.id, node.kind, "Encolaría una llamada saliente.", "action");
        cur = succ(cur);
        break;
      case "webhook":
        push(node.id, node.kind, `Llamaría el webhook ${str(p.url) || "(sin URL)"}.`, "action");
        cur = succ(cur);
        break;
      case "start_journey":
        push(
          node.id,
          node.kind,
          `Iniciaría el journey "${str(p.journeyName) || str(p.journeyId) || "?"}".`,
          "action",
        );
        cur = succ(cur);
        break;
      case "action": {
        // Legacy: acción genérica con params.type.
        const type = str(p.type);
        if (type === "moveStage") lead.stageId = str(p.stageId);
        push(node.id, node.kind, `Acción: ${type || "(sin tipo)"}.`, "action");
        cur = succ(cur);
        break;
      }

      case "leave": {
        const rules = (p.rules as FilterRule[]) || [];
        const met = rules.length > 0 && evalRules(lead, rules, (p.match as "all" | "any") || "all");
        if (met) {
          push(node.id, node.kind, "Sale del recorrido (cumple la condición).", "leave");
          ended = "leave";
          cur = undefined;
        } else {
          push(node.id, node.kind, "No sale (no cumple) → continúa.", "leave");
          cur = succ(cur);
        }
        break;
      }
      case "goal":
        push(node.id, node.kind, "Objetivo alcanzado → convierte y termina.", "goal");
        ended = "goal";
        cur = undefined;
        break;
      case "exit":
        push(node.id, node.kind, "Fin del recorrido.", "exit");
        ended = "exit";
        cur = undefined;
        break;

      default:
        cur = succ(cur);
        break;
    }
  }

  return { steps, ended, waitedDays };
}
