/**
 * invite-user — gestión del EQUIPO (usuarios Cognito) de la organización del admin.
 *
 * POST { email, role }  (role ∈ Agents | Supervisors | Admins)  — INVITAR (default)
 *   → AdminCreateUser en Cognito con custom:tenantId = el tenant del admin
 *     (así, al primer login, NO se le crea una org nueva: cae en la del admin).
 *   → Cognito le manda un email con contraseña temporal (DesiredDeliveryMediums).
 *   → AdminAddUserToGroup con el rol elegido.
 *
 * POST { email, action }  con action ∈ remove | disable | enable  — GESTIONAR
 *   → remove  = AdminDeleteUser (elimina definitivamente la cuenta/invitación)
 *   → disable = AdminDisableUser (desactiva; el usuario no puede entrar, reversible)
 *   → enable  = AdminEnableUser (reactiva un usuario desactivado)
 *
 * SEGURIDAD: el tenantId y el rol del invitador SALEN DEL JWT verificado, nunca
 * del body. Solo un Admin del tenant puede operar. Tanto al invitar como al
 * gestionar, el target queda atado/limitado al MISMO tenant del admin — un admin
 * no puede sembrar NI eliminar usuarios de otra organización (el tenant del
 * target se verifica con ListUsers antes de borrar/desactivar). No se permite
 * operar sobre la propia cuenta (evita auto-lockout).
 *
 * Requiere (policy TeamManagement en el rol): cognito-idp:AdminCreateUser +
 * AdminAddUserToGroup + ListUsers + AdminDeleteUser + AdminDisableUser +
 * AdminEnableUser sobre el pool.
 */
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { getIdentity } from "../_shared/cognitoAuth";

const REGION = process.env.AWS_REGION || "us-east-1";
const POOL_ID = process.env.COGNITO_USER_POOL_ID || "us-east-1_csLvANyZo";
const idp = new CognitoIdentityProviderClient({ region: REGION });

const CORS: Record<string, string> = {
  // CORS lo provee la Function URL (config de AWS). NO setear Access-Control-*
  // aquí: duplicaría Allow-Origin (uno del código + uno de AWS) y el browser
  // rechaza la respuesta con "Failed to fetch" (mismo quirk que web-form-capture).
  "Content-Type": "application/json",
};

// Roles válidos = los grupos del pool. NO aceptamos cualquier string del body:
// AdminAddUserToGroup a un grupo inexistente tiraría, pero mejor validar aquí.
const VALID_ROLES = new Set(["Agents", "Supervisors", "Admins"]);

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
}

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export const handler = async (event: FnEvent) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "POST";
  if (method === "OPTIONS") return resp(200, {});

  // 1) Identidad del invitador. Debe ser un Admin con tenant.
  let id;
  try {
    id = await getIdentity(event.headers);
  } catch {
    return resp(401, { error: "Token inválido" });
  }
  if (!id || !id.tenantId) return resp(401, { error: "No autorizado" });
  if (!id.groups.includes("Admins")) {
    return resp(403, { error: "Solo administradores pueden invitar usuarios" });
  }

  // 2) Validar body.
  let body: { email?: string; role?: string; name?: string; action?: string };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return resp(400, { error: "JSON inválido" });
  }
  const email = (body.email || "").trim().toLowerCase();
  const action = (body.action || "invite").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return resp(400, { error: "Email inválido" });
  }

  // 2b) Acciones de gestión sobre un miembro EXISTENTE (eliminar / desactivar /
  //     reactivar). Reusan este endpoint (ya es Admin-only + atado al tenant).
  //     El target se resuelve por email y se EXIGE que sea del MISMO tenant del
  //     admin (anti cross-tenant). No se opera sobre la propia cuenta.
  if (action === "remove" || action === "disable" || action === "enable") {
    if (email === (id.email || "").trim().toLowerCase()) {
      return resp(400, { error: "No puedes modificar tu propia cuenta desde aquí." });
    }
    let target;
    try {
      const found = await idp.send(
        new ListUsersCommand({ UserPoolId: POOL_ID, Filter: `email = "${email}"`, Limit: 1 }),
      );
      target = found.Users?.[0];
    } catch (e) {
      console.error("invite-user ListUsers (action) error:", e);
      return resp(500, { error: e instanceof Error ? e.message : "error" });
    }
    if (!target || !target.Username) {
      return resp(404, { error: "No se encontró ese usuario." });
    }
    const targetTenant = target.Attributes?.find((a) => a.Name === "custom:tenantId")?.Value;
    if (targetTenant !== id.tenantId) {
      return resp(403, { error: "Ese usuario pertenece a otra organización." });
    }
    try {
      if (action === "remove") {
        await idp.send(
          new AdminDeleteUserCommand({ UserPoolId: POOL_ID, Username: target.Username }),
        );
      } else if (action === "disable") {
        await idp.send(
          new AdminDisableUserCommand({ UserPoolId: POOL_ID, Username: target.Username }),
        );
      } else {
        await idp.send(
          new AdminEnableUserCommand({ UserPoolId: POOL_ID, Username: target.Username }),
        );
      }
    } catch (e) {
      console.error(`invite-user ${action} error:`, e);
      return resp(500, { error: e instanceof Error ? e.message : "error" });
    }
    return resp(200, { ok: true, email, action });
  }

  // 3) INVITAR (default): validar rol + nombre.
  const role = (body.role || "Agents").trim();
  const name = (body.name || "").trim();
  if (!VALID_ROLES.has(role)) {
    return resp(400, { error: "Rol inválido" });
  }

  // 3b) Crear el usuario atado al tenant del invitador + mandar invitación.
  try {
    await idp.send(
      new AdminCreateUserCommand({
        UserPoolId: POOL_ID,
        Username: email, // pool con UsernameAttributes=["email"] → username = email
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          { Name: "custom:tenantId", Value: id.tenantId },
          // El nombre del agente lo pone el admin al invitar (si lo cargó).
          ...(name ? [{ Name: "name", Value: name }] : []),
        ],
        DesiredDeliveryMediums: ["EMAIL"],
      }),
    );
  } catch (e) {
    if (e instanceof Error && e.name === "UsernameExistsException") {
      return resp(409, { error: "Ese email ya tiene una cuenta." });
    }
    console.error("invite-user AdminCreateUser error:", e);
    return resp(500, { error: e instanceof Error ? e.message : "error" });
  }

  // 4) Asignar el rol. Si esto falla, el usuario igual existe (queda como
  //    Agents por defecto al no estar en ningún grupo → fail-safe mínimo).
  try {
    await idp.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: POOL_ID,
        Username: email,
        GroupName: role,
      }),
    );
  } catch (e) {
    console.error("invite-user AdminAddUserToGroup error:", e);
    // No fatal: el usuario ya recibió la invitación. Reportamos warning.
    return resp(200, {
      ok: true,
      email,
      role: "Agents",
      warning: "Usuario creado, pero no se pudo asignar el rol; quedó como Agente.",
    });
  }

  return resp(200, { ok: true, email, role });
};
