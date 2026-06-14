import type { Handler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { CustomerProfilesClient } from "@aws-sdk/client-customer-profiles";
import { randomUUID } from "node:crypto";
import { propagateLead, pushLeadToSalesforce, appendLeadHistory, stageIdToLabel, setActiveDynamo, setActiveProfiles, type LeadHistoryEvent, type SfPushExtra } from "../_shared/leadSync";
import { setActiveTenant } from "../_shared/salesforceClient";
import { resolveTenantId } from "../_shared/cognitoAuth";
import { resolveDynamo, resolveCustomerProfiles } from "../_shared/tenantConnect";
import { fireAutomation } from "../_shared/automationHook";

/**
 * manage-leads — the unified lead funnel / embudo (roadmap #4, Kommo-style).
 * A lead moves through the SAME taxonomy stages the wrap-up uses (#2), so the
 * board columns == the canonical tipificación. Leads are created from web
 * forms (#25), inbound, campaigns, or manually, and matched by phone.
 *
 * GET                 → list all leads
 * GET   ?phone=+51..  → lead(s) for a phone
 * POST  { leadId?, phone, name?, email?, company?, stageId?, montoEstimado?, attributes? } → upsert (dedup by phone)
 * POST  { action:"move", leadId, stageId } → move stage
 * DELETE ?leadId=ID
 */
// BYO Data Plane (#46): tenant primero (su tabla en su cuenta), fallback Vox.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
// CP legacy (Novasys) — solo para el tenant fundador; resolveCustomerProfiles
// bloquea a un tenant real sin CP (jamás escribe el perfil en Novasys).
const legacyProfiles = new CustomerProfilesClient({ maxAttempts: 2 });
const LEGACY_PROFILES_DOMAIN =
  process.env.CUSTOMER_PROFILES_DOMAIN || "amazon-connect-novasys";
const TABLE = process.env.LEADS_TABLE || "connectview-leads";
const CORS = { "Content-Type": "application/json" };
const ok = (b: unknown) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c: number, e: string) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ error: e }) });

