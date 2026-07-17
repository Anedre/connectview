import type { Handler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { resolveDynamo } from "../_shared/tenantConnect";
import { getIdentity } from "../_shared/cognitoAuth";
import {
  assignCase,
  createCase,
  getCase,
  listCases,
  patchCase,
  transitionCase,
  CASE_PRIORITIES,
  CASE_STATUSES,
  type CasePriority,
  type CaseStatus,
} from "../_shared/cases";

/**
 * manage-cases — CRUD + transiciones de la primitiva Case/Ticket (eje C).
 * Ver design/case-primitiva.md. Tabla connectview-cases (PK=tenantId, SK=caseId).
 *
 * GET  [?caseId=ID]                         → un caso, o la lista del tenant
 * GET  ?status=&priority=&queueId=&assignee=&programId=   → lista filtrada
 * POST { action:"create", subject, ... }    → alta (correlativo + SLA)
 * POST { action:"transition", caseId, status, note? }     → cambio de estado
 * POST { action:"assign", caseId, agentId, agentName? }   → asignar/reasignar
 * POST { action:"patch", caseId, subject?/priority?/... } → editar campos planos
 *
 * Auth: cualquier MIEMBRO autenticado del tenant (operativo, no solo Admin). El
 * tenantId sale SIEMPRE del token (nunca de un query param). BYO Data Plane vía
 * resolveDynamo (tabla del tenant o pooled Vox).
 */
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const CORS = { "Content-Type": "application/json" };

const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({
  statusCode: c,
  headers: CORS,
  body: JSON.stringify({ error: e }),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  const params = event.queryStringParameters || {};

  // Auth: exigir token válido; el tenantId sale del JWT (nunca del query/body).
  let identity;
  try {
    identity = await getIdentity(event?.headers);
  } catch {
    return bad(401, "no autenticado");
  }
  if (!identity?.tenantId) return bad(401, "no autorizado");
  const tenantId = identity.tenantId;

  // BYO Data Plane: tabla del tenant, fallback a Vox pooled.
  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));

  try {
    if (method === "GET") {
      if (params.caseId) {
        const c = await getCase(dynamo, tenantId, String(params.caseId));
        if (!c) return bad(404, "caso no encontrado");
        return ok({ case: c });
      }
      const status = CASE_STATUSES.includes(params.status)
        ? (params.status as CaseStatus)
        : undefined;
      const priority = CASE_PRIORITIES.includes(params.priority)
        ? (params.priority as CasePriority)
        : undefined;
      const cases = await listCases(dynamo, tenantId, {
        status,
        priority,
        queueId: params.queueId ? String(params.queueId) : undefined,
        assigneeAgentId: params.assignee ? String(params.assignee) : undefined,
        programId: params.programId ? String(params.programId) : undefined,
        limit: params.limit ? Math.min(1000, Math.max(1, Number(params.limit) || 200)) : undefined,
      });
      return ok({ cases, count: cases.length });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const action = String(body.action || "create");

      if (action === "transition") {
        const caseId = String(body.caseId || "").trim();
        if (!caseId) return bad(400, "caseId requerido");
        const status = body.status as CaseStatus;
        if (!CASE_STATUSES.includes(status)) return bad(400, "status inválido");
        try {
          const c = await transitionCase(dynamo, tenantId, caseId, status, {
            agent: typeof body.agent === "string" ? body.agent : undefined,
            note: typeof body.note === "string" ? body.note : undefined,
            closedReason: body.closedReason,
          });
          if (!c) return bad(404, "caso no encontrado");
          return ok({ case: c });
        } catch (e) {
          return bad(409, e instanceof Error ? e.message : "transición inválida");
        }
      }

      if (action === "assign") {
        const caseId = String(body.caseId || "").trim();
        if (!caseId) return bad(400, "caseId requerido");
        const c = await assignCase(
          dynamo,
          tenantId,
          caseId,
          String(body.agentId || "").trim(),
          typeof body.agentName === "string" ? body.agentName : undefined,
        );
        if (!c) return bad(404, "caso no encontrado");
        return ok({ case: c });
      }

      if (action === "patch") {
        const caseId = String(body.caseId || "").trim();
        if (!caseId) return bad(400, "caseId requerido");
        const c = await patchCase(dynamo, tenantId, caseId, {
          subject: typeof body.subject === "string" ? body.subject : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          priority: CASE_PRIORITIES.includes(body.priority) ? body.priority : undefined,
          queueId: typeof body.queueId === "string" ? body.queueId : undefined,
          programId: typeof body.programId === "string" ? body.programId : undefined,
          note: typeof body.note === "string" ? body.note : undefined,
          agent: typeof body.agent === "string" ? body.agent : undefined,
        });
        if (!c) return bad(404, "caso no encontrado");
        return ok({ case: c });
      }

      // Default: alta.
      const subject = String(body.subject || "").trim();
      if (!subject) return bad(400, "subject requerido");
      const c = await createCase(dynamo, {
        tenantId,
        subject,
        description: typeof body.description === "string" ? body.description : undefined,
        priority: CASE_PRIORITIES.includes(body.priority) ? body.priority : undefined,
        status: CASE_STATUSES.includes(body.status) ? body.status : undefined,
        queueId: typeof body.queueId === "string" ? body.queueId : undefined,
        assigneeAgentId:
          typeof body.assigneeAgentId === "string" ? body.assigneeAgentId : undefined,
        assigneeAgentName:
          typeof body.assigneeAgentName === "string" ? body.assigneeAgentName : undefined,
        leadId: typeof body.leadId === "string" ? body.leadId : undefined,
        phone: typeof body.phone === "string" ? body.phone : undefined,
        conversationIds: Array.isArray(body.conversationIds)
          ? body.conversationIds.map(String)
          : undefined,
        contactId: typeof body.contactId === "string" ? body.contactId : undefined,
        channel: typeof body.channel === "string" ? body.channel : undefined,
        programId: typeof body.programId === "string" ? body.programId : undefined,
        createdBy: typeof body.agent === "string" ? body.agent : "manual",
      });
      return ok({ case: c, created: true });
    }

    return bad(405, `Method not allowed: ${method}`);
  } catch (err) {
    console.error("manage-cases error", err);
    return bad(500, err instanceof Error ? err.message : "internal error");
  }
};
