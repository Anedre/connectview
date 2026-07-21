import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "node:crypto";
import { resolveDynamo } from "../_shared/tenantConnect";

/**
 * manage-programs — "Programa" como objeto operativo (Pilar 1 · R1/R2/R3/R26).
 *
 * Un Programa es una unidad COMERCIAL/de campaña efímera (~56 activos, vida ~3
 * meses, leads casi disjuntos). Grano fino, con `faculty` opcional para agrupar.
 * No es el catálogo de cursos. Ver design/pilar-1-programa.md.
 *
 * Tablas:
 *   connectview-programs       (PK=programId)
 *   connectview-lead-programs  (PK=programId, SK=leadId, GSI "byLead") — membership N:N
 *                              (se consulta aquí solo para conteos; se puebla en Fase B)
 *
 * GET    ?programId=ID                          → un programa + salud (leads, byStage)
 * GET    [?status=&faculty=&includeArchived=1]  → lista + conteo de leads por programa
 * POST   { programId?, code, name, faculty?, … }              → upsert
 * POST   { action:"transition", programId, to }               → cambia estado (state machine)
 * POST   { action:"importExcel", rows:[{code,name,faculty,…}] }→ alta masiva (R3)
 * POST   { action:"assign"|"remove", programId, leadIds:[] }  → membership manual
 * DELETE ?programId=ID                          → solo si borrador o sin leads
 *
 * Auth/BYO: resolveDynamo (write no-op sin Cognito Bearer; data plane del tenant).
 */

const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const TABLE = process.env.PROGRAMS_TABLE || "connectview-programs";
const MEMBERSHIP = process.env.LEAD_PROGRAMS_TABLE || "connectview-lead-programs";
const CORS = { "Content-Type": "application/json" };

const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({
  statusCode: c,
  headers: CORS,
  body: JSON.stringify({ error: e }),
});

const STATUSES = ["borrador", "activo", "pausado", "cerrado", "archivado"] as const;
type Status = (typeof STATUSES)[number];

/** Transiciones permitidas del ciclo de vida. */
const TRANSITIONS: Record<Status, Status[]> = {
  borrador: ["activo", "archivado"],
  activo: ["pausado", "cerrado"],
  pausado: ["activo", "cerrado"],
  cerrado: ["archivado", "activo"],
  archivado: ["activo"],
};

interface ProgramMetrics {
  leads: number;
  byStage: Record<string, number>;
  lastActivityAt?: string;
}

interface Program {
  programId: string;
  code: string;
  name: string;
  faculty?: string;
  description?: string;
  // Detalles comerciales (para que el Agente IA cite el programa como fuente rica [P]).
  modality?: string; // Presencial / Virtual / Semipresencial…
  duration?: string; // ej. "10 ciclos", "6 meses"
  price?: string; // ej. "S/ 1200 por ciclo" (texto libre: moneda/periodicidad variables)
  requirements?: string; // requisitos de admisión
  status: Status;
  color?: string;
  startDate?: string;
  endDate?: string;
  autoArchive?: boolean;
  defaultQueueId?: string;
  defaultContactFlowId?: string;
  defaultStageId?: string;
  /** Taxonomía de etapas propia del programa. Vacío ⇒ usa la default global (retrocompat). */
  taxonomyId?: string;
  kpiTargets?: { contactRate?: number; conversion?: number; leadsGoal?: number };
  metricsSnapshot?: ProgramMetrics;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  archivedAt?: string;
}

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
};

function sanitize(body: Record<string, unknown>): Program {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new Error("name is required");
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) throw new Error("code is required");
  const status = STATUSES.includes(body.status as Status) ? (body.status as Status) : "borrador";
  const kpi =
    body.kpiTargets && typeof body.kpiTargets === "object"
      ? (body.kpiTargets as Program["kpiTargets"])
      : undefined;
  return {
    programId:
      typeof body.programId === "string" && body.programId.trim()
        ? body.programId.trim()
        : randomUUID(),
    code,
    name,
    faculty: str(body.faculty),
    description: str(body.description),
    modality: str(body.modality),
    duration: str(body.duration),
    price: str(body.price),
    requirements: str(body.requirements),
    status,
    color: str(body.color),
    startDate: str(body.startDate),
    endDate: str(body.endDate),
    autoArchive: body.autoArchive !== false,
    defaultQueueId: str(body.defaultQueueId),
    defaultContactFlowId: str(body.defaultContactFlowId),
    defaultStageId: str(body.defaultStageId),
    taxonomyId: str(body.taxonomyId),
    kpiTargets: kpi,
  };
}

