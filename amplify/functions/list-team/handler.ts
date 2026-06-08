/**
 * list-team — lista los usuarios de Vox (Cognito) de la organización del admin.
 *
 * GET → { team: [{ email, sub, role, status, enabled, createdAt }] }
 *
 * Son los usuarios que se loguean a la WEB APP (distinto de los agentes de
 * Amazon Connect que toman llamadas — esos los lista list-users desde Connect).
 *
 * SEGURIDAD: el tenantId sale del JWT verificado. Solo devuelve usuarios cuyo
 * custom:tenantId == el del admin (Cognito ListUsers no filtra por atributos
 * custom, así que paginamos y filtramos en código). Solo Admins.
 *
 * Requiere (policy TeamManagement): cognito-idp:ListUsers + AdminListGroupsForUser.
 */
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { getIdentity } from "../_shared/cognitoAuth";

const REGION = process.env.AWS_REGION || "us-east-1";
const POOL_ID = process.env.COGNITO_USER_POOL_ID || "us-east-1_csLvANyZo";
const idp = new CognitoIdentityProviderClient({ region: REGION });

const CORS: Record<string, string> = {
  // CORS lo provee la Function URL (config de AWS). Ver invite-user/manage-connections.
  "Content-Type": "application/json",
};

// Orden de jerarquía para resolver el rol "principal" cuando el usuario está en
// varios grupos (un Admin que también es Agente → mostramos "Admins").
const ROLE_RANK: Record<string, number> = { Admins: 3, Supervisors: 2, Agents: 1 };

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
}

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function attr(u: UserType, name: string): string {
  return u.Attributes?.find((a) => a.Name === name)?.Value || "";
}

export const handler = async (event: FnEvent) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  if (method === "OPTIONS") return resp(200, {});

  let id;
  try {
    id = await getIdentity(event.headers);
  } catch {
    return resp(401, { error: "Token inválido" });
  }
  if (!id || !id.tenantId) return resp(401, { error: "No autorizado" });
  if (!id.groups.includes("Admins")) {
    return resp(403, { error: "Solo administradores pueden ver el equipo" });
  }
  const tenantId = id.tenantId;

  try {
    // 1) Paginar ListUsers y quedarnos con los del tenant. Cap defensivo de
    //    páginas para no colgarnos en un pool gigante (60 * 17 ≈ 1000 users).
    const mine: UserType[] = [];
    let token: string | undefined;
    let pages = 0;
    do {
      const r = await idp.send(
        new ListUsersCommand({ UserPoolId: POOL_ID, Limit: 60, PaginationToken: token })
      );
      for (const u of r.Users || []) {
        if (attr(u, "custom:tenantId") === tenantId) mine.push(u);
      }
      token = r.PaginationToken;
      pages += 1;
    } while (token && pages < 17);

    // 2) Resolver el rol de cada uno (grupo de mayor jerarquía).
    const team = await Promise.all(
      mine.map(async (u) => {
        const username = u.Username || "";
        let role = "Agents";
        try {
          const g = await idp.send(
            new AdminListGroupsForUserCommand({ UserPoolId: POOL_ID, Username: username })
          );
          const names = (g.Groups || []).map((x) => x.GroupName || "");
          role = names.reduce(
            (best, n) => ((ROLE_RANK[n] || 0) > (ROLE_RANK[best] || 0) ? n : best),
            "Agents"
          );
        } catch {
          /* sin grupos → Agents por defecto */
        }
        return {
          sub: attr(u, "sub") || username,
          email: attr(u, "email"),
          name: attr(u, "name"),
          role,
          status: u.UserStatus || "",
          enabled: u.Enabled !== false,
          createdAt: u.UserCreateDate ? new Date(u.UserCreateDate).toISOString() : "",
          // Vínculo con el agente de Amazon Connect (capa 2):
          //  · assigned    = lo que asignó el admin (pendiente de confirmar)
          //  · connectUser = el agente CONFIRMADO por login del propio agente
          // Estado en la UI: sin asignar / pendiente / confirmado ✓ / mismatch.
          assigned: attr(u, "custom:connectAssigned"),
          connectUser: attr(u, "custom:connectUser"),
          // El que creó la org (vos) — para marcarlo en la UI y no dejarte
          // borrarte a vos mismo más adelante.
          isYou: (attr(u, "sub") || username) === id.sub,
        };
      })
    );

    // Orden: admins primero, después por email.
    team.sort((a, b) => {
      const r = (ROLE_RANK[b.role] || 0) - (ROLE_RANK[a.role] || 0);
      return r !== 0 ? r : a.email.localeCompare(b.email);
    });

    return resp(200, { team, tenantId });
  } catch (e) {
    console.error("list-team error:", e);
    return resp(500, { error: e instanceof Error ? e.message : "error" });
  }
};
