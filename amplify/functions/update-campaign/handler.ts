import type { Handler } from "aws-lambda";
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { resolveDynamo, readTenantConfig } from "../_shared/tenantConnect";
import { resolveTenantId, isLegacyTenant } from "../_shared/cognitoAuth";
import { requireCapability } from "../_shared/rbac";
import { validateScheduledAt } from "../_shared/callWindow";
import { parseScheduleSnapshot, serializeSchedule } from "../_shared/connectHours";

// BYO Data Plane (#46): tenant primero, fallback Vox pooled.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const CAMPAIGNS_TABLE = process.env.CAMPAIGNS_TABLE || "connectview-campaigns";

// Fields the admin can edit. Everything is optional — partial PATCH semantics.
interface UpdateBody {
  campaignId: string;
  name?: string;
  description?: string;
  sourcePhoneNumber?: string;
  contactFlowId?: string;
  contactFlowName?: string;
  campaignQueueId?: string;
  campaignQueueName?: string;
  dialMode?: "progressive" | "power" | "agentless";
  concurrency?: number;
  timezone?: string;
  windowStartHour?: number;
  windowEndHour?: number;
  windowDaysOfWeek?: number[];
  retryNoAnswerMinutes?: number;
  retryMaxAttempts?: number;
  maxContactsPerAgent?: number;
  // Pilar 7 — orquestación
  priority?: number;
  weight?: number;
  goalType?: "none" | "contacts" | "conversions";
  goalTarget?: number;
  // Control total (2026-07) — el dialer re-lee estos campos cada tick, así que
  // el cambio de modo aplica en caliente al siguiente marcado.
  agentRouting?: "shared" | "exclusive";
  directConnect?: boolean;
  autoAccept?: boolean;
  /** Reprogramar arranque / vigencia. ISO 8601; string vacío borra el valor. */
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  /** Hours of Operation de Connect. "" desvincula y vuelve a la ventana manual. */
  hoursOfOperationId?: string;
  hoursOfOperationName?: string;
  hoursOfOperationSnapshot?: unknown;
}

// Each editable field → a builder that knows its DynamoDB value type.
// We systematically alias EVERY attribute name with a `#` placeholder so we
// never collide with DynamoDB reserved keywords (timezone, name, status, etc.).
const FIELD_MAP: Record<
  string,
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toAttrValue: (v: any) => { S?: string; N?: string; BOOL?: boolean; NULL?: boolean };
  }