/** Conteo de leads del programa (Query COUNT sobre membership). Resiliente si la tabla no existe aún. */
async function leadCount(programId: string): Promise<number> {
  try {
    let count = 0;
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await dynamo.send(
        new QueryCommand({
          TableName: MEMBERSHIP,
          KeyConditionExpression: "programId = :p",
          ExpressionAttributeValues: { ":p": { S: programId } },
          Select: "COUNT",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ExclusiveStartKey: ExclusiveStartKey as any,
        }),
      );
      count += res.Count || 0;
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return count;
  } catch {
    return 0;
  }
}

/** Salud detallada: leads totales + desglose por etapa. Resiliente. */
async function programHealth(programId: string): Promise<ProgramMetrics> {
  const byStage: Record<string, number> = {};
  let leads = 0;
  let lastActivityAt: string | undefined;
  try {
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await dynamo.send(
        new QueryCommand({
          TableName: MEMBERSHIP,
          KeyConditionExpression: "programId = :p",
          ExpressionAttributeValues: { ":p": { S: programId } },
          ProjectionExpression: "stageId, updatedAt",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ExclusiveStartKey: ExclusiveStartKey as any,
        }),
      );
      for (const it of res.Items || []) {
        const m = unmarshall(it);
        leads += 1;
        const s = String(m.stageId || "sin-etapa");
        byStage[s] = (byStage[s] || 0) + 1;
        if (m.updatedAt && (!lastActivityAt || m.updatedAt > lastActivityAt)) {
          lastActivityAt = String(m.updatedAt);
        }
      }
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  } catch {
    /* membership vacía / no creada aún */
  }
  return { leads, byStage, lastActivityAt };
}

async function getProgram(programId: string): Promise<Program | null> {
  const res = await dynamo.send(
    new GetItemCommand({ TableName: TABLE, Key: { programId: { S: programId } } }),
  );
  return res.Item ? (unmarshall(res.Item) as Program) : null;
}

