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
 * Pipeline" de AIRA): trigger → condiciones → acciones, que el Lambda
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
const HDRS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: HDRS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({ statusCode: c, headers: HDRS, body: JSON.stringify({ error: e }) });

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
];
const ACTION_TYPES: ActionType[] = [
  "send_whatsapp_template",
  "move_stage",
  "schedule_callback",
  "webhook",
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
      if (!isAdmin) return bad(403, "Solo administradores pueden editar automatizaciones");
      const body = JSON.parse(event.body || "{}") as Partial<AutomationRule>;
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
