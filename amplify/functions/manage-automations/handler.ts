import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "node:crypto";
import { getIdentity } from "../_shared/cognitoAuth";

/**
 * manage-automations — CRUD de las reglas de automatización (#15, el "Digital
 * Pipeline" de ARIA): trigger → condiciones → acciones, que el Lambda
 * `automation-engine` evalúa (eventos de hooks + tick de EventBridge).
 *
 * STORAGE: tabla POOLED Vox-side `connectview-automation-rules` (PK tenantId,
 * SK sk). Las reglas son CONFIGURACIÓN del producto (como -connections y
 * -permissions), no datos del negocio del cliente → no viven en el BYO Data
 * Plane. Single-table:
 *   · sk = "rule#<ruleId>"            → la regla
 *   · sk = "run#<ruleId>#<ISO>#<rnd>" → log de ejecución (sin PII; TTL expireAt)
 *
 * SEGURIDAD: tenantId SIEMPRE del JWT (getIdentity); anónimo → 401. Escrituras
 * solo Admins. CORS vive en la config del Function URL (G1) — acá solo
 * Content-Type (duplicar Access-Control-* rompe el preflight del browser).
 *
 * GET                  → { rules: [...] }
 * GET ?runs=<ruleId>   → { runs: [...] } (últimas 50 de esa regla)
 * GET ?runs=all        → { runs: [...] } (recientes del tenant, mezcla de reglas)
 * POST { rule }        → upsert (preserva createdAt/firedCount/lastFiredAt)
 * DELETE ?ruleId=ID    → borra la regla (los run# expiran solos por TTL)
 */
const dynamo = new DynamoDBClient({});
const TABLE = process.env.RULES_TABLE || "connectview-automation-rules";
// Dry-run (testRule): lee el lead real del data plane pooled (tenant fundador).
const LEADS_TABLE = process.env.LEADS_TABLE || "connectview-leads";
const HDRS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: HDRS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({ statusCode: c, headers: HDRS, body: JSON.stringify({ error: e }) });

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

export interface AutomationRule {
  ruleId: string;
  name: string;
  enabled: boolean;
  trigger: { type: TriggerType; params?: Record<string, unknown> };
  conditions?: Array<{ field: string; op: "eq" | "neq"; value: string }>;
  actions: Array<{ type: ActionType; params?: Record<string, unknown> }>;
  firedCount?: number;
  lastFiredAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

const TRIGGER_TYPES: TriggerType[] = [
  "lead_created",
  "lead_stage_changed",
  "lead_inactive",
  "wrapup_saved",
  "whatsapp_flow_completed",
  "message_inbound",
  "appointment_scheduled",
  "tag_applied",
];
const ACTION_TYPES: ActionType[] = [
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

async function queryPrefix(tenantId: string, prefix: string, limit?: number, newestFirst = false) {
  const out: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "tenantId = :t AND begins_with(sk, :p)",
        ExpressionAttributeValues: marshall({ ":t": tenantId, ":p": prefix }),
        ScanIndexForward: !newestFirst,
        Limit: limit,
        ExclusiveStartKey: lastKey as never,
      })
    );
    for (const it of res.Items || []) out.push(unmarshall(it));
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    if (limit && out.length >= limit) break;
  } while (lastKey);
  return limit ? out.slice(0, limit) : out;
}

// ───────────────────────── dry-run (testRule) ─────────────────────────
// Réplica MÍNIMA de la lógica del engine (matchesConditions + tokens) para
// previsualizar una regla SIN ejecutarla ni importar el engine (evita arrastrar
// sus deps de runtime SDK). Si el engine cambia el operador de condiciones,
// actualizar acá también.

interface DryCtx {
  leadId?: string;
  phone?: string;
  name?: string;
  email?: string;
  stageId?: string;
  source?: string;
  attributes?: Record<string, string>;
}

function fillTokens(s: string, ctx: DryCtx): string {
  return s
    .replace(/\{\{\s*name\s*\}\}/gi, ctx.name || "")
    .replace(/\{\{\s*phone\s*\}\}/gi, ctx.phone || "")
    .replace(/\{\{\s*stage\s*\}\}/gi, ctx.stageId || "")
    .replace(/\{\{\s*email\s*\}\}/gi, ctx.email || "");
}

