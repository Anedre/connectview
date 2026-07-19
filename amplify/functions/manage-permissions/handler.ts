import type { Handler } from "aws-lambda";
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { getIdentity } from "../_shared/cognitoAuth";

/**
 * manage-permissions — granular RBAC matrix (roadmap #28). Maps each
 * capability to the minimum role allowed (Admins|Supervisors|Agents).
 * Single config doc (configId="default"). The frontend's useCan(capability)
 * checks the signed-in user's role against this matrix, so admins can
 * re-scope who does what without a deploy.
 *
 * GET  → { matrix }
 * POST { matrix } → save
 */
const dynamo = new DynamoDBClient({});
const TABLE = process.env.PERMISSIONS_TABLE || "connectview-permissions";
const CORS = { "Content-Type": "application/json" };
const ROLES = new Set(["Admins", "Supervisors", "Agents"]);

// Default matrix — sensible starting scopes. The editor can change these.
//
// Dos familias de capacidades:
//  · view_*  → VISIBILIDAD de cada sección del menú lateral. El VoxSidebar las
//    lee (vía useCan/matrix) para decidir qué secciones aparecen por rol. Antes
//    el gate del menú estaba HARDCODEADO en el código (minRole), desconectado de
//    esta matriz — por eso editar Seguridad "no hacía nada". Ahora la matriz es
//    la fuente de verdad: cambiar aquí re-escala el menú EN VIVO, sin deploy.
//  · manage_*/edit_*/monitor_*/view_audit → ACCIONES dentro de una sección
//    (crear/editar/lanzar), independientes de solo poder verla.
const DEFAULT_MATRIX: Record<string, string> = {
  // ── Acceso a secciones (menú lateral) ──────────────────────────────────
  view_home: "Agents",
  view_agent_desktop: "Agents",
  view_inbox: "Agents",
  view_live_queue: "Supervisors",
  view_programs: "Supervisors",
  view_leads: "Admins",
  // Campañas visibles para Supervisores: su monitoreo en vivo (contactos en
  // vuelo por cola/agente) es tarea natural del supervisor. Crear/editar/lanzar
  // sigue gobernado aparte por `manage_campaigns` (Admins).
  view_campaigns: "Supervisors",
  view_bots: "Admins",
  view_journeys: "Admins",
  view_automations: "Admins",
  view_agente_ai: "Admins",
  view_appointments: "Admins",
  view_reports: "Supervisors",
  view_tipificaciones: "Supervisors",
  view_recordings: "Supervisors",
  view_settings: "Admins",
  // ── Acciones (dentro de cada sección) ──────────────────────────────────
  manage_campaigns: "Admins",
  manage_leads: "Admins",
  manage_appointments: "Admins",
  edit_taxonomy: "Admins",
  manage_catalogs: "Admins",
  manage_suppression: "Admins",
  manage_users: "Admins",
  view_audit: "Admins",
  monitor_agents: "Supervisors",
  // R29 — Copilot desactivable por rol. "Agents" = abierto a todos (comportamiento
  // actual); un admin puede subir el mínimo a Supervisors/Admins para restringirlo.
  use_copilot: "Agents",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  // SEGURIDAD: el RBAC es PER-TENANT. Exige JWT válido (antes era público → cualquiera
  // anónimo leía Y SOBRESCRIBÍA la matriz GLOBAL = escalada de privilegios + cross-tenant).
  // GET: cualquier usuario autenticado del tenant (useCan lo lee). POST: solo Admins.
  let identity;
  try {
    identity = await getIdentity(event.headers);
  } catch {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "Token inválido" }) };
  }
  if (!identity || !identity.tenantId) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "No autorizado" }) };
  }
  const configId = identity.tenantId; // matriz por tenant, no global

  try {
    if (method === "GET") {
      const res = await dynamo.send(
        new GetItemCommand({ TableName: TABLE, Key: { configId: { S: configId } } }),
      );
      const stored = res.Item ? unmarshall(res.Item) : null;
      // Merge defaults so newly-added capabilities always have a value.
      const matrix = { ...DEFAULT_MATRIX, ...(stored?.matrix || {}) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ matrix }) };
    }

    if (method === "POST") {
      if (!identity.groups.includes("Admins")) {
        return {
          statusCode: 403,
          headers: CORS,
          body: JSON.stringify({ error: "Solo administradores pueden editar permisos" }),
        };
      }
      const body = JSON.parse(event.body || "{}");
      const incoming = body.matrix && typeof body.matrix === "object" ? body.matrix : {};
      // Validate: keep only known-ish keys with valid roles; fall back to default.
      const matrix: Record<string, string> = { ...DEFAULT_MATRIX };
      for (const [k, v] of Object.entries(incoming)) {
        if (ROLES.has(String(v))) matrix[k] = String(v);
      }
      await dynamo.send(
        new PutItemCommand({
          TableName: TABLE,
          Item: marshall(
            {
              configId,
              matrix,
              updatedAt: new Date().toISOString(),
              updatedBy: identity.email || identity.tenantId,
            },
            { removeUndefinedValues: true },
          ),
        }),
      );
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ matrix, saved: true }) };
    }

    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  } catch (err) {
    console.error("manage-permissions error", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err instanceof Error ? err.message : "internal error" }),
    };
  }
};
