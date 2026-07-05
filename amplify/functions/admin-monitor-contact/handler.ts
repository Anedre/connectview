import type { Handler } from "aws-lambda";
import { ConnectClient, MonitorContactCommand } from "@aws-sdk/client-connect";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { resolveConnect } from "../_shared/tenantConnect";
import { getIdentity, type VoxIdentity } from "../_shared/cognitoAuth";

// SEC-C6: acciones de supervisión (escuchar/intervenir llamadas en vivo) SOLO
// para Supervisores/Admins. El Function URL es auth=NONE → la identidad se
// valida ACÁ con el JWT. Sin estos grupos, un POST público podía espiar/barge
// cualquier llamada. `monitor_agents` = mínimo Supervisors en la matriz RBAC.
const PRIVILEGED_GROUPS = ["Admins", "Supervisors"];

const legacyConnect = new ConnectClient({ maxAttempts: 1 });
// BYO Data Plane (#46): module-active; el helper audit lee este `dynamo`.
const legacyDynamo = new DynamoDBClient({});
let dynamo: DynamoDBClient = legacyDynamo;
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const AUDIT_TABLE = process.env.ADMIN_AUDIT_TABLE || "connectview-admin-audit";

// Amazon Connect's MonitorContact API + Streams 2.25 support exactly two
// programmatic modes: SILENT_MONITOR and BARGE. There is NO whisper/coaching
// mode in the Streams monitor API (Connect's "manager coaching" lives only
// in the native Agent Workspace, not in amazon-connect-streams). So we expose
// the two real modes and let the supervisor switch between them live via the
// CCP. `allowBarge` controls whether the session may escalate to barge.
type MonitorMode = "SILENT_MONITOR" | "BARGE";

async function audit(
  actor: string,
  target: Record<string, string>,
  result: "success" | "error",
  errorMsg?: string,
): Promise<void> {
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: AUDIT_TABLE,
        Item: {
          auditId: { S: randomUUID() },
          timestamp: { S: new Date().toISOString() },
          action: { S: `monitor-${target.mode}` },
          actor: { S: actor },
          target: { S: JSON.stringify(target) },
          result: { S: result },
          errorMsg: { S: errorMsg || "" },
        },
      }),
    );
  } catch (err) {
    console.warn("audit write failed:", err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: "" };
  }

  // AUTH (SEC-C6): identidad del JWT, NUNCA del body. Sin token válido → 401;
  // sin rol Supervisor/Admin → 403. Así el Function URL público deja de ser un
  // canal abierto para escuchar/intervenir llamadas ajenas.
  let identity: VoxIdentity | null;
  try {
    identity = await getIdentity(event?.headers);
  } catch {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Token inválido" }),
    };
  }
  if (!identity) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "No autorizado" }),
    };
  }
  if (!identity.groups.some((g) => PRIVILEGED_GROUPS.includes(g))) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Solo supervisores o administradores pueden monitorear contactos",
      }),
    };
  }

  const body = JSON.parse(event.body || "{}");
  const {
    contactId,
    supervisorUserId,
    mode = "SILENT_MONITOR",
    allowBarge = true,
  } = body as {
    contactId: string;
    supervisorUserId: string;
    mode?: MonitorMode;
    /** Whether the supervisor may escalate from listen to barge during
     *  this session. Default true so the live Escuchar↔Intervenir toggle
     *  in the control bar works. Set false to lock a session to listen-only. */
    allowBarge?: boolean;
  };
  // El actor del audit-trail sale del token verificado (no del body, que es
  // forjable). Antes `actor` venía del cliente → auditoría falsificable.
  const actor = identity.username || identity.sub;

  if (!contactId || !supervisorUserId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "contactId and supervisorUserId required",
      }),
    };
  }

  // Grant both capabilities (unless barge is explicitly disallowed) so the
  // supervisor can switch listen↔barge live via the Streams API without
  // re-invoking MonitorContact. The session STARTS in silent monitor
  // regardless; `mode` is recorded for the audit trail.
  const capabilities: string[] = allowBarge ? ["SILENT_MONITOR", "BARGE"] : ["SILENT_MONITOR"];

  try {
    const {
      client: connect,
      instanceId,
      dynamo: tenantDynamo,
    } = await resolveConnect(event?.headers, legacyConnect, INSTANCE_ID);
    dynamo = tenantDynamo || legacyDynamo;
    const res = await connect.send(
      new MonitorContactCommand({
        InstanceId: instanceId,
        ContactId: contactId,
        UserId: supervisorUserId,
        AllowedMonitorCapabilities: capabilities as never,
      }),
    );
    await audit(actor, { contactId, supervisorUserId, mode }, "success");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId,
        monitorContactId: res.ContactId,
        monitorArn: res.ContactArn,
        mode,
      }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await audit(actor, { contactId, supervisorUserId, mode }, "error", msg);
    console.error("monitor-contact error", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to start monitoring",
        message: msg,
      }),
    };
  }
};