/** Evalúa cada condición contra el lead; devuelve el desglose (mismo operador
 *  eq/neq case-insensitive que el engine). */
function evalConditions(
  conditions: Array<{ field: string; op: "eq" | "neq"; value: string }>,
  ctx: DryCtx,
): { pass: boolean; detail: Array<{ field: string; op: string; value: string; actual: string; pass: boolean }> } {
  const detail = (conditions || []).map((c) => {
    const actual = String((ctx as unknown as Record<string, unknown>)[c.field] ?? "").toLowerCase();
    const expected = String(c.value ?? "").toLowerCase();
    const pass = c.op === "neq" ? actual !== expected : actual === expected;
    return { field: c.field, op: c.op, value: c.value, actual, pass };
  });
  return { pass: detail.every((d) => d.pass), detail };
}

/** Preview textual de qué HARÍA una acción (nada se ejecuta). */
function previewAction(
  action: { type: ActionType; params?: Record<string, unknown> },
  ctx: DryCtx,
): string {
  const p = action.params || {};
  const who = ctx.phone || ctx.name || ctx.leadId || "el lead";
  switch (action.type) {
    case "send_whatsapp_template": {
      const vars = (Array.isArray(p.variables) ? p.variables : []).map((v) => fillTokens(String(v), ctx));
      return `Enviaría la plantilla "${String(p.templateName || "(sin plantilla)")}" a ${who}${
        vars.length ? ` con variables [${vars.join(", ")}]` : ""
      }`;
    }
    case "move_stage":
      return `Movería el lead a la etapa "${String(p.stageId || "(sin etapa)")}"`;
    case "schedule_callback":
      return `Agendaría un ${String(p.channel || "voice")} para ${who} en ${Number(
        p.offsetHours ?? 24,
      )}h${p.notes ? ` (nota: "${fillTokens(String(p.notes), ctx)}")` : ""}`;
    case "webhook":
      return `Haría POST al webhook ${String(p.url || "(sin URL)")}`;
    case "send_email":
      return ctx.email
        ? `Enviaría un email a ${ctx.email} con asunto "${fillTokens(String(p.subject || ""), ctx)}"`
        : `NO enviaría email: el lead no tiene correo`;
    case "apply_tag":
      return `Aplicaría la etiqueta "${fillTokens(String(p.tag || "(vacía)"), ctx)}" al lead`;
    case "apply_attribute":
      return `Setearía attributes["${String(p.field || "(campo)")}"] = "${fillTokens(
        String(p.value ?? ""),
        ctx,
      )}"`;
    case "notify_agent":
      return `Crearía una notificación${p.agent ? ` para ${String(p.agent)}` : " para el equipo"}: "${fillTokens(
        String(p.message || ""),
        ctx,
      )}"`;
    case "start_journey":
      return `Inscribiría a ${who} en el journey "${String(p.journeyName || p.journeyId || "(sin elegir)")}"`;
    default:
      return `Acción desconocida: ${action.type}`;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: HDRS, body: "" };

  // Gate de identidad (patrón manage-connections): tenant SIEMPRE del token.
  let identity;
  try {
    identity = await getIdentity(event.headers);
  } catch {
    return bad(401, "Token inválido");
  }
  if (!identity || !identity.tenantId) return bad(401, "No autorizado");
  const tenantId = identity.tenantId;
  const isAdmin = identity.groups.includes("Admins");

  const params = event.queryStringParameters || {};

  try {
    if (method === "GET") {
      if (params.runs) {
        const prefix = params.runs === "all" ? "run#" : `run#${params.runs}#`;
        const runs = await queryPrefix(tenantId, prefix, 50, true);
        // "all" mezcla reglas (orden por ruleId+fecha); ordenar por fecha real.
        runs.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
        return ok({ runs });
      }
      const rules = (await queryPrefix(tenantId, "rule#")) as unknown as AutomationRule[];
      rules.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return ok({ rules });
    }

    if (method === "POST") {
      const rawBody = JSON.parse(event.body || "{}") as Partial<AutomationRule> & {
        action?: string;
        ruleId?: string;
        leadId?: string;
        sampleLead?: DryCtx;
      };

      // ── Dry-run: previsualiza la regla contra un lead SIN ejecutar nada ──────
      // POST { action:"testRule", ruleId, leadId? | sampleLead? }. Solo LEE (no
      // escribe) → cualquier usuario autenticado del tenant puede probar.
      if (rawBody.action === "testRule") {
        if (!rawBody.ruleId) return bad(400, "ruleId requerido");
        const rr = await dynamo.send(
          new GetItemCommand({
            TableName: TABLE,
            Key: marshall({ tenantId, sk: `rule#${rawBody.ruleId}` }),
          }),
        );
        if (!rr.Item) return bad(404, "regla no encontrada");
        const rule = unmarshall(rr.Item) as AutomationRule;

        // Contexto del lead: el real (por leadId) o el sampleLead que mande el front.
        let ctx: DryCtx = rawBody.sampleLead || {};
        let leadFound = false;
        if (rawBody.leadId) {
          const lr = await dynamo.send(
            new GetItemCommand({ TableName: LEADS_TABLE, Key: { leadId: { S: String(rawBody.leadId) } } }),
          );
          if (lr.Item) {
            const l = unmarshall(lr.Item) as DryCtx & { leadId?: string };
            leadFound = true;
            ctx = {
              leadId: l.leadId,
              phone: l.phone,
              name: l.name,
              email: l.email,
              stageId: l.stageId,
              source: l.source,
              attributes: l.attributes,
            };
          }
        }

        const conds = Array.isArray(rule.conditions) ? rule.conditions : [];
        const { pass, detail } = evalConditions(conds, ctx);
        const actions = (Array.isArray(rule.actions) ? rule.actions : []).map((a) => ({
          type: a.type,
          preview: previewAction(a, ctx),
        }));
        return ok({
          ok: true,
          ruleId: rule.ruleId,
          ruleName: rule.name,
          trigger: rule.trigger?.type,
          leadFound: rawBody.leadId ? leadFound : undefined,
          conditionsPass: pass,
          conditionsDetail: detail,
          actions,
        });
      }

      if (!isAdmin) return bad(403, "Solo administradores pueden editar automatizaciones");
      const body = rawBody;
      if (!body.name || !String(body.name).trim()) return bad(400, "name requerido");
      if (!body.trigger || !TRIGGER_TYPES.includes(body.trigger.type))
        return bad(400, "trigger inválido");
      const actions = Array.isArray(body.actions) ? body.actions : [];
      if (actions.length === 0) return bad(400, "al menos una acción");
      for (const a of actions)
        if (!ACTION_TYPES.includes(a.type)) return bad(400, `acción inválida: ${a.type}`);

      const now = new Date().toISOString();
      const isNew = !body.ruleId;
      const ruleId = body.ruleId || randomUUID();

      // Preservar contadores/createdAt en updates (el engine los mantiene).
      let prev: Partial<AutomationRule> = {};
      if (!isNew) {
        const r = await dynamo.send(
          new GetItemCommand({
            TableName: TABLE,
            Key: marshall({ tenantId, sk: `rule#${ruleId}` }),
          })
        );
        if (r.Item) prev = unmarshall(r.Item) as AutomationRule;
      }

      const rule: AutomationRule = {
        ruleId,
        name: String(body.name).trim(),
        enabled: body.enabled !== false,
        trigger: { type: body.trigger.type, params: body.trigger.params || {} },
        conditions: Array.isArray(body.conditions) ? body.conditions : [],
        actions,
        firedCount: prev.firedCount || 0,
        lastFiredAt: prev.lastFiredAt,
        createdAt: prev.createdAt || now,
        updatedAt: now,
      };
      await dynamo.send(
        new PutItemCommand({
          TableName: TABLE,
          Item: marshall(
            { tenantId, sk: `rule#${ruleId}`, ...rule },
            { removeUndefinedValues: true }
          ),
        })
      );
      return ok({ rule, saved: true, isNew });
    }

    if (method === "DELETE") {
      if (!isAdmin) return bad(403, "Solo administradores pueden editar automatizaciones");
      if (!params.ruleId) return bad(400, "ruleId requerido");
      await dynamo.send(
        new DeleteItemCommand({
          TableName: TABLE,
          Key: marshall({ tenantId, sk: `rule#${params.ruleId}` }),
        })
      );
      return ok({ deleted: true, ruleId: params.ruleId });
    }

    return bad(405, `Method not allowed: ${method}`);
  } catch (err) {
    console.error("manage-automations error", err);
    return bad(500, err instanceof Error ? err.message : "internal error");
  }
};
