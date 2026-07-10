/**
 * set-connect-link — vincula un usuario de Vox (Cognito) con un agente de
 * Amazon Connect (capa 2). Modelo asignar→confirmar con credenciales:
 *
 *   custom:connectAssigned = a quién lo asignó el ADMIN (pendiente de confirmar)
 *   custom:connectUser     = el agente CONFIRMADO (probado por login en Connect)
 *
 * POST { connectUser, targetSub? }
 *   · CON targetSub → un ADMIN ASIGNA (deja pendiente). Exige rol Admin + que el
 *     target sea del mismo tenant. Setea connectAssigned; si la confirmación
 *     anterior ya no coincide, la borra → el agente debe re-confirmar.
 *   · SIN targetSub → el propio agente CONFIRMA. Solo funciona si el username
 *     que manda (el REAL de su sesión autenticada de Connect, vía
 *     agent.getConfiguration()) COINCIDE con lo que el admin le asignó. Un
 *     agente NO puede auto-vincularse a un agente que no le fue asignado.
 *
 * connectUser="" con targetSub → desvincula (limpia ambos).
 *
 * Seguridad: la confirmación se ata a lo que el admin asignó, así un usuario no
 * puede elegir "ser" cualquier agente. La prueba de identidad es el login a
 * Connect (credenciales en la página de Connect, no en Vox).
 *
 * Requiere (ya en el rol): AdminUpdateUserAttributes + AdminGetUser.
 */
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
  AdminGetUserCommand,
  type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";
import { getIdentity } from "../_shared/cognitoAuth";

const REGION = process.env.AWS_REGION || "us-east-1";
const POOL_ID = process.env.COGNITO_USER_POOL_ID || "us-east-1_csLvANyZo";
const idp = new CognitoIdentityProviderClient({ region: REGION });

const CORS: Record<string, string> = {
  // CORS lo provee la Function URL. Ver invite-user / manage-connections.
  "Content-Type": "application/json",
};

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
}

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

interface UserAttrs {
  tenantId?: string;
  assigned?: string;
  confirmed?: string;
}

async function getAttrs(username: string): Promise<UserAttrs> {
  const u = await idp.send(new AdminGetUserCommand({ UserPoolId: POOL_ID, Username: username }));
  const pick = (n: string) => u.UserAttributes?.find((a: AttributeType) => a.Name === n)?.Value;
  return {
    tenantId: pick("custom:tenantId"),
    assigned: pick("custom:connectAssigned"),
    confirmed: pick("custom:connectUser"),
  };
}

async function setAttrs(username: string, attrs: AttributeType[]): Promise<void> {
  await idp.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: POOL_ID,
      Username: username,
      UserAttributes: attrs,
    }),
  );
}

export const handler = async (event: FnEvent) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "POST";
  if (method === "OPTIONS") return resp(200, {});

  let id;
  try {
    id = await getIdentity(event.headers);
  } catch {
    return resp(401, { error: "Token inválido" });
  }
  if (!id || !id.tenantId) return resp(401, { error: "No autorizado" });

  let body: { connectUser?: string; targetSub?: string };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return resp(400, { error: "JSON inválido" });
  }
  const connectUser = (body.connectUser || "").trim();
  const targetSub = (body.targetSub || "").trim();

  // ───────────────────── ADMIN ASIGNA (deja pendiente) ─────────────────────
  if (targetSub) {
    if (!id.groups.includes("Admins")) {
      return resp(403, { error: "Solo administradores pueden asignar agentes" });
    }
    let target: UserAttrs;
    try {
      target = await getAttrs(targetSub);
    } catch {
      return resp(404, { error: "Usuario no encontrado" });
    }
    if (target.tenantId !== id.tenantId) {
      return resp(403, { error: "Ese usuario no pertenece a tu organización" });
    }
    try {
      if (!connectUser) {
        // Desvincular: limpia asignación y confirmación.
        await setAttrs(targetSub, [
          { Name: "custom:connectAssigned", Value: "" },
          { Name: "custom:connectUser", Value: "" },
        ]);
        return resp(200, { ok: true, assigned: "", confirmed: "" });
      }
      // Asignar. Si la confirmación previa ya no coincide con la nueva
      // asignación, la borramos → el agente tendrá que re-confirmar con su login.
      const keepConfirmed = target.confirmed && target.confirmed === connectUser;
      const attrs: AttributeType[] = [{ Name: "custom:connectAssigned", Value: connectUser }];
      if (!keepConfirmed) attrs.push({ Name: "custom:connectUser", Value: "" });
      await setAttrs(targetSub, attrs);
      return resp(200, {
        ok: true,
        assigned: connectUser,
        confirmed: keepConfirmed ? connectUser : "",
        pending: !keepConfirmed,
      });
    } catch (e) {
      console.error("set-connect-link assign error:", e);
      return resp(500, { error: e instanceof Error ? e.message : "error" });
    }
  }

  // ──────────────── AGENTE CONFIRMA (debe coincidir con lo asignado) ────────
  const me = id.sub || id.username || "";
  if (!me) return resp(400, { error: "No se pudo resolver tu usuario" });
  let mine: UserAttrs;
  try {
    mine = await getAttrs(me);
  } catch {
    return resp(404, { error: "Usuario no encontrado" });
  }
  if (!mine.assigned) {
    return resp(409, {
      error: "No tienes un agente asignado todavía. Pídele a tu administrador que te asigne uno.",
      code: "no_assignment",
    });
  }
  if (!connectUser || connectUser !== mine.assigned) {
    return resp(409, {
      error: `Entraste a Connect como "${connectUser || "?"}", pero tu admin te asignó "${mine.assigned}". No coincide — avísale a tu admin.`,
      code: "mismatch",
      assigned: mine.assigned,
      loggedInAs: connectUser,
    });
  }
  // Coincide → confirmado.
  try {
    await setAttrs(me, [{ Name: "custom:connectUser", Value: connectUser }]);
    return resp(200, { ok: true, confirmed: connectUser });
  } catch (e) {
    console.error("set-connect-link confirm error:", e);
    return resp(500, { error: e instanceof Error ? e.message : "error" });
  }
};