interface Lead {
  leadId: string;
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  stageId?: string;
  source?: string;
  assignedAgent?: string;
  /** Historial de contacto/tipificación (append-only). */
  history?: LeadHistoryEvent[];
  /** Id del Lead en Salesforce (para sync idempotente). */
  sfLeadId?: string;
  /** Estimated deal value (pipeline $) — powers the exec KPI. Optional. */
  montoEstimado?: number;
  attributes?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Tras escribir un lead en el tablero, propaga el cambio a Customer Profile +
 * Salesforce (origin="vox"). Resiliente: si SF falla, el guardado del lead no
 * se ve afectado. El re-escribir el lead dentro del hub es un no-op (sig igual).
 */
async function propagateById(
  leadId: string,
  sfExtra?: SfPushExtra
): Promise<{ sfTaskId?: string | null; sfLeadId?: string }> {
  try {
    const got = await dynamo.send(
      new GetItemCommand({ TableName: TABLE, Key: { leadId: { S: leadId } } })
    );
    if (!got.Item) return {};
    const l = unmarshall(got.Item) as Lead & { sfLeadId?: string };
    if (!l.phone) return {};
    const res = await propagateLead(
      {
        phone: l.phone,
        name: l.name,
        email: l.email,
        company: l.company,
        stageId: l.stageId,
        sfLeadId: l.sfLeadId,
        source: l.source || "Vox Leads",
        attributes: l.attributes,
      },
      { origin: "vox", sfExtra }
    );
    // Log explícito del resultado de SF: sirve para confirmar que el Lead
    // sincroniza + que se registró la actividad (Task), y para diagnosticar
    // los leads que "no se graban" (el error de SF queda en el log de abajo).
    console.log(
      `manage-leads SF sync lead=${leadId} sfLead=${res.sf?.leadId || "—"} ` +
        `action=${res.sf?.action || "none"} task=${res.sf?.taskId || "—"}`
    );
    return { sfTaskId: res.sf?.taskId, sfLeadId: res.sf?.leadId };
  } catch (err) {
    console.warn("manage-leads propagate failed", err);
    return {};
  }
}

async function scanAll(): Promise<Lead[]> {
  const out: Lead[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await dynamo.send(
      new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey as never })
    );
    for (const it of res.Items || []) out.push(unmarshall(it) as Lead);
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  // Warmup (#perf): EventBridge pinguea {warmup:true} cada ~5min — corta el cold start.
  if (event?.warmup || event?.queryStringParameters?.warmup) {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: '{"warm":true}' };
  }
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  // Tenant del JWT → propagateById/propagateLead pegan al SF del cliente
  // (vía salesforceClient.setActiveTenant → soql/insertSObject/updateSObject).
  // Sin tenant configurado SF → fallback JWT bearer legacy.
  const tenantId = await resolveTenantId(event?.headers);
  setActiveTenant(tenantId);
  // BYO Data Plane (#46): mismo tenant para DynamoDB local + leadSync writes.
  {
    const r = await resolveDynamo(event?.headers, legacyDynamo);
    dynamo = r.dynamo;
    setActiveDynamo(r.tenantScoped ? r.dynamo : null);
    // Customer Profiles del tenant para el upsert del Cliente 360° en
    // propagateLead. Fail-closed: tenant real sin CP → bloqueado, NUNCA Novasys.
    const cp = await resolveCustomerProfiles(event?.headers, legacyProfiles, LEGACY_PROFILES_DOMAIN);
    setActiveProfiles(cp.client, cp.domainName);
  }
  const params = event.queryStringParameters || {};

  try {
    if (method === "GET") {
      const all = await scanAll();

      // Contacto reciente: leads ordenados por última actividad, con resumen del último evento.
      if (params.recent) {
        const n = Math.min(50, Math.max(1, Number(params.recent) || 15));
        const recent = all
          .slice()
          .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
          .slice(0, n)
          .map((l) => {
            const h = Array.isArray(l.history) ? l.history : [];
            const last = h.length ? h[h.length - 1] : undefined;
            return {
              leadId: l.leadId, name: l.name, phone: l.phone, email: l.email,
              company: l.company, stageId: l.stageId, source: l.source,
              sfLeadId: l.sfLeadId, updatedAt: l.updatedAt,
              lastActivity: last
                ? { type: last.type, channel: last.channel, untyped: last.untyped, stageLabel: last.stageLabel, subStageLabel: last.subStageLabel, ts: last.ts }
                : null,
            };
          });
        return ok({ recent });
      }

      // Un lead por teléfono → CON su historial completo (alimenta el detalle/Historial).
      if (params.phone) {
        return ok({ leads: all.filter((l) => l.phone === params.phone) });
      }

      // Board: lista completa, SIN historial (puede ser grande — se trae aparte).
      const lean = all
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
        .map((l) => {
          const r = { ...l } as Record<string, unknown>;
          delete r.history;
          return r;
        });
      return ok({ leads: lean });
    }

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");

      // Move-stage action.
      if (body.action === "move") {
        if (!body.leadId || !body.stageId) return bad(400, "leadId and stageId required");
        await dynamo.send(
          new UpdateItemCommand({
            TableName: TABLE,
            Key: { leadId: { S: body.leadId } },
            UpdateExpression: "SET stageId = :s, updatedAt = :u",
            ExpressionAttributeValues: {
              ":s": { S: String(body.stageId) },
              ":u": { S: new Date().toISOString() },
            },
          })
        );
        const stageLabel = await stageIdToLabel(String(body.stageId));
        const prop = await propagateById(String(body.leadId), {
          taskSubject: `ARIA · Etapa: ${stageLabel || String(body.stageId)}`.slice(0, 255),
          taskDescription: `El lead pasó a la etapa "${stageLabel || String(body.stageId)}" desde ARIA.`,
          taskSubtype: "Task",
        });
        await appendLeadHistory(String(body.leadId), {
          ts: new Date().toISOString(),
          type: "stage_change",
          stageId: String(body.stageId),
          stageLabel,
          sfTaskId: prop.sfTaskId || undefined,
        });
        // Automatizaciones (#15): el cambio de etapa es un trigger.
        await fireAutomation({
          type: "lead_stage_changed",
          tenantId,
          lead: { leadId: String(body.leadId), stageId: String(body.stageId) },
        });
        return ok({ moved: true, leadId: body.leadId, stageId: body.stageId });
      }

      // Forzar el envío de UN lead a Salesforce (botón "Enviar a Salesforce"
      // del detalle) — red de seguridad por si el sync automático no ocurrió
      // (ej. leads de campaña que aún no se contactaron). Devuelve el resultado
      // REAL (éxito con ids, o el error de SF) para el toast del front.
      if (body.action === "pushSf") {
        if (!body.leadId) return bad(400, "leadId required");
        const got = await dynamo.send(
          new GetItemCommand({ TableName: TABLE, Key: { leadId: { S: String(body.leadId) } } })
        );
        if (!got.Item) return bad(404, "lead no encontrado");
        const l = unmarshall(got.Item) as Lead & { sfLeadId?: string };
        if (!l.phone && !l.email) {
          return bad(400, "El lead necesita teléfono o email para enviarse a Salesforce.");
        }
        try {
          const sf = await pushLeadToSalesforce(
            {
              phone: l.phone,
              name: l.name,
              email: l.email,
              company: l.company,
              stageId: l.stageId,
              sfLeadId: l.sfLeadId,
              source: l.source || "Vox Leads",
              attributes: l.attributes,
            },
            {
              taskSubject: "ARIA · Enviado a Salesforce",
              taskDescription: `Lead enviado manualmente a Salesforce desde ARIA${l.name ? ` · ${l.name}` : ""}.`,
              taskSubtype: "Task",
            }
          );
          if (!sf) return ok({ pushed: false, error: "El lead necesita teléfono o email." });
          // Persistir el sfLeadId nuevo → próximos sync idempotentes.
          if (sf.leadId && !l.sfLeadId) {
            await dynamo
              .send(
                new UpdateItemCommand({
                  TableName: TABLE,
                  Key: { leadId: { S: l.leadId } },
                  UpdateExpression: "SET sfLeadId = :s",
                  ExpressionAttributeValues: { ":s": { S: sf.leadId } },
                })
              )
              .catch(() => {});
          }
          console.log(
            `manage-leads pushSf lead=${l.leadId} sfLead=${sf.leadId} action=${sf.action} task=${sf.taskId || "—"}`
          );
          return ok({ pushed: true, sfLeadId: sf.leadId, action: sf.action, taskId: sf.taskId || null });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "error";
          console.warn("manage-leads pushSf failed:", msg);
          return ok({ pushed: false, error: msg.slice(0, 220) });
        }
      }

      // Upsert. Dedup by phone — if a lead with this phone exists, update it.
      const phone = (body.phone || "").trim();
      if (!phone) return bad(400, "phone is required");

      let leadId: string | undefined = body.leadId;
      if (!leadId) {
        const existing = (await scanAll()).find((l) => l.phone === phone);
        if (existing) leadId = existing.leadId;
      }
      const now = new Date().toISOString();
      const isNew = !leadId;
      leadId = leadId || randomUUID();

      const item: Lead = {
        leadId,
        phone,
        name: body.name,
        email: body.email,
        company: body.company,
        stageId: body.stageId,
        source: body.source,
        assignedAgent: body.assignedAgent,
        montoEstimado: typeof body.montoEstimado === "number" ? body.montoEstimado : undefined,
        attributes: body.attributes && typeof body.attributes === "object" ? body.attributes : undefined,
        updatedAt: now,
      };
      if (isNew) item.createdAt = now;

      if (isNew) {
        await dynamo.send(
          new PutItemCommand({ TableName: TABLE, Item: marshall(item, { removeUndefinedValues: true }) })
        );
      } else {
        // Build a partial update so we don't wipe fields not provided.
        const sets: string[] = ["updatedAt = :u"];
        const vals: Record<string, unknown> = { ":u": now };
        const names: Record<string, string> = {};
        for (const k of ["name", "email", "company", "stageId", "source", "assignedAgent", "montoEstimado", "attributes"] as const) {
          if (body[k] !== undefined) {
            sets.push(`#${k} = :${k}`);
            names[`#${k}`] = k;
            vals[`:${k}`] = body[k];
          }
        }
        await dynamo.send(
          new UpdateItemCommand({
            TableName: TABLE,
            Key: { leadId: { S: leadId } },
            UpdateExpression: "SET " + sets.join(", "),
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: marshall(vals, { removeUndefinedValues: true }),
          })
        );
      }
      const prop = await propagateById(leadId, {
        taskSubject: isNew ? "ARIA · Lead creado" : "ARIA · Lead actualizado",
        taskDescription: isNew
          ? `Lead creado en ARIA${item.name ? ` · ${item.name}` : ""}${item.phone ? ` · ${item.phone}` : ""}.`
          : "Datos del lead actualizados desde ARIA.",
        taskSubtype: "Task",
      });
      if (!isNew) {
        await appendLeadHistory(leadId, {
          ts: new Date().toISOString(),
          type: "update",
          sfTaskId: prop.sfTaskId || undefined,
        });
      }
      // Automatizaciones (#15): lead nuevo en el embudo es un trigger.
      if (isNew) {
        await fireAutomation({
          type: "lead_created",
          tenantId,
          lead: { leadId, phone, name: item.name, stageId: item.stageId, source: item.source },
        });
      }
      return ok({ lead: item, saved: true, isNew });
    }

    if (method === "DELETE") {
      if (!params.leadId) return bad(400, "leadId required");
      await dynamo.send(
        new DeleteItemCommand({ TableName: TABLE, Key: { leadId: { S: params.leadId } } })
      );
      return ok({ deleted: true, leadId: params.leadId });
    }

    return bad(405, `Method not allowed: ${method}`);
  } catch (err) {
    console.error("manage-leads error", err);
    return bad(500, err instanceof Error ? err.message : "internal error");
  }
};
