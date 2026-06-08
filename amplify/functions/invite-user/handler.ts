/**
 * invite-user — invita a un trabajador a la organización (tenant) del admin.
 *
 * POST { email, role }  (role ∈ Agents | Supervisors | Admins)
 *   → AdminCreateUser en Cognito con custom:tenantId = el tenant del admin
 *     (así, al primer login, NO se le crea una org nueva: cae en la del admin).
 *   → Cognito le manda un email con contraseña temporal (DesiredDeliveryMediums).
 *   → AdminAddUserToGroup con el rol elegido.
 *
 * SEGURIDAD: el tenantId y el rol del invitador SALEN DEL JWT verificado, nunca
 * del body. Solo un Admin del tenant puede invitar. El usuario creado queda
 * atado al MISMO tenant del invitador — un admin no puede sembrar usuarios en
 * otra organización.
 *
 * Requiere (policy TeamManagement en el rol): cognito-idp:AdminCreateUser +
 * AdminAddUserToGroup sobre el pool.
 */
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { getIdentity } from "../_shared/cognitoAuth";

const REGION = process.env.AWS_REGION || "us-east-1";
const POOL_ID = process.env.COGNITO_USER_POOL_ID || "us-east-1_csLvANyZo";
const idp = new CognitoIdentityProviderClient({ region: REGION });

const CORS: Record<string, string> = {
  // CORS lo provee la Function URL (config de AWS). NO setear Access-Control-*
  // acá: duplicaría Allow-Origin (uno del código + uno de AWS) y el browser
  // rechaza la respuesta con "Failed to fetch" (mismo quirk que web-form-capture).
  "Content-Type": "application/json",
};

// Roles válidos = los grupos del pool. NO aceptamos cualquier string del body:
// AdminAddUserToGroup a un grupo inexistente tiraría, pero mejor validar acá.
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
  let body: { email?: string; role?: string; name?: string };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return resp(400, { error: "JSON inválido" });
  }
  const email = (body.email || "").trim().toLowerCase();
  const role = (body.role || "Agents").trim();
  const name = (body.name || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return resp(400, { error: "Email inválido" });
  }
  if (!VALID_ROLES.has(role)) {
    return resp(400, { error: "Rol inválido" });
  }

  // 3) Crear el usuario atado al tenant del invitador + mandar invitación.
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
      })
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
      })
    );
  } catch (e) {
    console.error("invite-user AdminAddUserToGroup error:", e);
    // No fatal: el usuario ya recibió la invitación. Reportamos warning.
    return resp(200, { ok: true, email, role: "Agents", warning: "Usuario creado, pero no se pudo asignar el rol; quedó como Agente." });
  }

  return resp(200, { ok: true, email, role });
};
