/**
 * rbac — enforcement server-side de la matriz de capacidades (RBAC granular,
 * roadmap #28). Los Function URLs son auth=NONE a nivel infra, así que cada
 * endpoint privilegiado tiene que validar el rol AQUÍ, contra la MISMA matriz
 * por-tenant (`connectview-permissions`) que edita Configuración → Seguridad y
 * que el front lee con `useCan()`. Así el gate del backend y el de la UI nunca
 * divergen: cambiar la matriz re-escala quién puede hacer qué SIN redeploy.
 *
 * Uso en un handler (Function URL, auth=NONE):
 *
 *   import { requireCapability } from "../_shared/rbac";
 *   const gate = await requireCapability(event?.headers, "manage_campaigns");
 *   if (!gate.ok) return gate.response;   // 401 sin token · 403 sin rol
 *   // … gate.identity disponible (verificada por el JWT, nunca por el body)
 *
 * SEGURIDAD (fail-safe): si la lectura de la matriz falla (p. ej. el rol de
 * ejecución aún no tiene `dynamodb:GetItem` sobre `connectview-permissions`),
 * el gate cae a `DEFAULT_MATRIX` — los `manage_*` siguen exigiendo Admins,
 * jamás abre de más. El permiso IAM solo hace falta para HONRAR las
 * personalizaciones por-tenant de la matriz (relajarla a Supervisors, etc.).
 */
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { getIdentity, type VoxIdentity } from "./cognitoAuth";

/**
 * Matriz por defecto: capacidad → rol mínimo. ÚNICA fuente de verdad, la
 * comparten `manage-permissions` (GET la mergea, POST la valida) y este gate,
 * para que el default del backend y el de la UI no puedan derivar.
 *
 * Dos familias:
 *  - view_ (VISIBILIDAD de cada seccion del menu lateral): VoxSidebar la lee
 *    via useCan/matrix. Cambiar aqui re-escala el menu EN VIVO, sin deploy.
 *  - manage_, edit_, monitor_, view_audit (ACCIONES dentro de una seccion):
 *    independientes de solo poder verla; son las que enforce requireCapability.
 */
export const DEFAULT_MATRIX: Record<string, string> = {
  // -- Acceso a secciones (menu lateral) --
  view_home: "Agents",
  view_agent_desktop: "Agents",
  view_inbox: "Agents",
  view_live_queue: "Supervisors",
  view_programs: "Supervisors",
  view_leads: "Admins",
  // Campañas visibles para Supervisores: su monitoreo en vivo es tarea natural
  // del supervisor. Crear/editar/lanzar sigue gobernado por `manage_campaigns`.
  view_campaigns: "Supervisors",
  view_bots: "Admins",
  view_journeys: "Admins",
  view_automations: "Admins",
  view_agente_ai: "Admins",
  view_appointments: "Admins",
  view_reports: "Supervisors",
  view_recordings: "Supervisors",
  view_settings: "Admins",
  // -- Acciones (dentro de cada seccion) --
  manage_campaigns: "Admins",
  manage_leads: "Admins",
  manage_appointments: "Admins",
  edit_taxonomy: "Admins",
  manage_catalogs: "Admins",
  manage_suppression: "Admins",
  manage_users: "Admins",
  view_audit: "Admins",
  monitor_agents: "Supervisors",
  // R29 — Copilot desactivable por rol. "Agents" = abierto a todos (default);
  // un admin puede subir el mínimo para restringirlo.
  use_copilot: "Agents",
};

/** Roles conocidos (para validar entradas de la matriz en manage-permissions). */
export const ROLES = new Set(["Admins", "Supervisors", "Agents"]);

/** Jerarquía de roles — espejo de `src/types/auth.ts` ROLE_HIERARCHY. */
const ROLE_RANK: Record<string, number> = { Agents: 0, Supervisors: 1, Admins: 2 };

const permsDynamo = new DynamoDBClient({});
const PERMISSIONS_TABLE = process.env.PERMISSIONS_TABLE || "connectview-permissions";

type HeaderBag = Record<string, string | undefined> | undefined;
const CORS = { "Content-Type": "application/json" };

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}
function deny(statusCode: number, error: string, extra?: Record<string, unknown>): LambdaResponse {
  return { statusCode, headers: { ...CORS }, body: JSON.stringify({ error, ...extra }) };
}

/** Rango del rol más alto del usuario (−1 si no tiene ningún grupo conocido). */
function highestRank(groups: string[]): number {
  let r = -1;
  for (const g of groups) {
    const rank = ROLE_RANK[g];
    if (rank != null && rank > r) r = rank;
  }
  return r;
}

/**
 * Matriz efectiva del tenant: `DEFAULT_MATRIX` + los overrides guardados. Lee la
 * tabla POOLED (`connectview-permissions`, misma cuenta que manage-permissions)
 * con el rol de ejecución del Lambda — NO el data plane del tenant. Si la lectura
 * falla se queda con los defaults (fail-safe: nunca abre de más).
 */
export async function loadMatrix(tenantId: string): Promise<Record<string, string>> {
  try {
    const res = await permsDynamo.send(
      new GetItemCommand({ TableName: PERMISSIONS_TABLE, Key: { configId: { S: tenantId } } }),
    );
    if (res.Item) {
      const stored = unmarshall(res.Item);
      if (stored?.matrix && typeof stored.matrix === "object") {
        return { ...DEFAULT_MATRIX, ...(stored.matrix as Record<string, string>) };
      }
    }
  } catch (err) {
    console.warn("rbac.loadMatrix: no se pudo leer la matriz, uso defaults:", err);
  }
  return { ...DEFAULT_MATRIX };
}

export type CapabilityGate =
  | { ok: true; identity: VoxIdentity }
  | { ok: false; response: LambdaResponse };

/**
 * Gate de capacidad server-side. Refleja exactamente el `useCan()` del front:
 *   - sin token / token inválido              → 401
 *   - capacidad SIN regla (uncapped)          → permitido
 *   - rol del usuario < rol mínimo de la cap  → 403
 * El rol mínimo sale de la matriz por-tenant, así que sigue lo que configure
 * Configuración → Seguridad. Devuelve la identidad verificada para reusarla.
 */
export async function requireCapability(
  headers: HeaderBag,
  capability: string,
): Promise<CapabilityGate> {
  let identity: VoxIdentity | null;
  try {
    identity = await getIdentity(headers);
  } catch {
    return { ok: false, response: deny(401, "Token inválido") };
  }
  if (!identity) return { ok: false, response: deny(401, "No autorizado") };
  // Sin tenant no hay matriz que evaluar → no autorizamos operaciones privilegiadas.
  if (!identity.tenantId) return { ok: false, response: deny(401, "No autorizado (sin tenant)") };

  const matrix = await loadMatrix(identity.tenantId);
  const min = matrix[capability];
  // Capacidad sin regla → abierta (igual que useCan: no rule = allowed).
  if (!min) return { ok: true, identity };

  const minRank = ROLE_RANK[min];
  const userRank = highestRank(identity.groups);
  // Regla malformada (rol desconocido) o rol insuficiente → 403 (fail-closed).
  if (minRank == null || userRank < minRank) {
    return {
      ok: false,
      response: deny(403, "No tienes permiso para esta acción", {
        capability,
        requiredRole: min,
      }),
    };
  }
  return { ok: true, identity };
}