async function putProgram(p: Program, actor: string) {
  const item = { ...p, updatedAt: new Date().toISOString(), updatedBy: actor };
  await dynamo.send(
    new PutItemCommand({ TableName: TABLE, Item: marshall(item, { removeUndefinedValues: true }) }),
  );
  return item;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  const params = event.queryStringParameters || {};

  // BYO Data Plane: tenant primero, fallback a Vox pooled.
  ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));

  try {
    if (method === "GET") {
      if (params.programId) {
        const program = await getProgram(params.programId);
        if (!program) return ok({ program: null });
        const health = await programHealth(params.programId);
        return ok({ program, health });
      }
      // BUG-audit P2: paginar completo (antes truncaba a 1 página)
      const programsAll: Program[] = [];
      let lastKey: Record<string, unknown> | undefined;
      do {
        const res = await dynamo.send(
          new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey as never }),
        );
        for (const it of res.Items || []) programsAll.push(unmarshall(it) as Program);
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);
      let programs = programsAll;
      if (params.status) programs = programs.filter((p) => p.status === params.status);
      if (params.faculty) programs = programs.filter((p) => p.faculty === params.faculty);
      if (params.includeArchived !== "1")
        programs = programs.filter((p) => p.status !== "archivado");
      // Salud por programa (leads + byStage para el mini-funnel de las cards).
      // ~56 programas → aceptable; se optimiza con GSI/caché si crece.
      const healths = await Promise.all(programs.map((p) => programHealth(p.programId)));
      const withCounts = programs
        .map((p, i) => ({ ...p, leadCount: healths[i].leads, health: healths[i] }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return ok({ programs: withCounts });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const actor = typeof body.actor === "string" ? body.actor : "unknown";

      // ── Transición de estado ─────────────────────────────────────────────
      if (body.action === "transition") {
        const to = String(body.to || "") as Status;
        if (!STATUSES.includes(to)) return bad(400, `estado inválido: ${to}`);
        const program = await getProgram(String(body.programId || ""));
        if (!program) return bad(404, "programa no encontrado");
        const allowed = TRANSITIONS[program.status] || [];
        if (!allowed.includes(to))
          return bad(409, `transición no permitida: ${program.status} → ${to}`);
        program.status = to;
        if (to === "cerrado") {
          program.metricsSnapshot = await programHealth(program.programId); // congela métricas
        }
        if (to === "archivado") {
          program.archivedAt = new Date().toISOString();
          if (!program.metricsSnapshot)
            program.metricsSnapshot = await programHealth(program.programId);
        }
        const saved = await putProgram(program, actor);
        return ok({ program: saved, transitioned: to });
      }

      // ── Alta masiva desde Excel (R3) ─────────────────────────────────────
      if (body.action === "importExcel") {
        const rows = Array.isArray(body.rows) ? body.rows : [];
        // Mapa code → programId existente para upsert (no duplicar por código).
        // BUG-audit P2: paginar completo (antes truncaba a 1 página → un code
        // en una página no leída se re-creaba en vez de actualizarse).
        const byCode = new Map<string, string>();
        let lastKey: Record<string, unknown> | undefined;
        do {
          const existing = await dynamo.send(
            new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey as never }),
          );
          for (const it of existing.Items || []) {
            const p = unmarshall(it) as Program;
            if (p.code) byCode.set(p.code.toLowerCase(), p.programId);
          }
          lastKey = existing.LastEvaluatedKey as Record<string, unknown> | undefined;
        } while (lastKey);
        let created = 0;
        let updated = 0;
        const errors: string[] = [];
        for (const raw of rows) {
          try {
            const doc = sanitize(raw as Record<string, unknown>);
            const prev = byCode.get(doc.code.toLowerCase());
            if (prev) {
              doc.programId = prev;
              updated += 1;
            } else {
              created += 1;
              byCode.set(doc.code.toLowerCase(), doc.programId);
            }
            await putProgram(
              { ...doc, createdBy: actor, createdAt: new Date().toISOString() },
              actor,
            );
          } catch (e) {
            errors.push(e instanceof Error ? e.message : "fila inválida");
          }
        }
        return ok({ imported: { created, updated, errors } });
      }

      // ── Membership manual (assign/remove) ────────────────────────────────
      if (body.action === "assign" || body.action === "remove") {
        const programId = String(body.programId || "");
        const leadIds: string[] = Array.isArray(body.leadIds) ? body.leadIds.map(String) : [];
        if (!programId || leadIds.length === 0) return bad(400, "programId y leadIds requeridos");
        const now = new Date().toISOString();
        for (const leadId of leadIds) {
          if (body.action === "assign") {
            await dynamo.send(
              new PutItemCommand({
                TableName: MEMBERSHIP,
                Item: marshall(
                  {
                    programId,
                    leadId,
                    stageId: str(body.stageId),
                    source: "manual",
                    addedAt: now,
                    updatedAt: now,
                  },
                  { removeUndefinedValues: true },
                ),
              }),
            );
          } else {
            await dynamo.send(
              new DeleteItemCommand({
                TableName: MEMBERSHIP,
                Key: { programId: { S: programId }, leadId: { S: leadId } },
              }),
            );
          }
        }
        return ok({ [body.action === "assign" ? "assigned" : "removed"]: leadIds.length });
      }

      // ── Upsert de programa ───────────────────────────────────────────────
      let doc: Program;
      try {
        doc = sanitize(body);
      } catch (e) {
        return bad(400, e instanceof Error ? e.message : "programa inválido");
      }
      const prev = await getProgram(doc.programId);
      if (!prev) {
        doc.createdAt = new Date().toISOString();
        doc.createdBy = actor;
      } else {
        doc.createdAt = prev.createdAt;
        doc.createdBy = prev.createdBy;
      }
      const saved = await putProgram(doc, actor);
      return ok({ program: saved, saved: true, isNew: !prev });
    }

    if (method === "DELETE") {
      if (!params.programId) return bad(400, "programId required");
      const program = await getProgram(params.programId);
      if (program && program.status !== "borrador") {
        const n = await leadCount(params.programId);
        if (n > 0)
          return bad(409, `no se puede borrar: el programa tiene ${n} leads (ciérralo/archívalo)`);
      }
      await dynamo.send(
        new DeleteItemCommand({ TableName: TABLE, Key: { programId: { S: params.programId } } }),
      );
      return ok({ deleted: true, programId: params.programId });
    }

    return bad(405, `Method not allowed: ${method}`);
  } catch (err) {
    console.error("manage-programs error", err);
    return bad(500, err instanceof Error ? err.message : "internal error");
  }
};