> = {
  name: { toAttrValue: (v: string) => ({ S: v }) },
  description: { toAttrValue: (v: string) => ({ S: v }) },
  sourcePhoneNumber: { toAttrValue: (v: string) => ({ S: v }) },
  contactFlowId: { toAttrValue: (v: string) => ({ S: v }) },
  contactFlowName: { toAttrValue: (v: string) => ({ S: v }) },
  campaignQueueId: { toAttrValue: (v: string) => ({ S: v }) },
  campaignQueueName: { toAttrValue: (v: string) => ({ S: v }) },
  dialMode: { toAttrValue: (v: string) => ({ S: v }) },
  concurrency: { toAttrValue: (v: number) => ({ N: String(v) }) },
  timezone: { toAttrValue: (v: string) => ({ S: v }) },
  windowStartHour: { toAttrValue: (v: number) => ({ N: String(v) }) },
  windowEndHour: { toAttrValue: (v: number) => ({ N: String(v) }) },
  windowDaysOfWeek: {
    toAttrValue: (v: number[]) => ({ S: JSON.stringify(v) }),
  },
  retryNoAnswerMinutes: { toAttrValue: (v: number) => ({ N: String(v) }) },
  retryMaxAttempts: { toAttrValue: (v: number) => ({ N: String(v) }) },
  maxContactsPerAgent: { toAttrValue: (v: number) => ({ N: String(v) }) },
  // Pilar 7 — orquestación (prioridad / peso / meta).
  priority: { toAttrValue: (v: number) => ({ N: String(v) }) },
  weight: { toAttrValue: (v: number) => ({ N: String(v) }) },
  goalType: { toAttrValue: (v: string) => ({ S: v }) },
  goalTarget: { toAttrValue: (v: number) => ({ N: String(v) }) },
  // Control total (2026-07).
  agentRouting: {
    toAttrValue: (v: string) => ({ S: v === "exclusive" ? "exclusive" : "shared" }),
  },
  directConnect: { toAttrValue: (v: boolean) => ({ BOOL: !!v }) },
  autoAccept: { toAttrValue: (v: boolean) => ({ BOOL: !!v }) },
  // Programación. El string vacío borra la fecha (el bucle de abajo salta
  // undefined/null, así que "" es la única forma de limpiar vía PATCH).
  // Las fechas ya vienen validadas y normalizadas a UTC más arriba.
  scheduledStartAt: {
    toAttrValue: (v: string) => (v ? { S: v } : { NULL: true }),
  },
  scheduledEndAt: {
    toAttrValue: (v: string) => (v ? { S: v } : { NULL: true }),
  },
  // Horario de atención de Connect. "" desvincula y devuelve la campaña a su
  // ventana manual. El snapshot se valida antes de llegar acá.
  hoursOfOperationId: {
    toAttrValue: (v: string) => (v ? { S: v } : { NULL: true }),
  },
  hoursOfOperationName: { toAttrValue: (v: string) => ({ S: v || "" }) },
  hoursOfOperationSnapshot: {
    toAttrValue: (v: string) => (v ? { S: v } : { NULL: true }),
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  try {
    // SEC — RBAC server-side: editar una campaña exige `manage_campaigns`. El
    // Function URL es auth=NONE → sin esto cualquier autenticado podía reescribir
    // la config de una campaña (número origen, flujo, cola, ritmo…).
    const gate = await requireCapability(event?.headers, "manage_campaigns");
    if (!gate.ok) return gate.response;
    // BYO Data Plane (#46): tenant primero, fallback Vox.
    ({ dynamo } = await resolveDynamo(event?.headers, legacyDynamo));
    const body: UpdateBody = JSON.parse(event.body || "{}");
    if (!body.campaignId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "campaignId required" }),
      };
    }

    // Load current state to validate what's editable
    const current = await dynamo.send(
      new GetItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: body.campaignId } },
      }),
    );
    if (!current.Item) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Campaign not found" }),
      };
    }
    const currentStatus = current.Item.status?.S || "";

    // Terminal states can't be edited — offer Clone as an alternative on the client.
    if (currentStatus === "COMPLETED" || currentStatus === "CANCELLED") {
      return {
        statusCode: 409,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `Campaign in ${currentStatus} state cannot be edited. Clone it instead.`,
        }),
      };
    }

    // ── Conexión directa / ruteo exclusivo (en caliente) ──────────────────
    // Si el PATCH activa directConnect o pasa a exclusive, el flow tiene que
    // ser el ARIA-Outbound-Direct del tenant (es quien interpreta los
    // atributos de ruteo). Lo resolvemos y lo metemos al PATCH como si el
    // cliente lo hubiera mandado. Al apagarlo, el admin elige flow en la UI.
    const turnsDirect = body.directConnect === true || body.agentRouting === "exclusive";
    if (turnsDirect) {
      // El dueño manda: el tenantId del REGISTRO de la campaña (la edición
      // puede llegar sin JWT). Vacío/legacy → config del registro "default",
      // misma regla que el dialer usa para resolver el Connect.
      const ownerTenant = current.Item.tenantId?.S || (await resolveTenantId(event?.headers)) || "";
      const legacyT = !ownerTenant || isLegacyTenant(ownerTenant);
      const cfg = await readTenantConfig(legacyT ? "default" : ownerTenant);
      const directId = cfg?.contactFlows?.directOutboundId;
      if (!directId) {
        return {
          statusCode: 409,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error:
              "Tu instancia no tiene el flow de conexión directa. Provisiona los flows de ARIA (Configuración → Amazon Connect) e intenta de nuevo.",
          }),
        };
      }
      body.contactFlowId = directId;
      body.contactFlowName = "ARIA-Outbound-Direct";
    }

    // ── Reprogramación ────────────────────────────────────────────────────
    // Validar y normalizar a UTC ANTES de pasar por FIELD_MAP: el mapa solo
    // sabe de tipos DynamoDB, no de fechas. El string vacío es "borrar" y pasa
    // derecho. Una campaña ya RUNNING no se reprograma — el arranque ya pasó;
    // para eso está pausar y volver a programar.
    for (const field of ["scheduledStartAt", "scheduledEndAt"] as const) {
      const raw = body[field];
      if (raw === undefined || raw === null || raw === "") continue;
      if (field === "scheduledStartAt" && currentStatus === "RUNNING") {
        return {
          statusCode: 409,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "La campaña ya está corriendo. Pausala antes de reprogramar su inicio.",
          }),
        };
      }
      const v = validateScheduledAt(raw);
      if (!v.ok) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: v.error }),
        };
      }
      body[field] = v.iso!;
    }
    // El fin de vigencia tiene que ser posterior al inicio — comparado contra el
    // inicio efectivo (el del PATCH si vino, si no el que ya está guardado).
    if (body.scheduledEndAt) {
      const effectiveStart = body.scheduledStartAt || current.Item.scheduledStartAt?.S;
      if (effectiveStart && Date.parse(body.scheduledEndAt) <= Date.parse(effectiveStart)) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "El fin de vigencia debe ser posterior al inicio" }),
        };
      }
    }
    // Horario de Connect: el snapshot se normaliza acá (mismo motivo que las
    // fechas — FIELD_MAP solo sabe de tipos DynamoDB, no de contenido). Un
    // snapshot inválido se descarta en vez de guardarse: el dialer lo usa como
    // respaldo cuando Connect no responde, así que basura ahí = llamadas a
    // deshora. Desvincular ("" en el id) limpia también el respaldo.
    if (body.hoursOfOperationId === "") {
      body.hoursOfOperationSnapshot = "";
      body.hoursOfOperationName = "";
    } else if (body.hoursOfOperationSnapshot !== undefined) {
      const parsed = parseScheduleSnapshot(body.hoursOfOperationSnapshot);
      body.hoursOfOperationSnapshot = parsed ? serializeSchedule(parsed) : "";
      if (!parsed) {
        console.warn(`update-campaign: snapshot de horario inválido para ${body.campaignId}`);
      }
    }

    // Programar una campaña en DRAFT la pone en espera; despro­gramarla (string
    // vacío) la devuelve a DRAFT para que no quede SCHEDULED sin fecha.
    let statusOverride: string | null = null;
    if (body.scheduledStartAt && (currentStatus === "DRAFT" || currentStatus === "SCHEDULED")) {
      statusOverride = "SCHEDULED";
    } else if (body.scheduledStartAt === "" && currentStatus === "SCHEDULED") {
      statusOverride = "DRAFT";
    }

    const setExpressions: string[] = [];
    const exprVals: Record<string, { S?: string; N?: string; BOOL?: boolean }> = {};
    const exprNames: Record<string, string> = {};

    for (const [field, val] of Object.entries(body)) {
      if (field === "campaignId") continue;
      if (val === undefined || val === null) continue;
      const mapping = FIELD_MAP[field];
      if (!mapping) continue; // ignore unknown fields
      // Always alias with #field so we dodge every DynamoDB reserved keyword
      // without having to maintain a list (timezone, name, status, type, ...).
      const nameAlias = `#${field}`;
      const valueAlias = `:${field}`;
      setExpressions.push(`${nameAlias} = ${valueAlias}`);
      exprNames[nameAlias] = field;
      exprVals[valueAlias] = mapping.toAttrValue(val);
    }

    if (setExpressions.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "No editable fields provided" }),
      };
    }

    // Always bump updatedAt
    setExpressions.push("#updatedAt = :updatedAt");
    exprNames["#updatedAt"] = "updatedAt";
    exprVals[":updatedAt"] = { S: new Date().toISOString() };

    // DRAFT ⇄ SCHEDULED según haya o no fecha de arranque.
    if (statusOverride) {
      setExpressions.push("#status = :status");
      exprNames["#status"] = "status";
      exprVals[":status"] = { S: statusOverride };
    }

    await dynamo.send(
      new UpdateItemCommand({
        TableName: CAMPAIGNS_TABLE,
        Key: { campaignId: { S: body.campaignId } },
        UpdateExpression: "SET " + setExpressions.join(", "),
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprVals,
      }),
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId: body.campaignId,
        updated: true,
        fieldsChanged: setExpressions.length - 1, // minus updatedAt
      }),
    };
  } catch (err) {
    console.error("update-campaign error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to update campaign",
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
};
