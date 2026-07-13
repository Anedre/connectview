/**
 * recover-access — recuperación de acceso AUTO-SERVICIO (sin sesión).
 *
 * Endpoint PÚBLICO (Function URL, auth NONE). Lo llama la pantalla de login
 * cuando alguien no puede entrar. Cubre el hueco que el Authenticator de Amplify
 * NO puede resolver: un invitado cuya contraseña temporal ya caducó queda en
 * FORCE_CHANGE_PASSWORD y ahí Cognito PROHÍBE "olvidé mi contraseña"
 * ("User password cannot be reset in the current state"). Este Lambda lo saca del
 * hoyo reenviándole una invitación nueva.
 *
 * POST { email }
 *   · FORCE_CHANGE_PASSWORD → AdminCreateUser(RESEND): nueva contraseña temporal
 *     + REINICIA el reloj de expiración, reenvía el email de invitación.
 *   · RESET_REQUIRED | CONFIRMED → AdminResetUserPassword: manda un código para
 *     que el propio usuario fije su nueva contraseña (equivale a "olvidé mi
 *     contraseña", pero disparado por nosotros).
 *   · No existe / deshabilitado / otro estado → no-op silencioso.
 *
 * SEGURIDAD (endpoint público, sin JWT):
 *   · Respuesta SIEMPRE genérica e idéntica (exista o no el correo, cualquiera
 *     sea el estado) → no filtra qué correos están registrados (anti-enumeración).
 *   · Solo dispara correos hacia el buzón YA verificado del propio usuario; no
 *     sirve para spamear a terceros arbitrarios (el mail va a la cuenta, no a un
 *     destino elegido por quien llama).
 *   · El email se valida y se rechazan comillas/backslash antes de armar el
 *     Filter de ListUsers (evita romper/inyectar la query).
 *   · Rate-limit crudo por reserved-concurrency de la función + los límites
 *     internos de Cognito. Un throttle fino por-email (DynamoDB+TTL) queda como
 *     follow-up si se necesita.
 *
 * Corre bajo connectview-team-cognito-role (Cognito: ListUsers + AdminCreateUser
 * + AdminResetUserPassword). Mismo rol que invite-user.
 */
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminCreateUserCommand,
  AdminResetUserPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const REGION = process.env.AWS_REGION || "us-east-1";
const POOL_ID = process.env.COGNITO_USER_POOL_ID || "us-east-1_csLvANyZo";
const idp = new CognitoIdentityProviderClient({ region: REGION });

const CORS: Record<string, string> = {
  // CORS lo provee la Function URL (config de AWS). Ver invite-user/list-team.
  "Content-Type": "application/json",
};

// Mensaje genérico único (anti-enumeración): se devuelve SIEMPRE, exista o no el
// correo y sin importar el estado. El frontend muestra este texto tal cual.
const GENERIC = {
  ok: true,
  message:
    "Si el correo está registrado, te enviamos un email con instrucciones para recuperar el acceso. Revisa tu bandeja de entrada (y la carpeta de spam).",
};

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  body?: string | null;
}

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export const handler = async (event: FnEvent) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "POST";
  if (method === "OPTIONS") return resp(200, {});

  let body: { email?: string };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return resp(200, GENERIC); // ni el error de parseo revelamos
  }
  const email = (body.email || "").trim().toLowerCase();
  // Validación + hardening del valor que va al Filter de ListUsers.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.includes('"') || email.includes("\\")) {
    return resp(200, GENERIC); // formato inválido → genérico igual
  }

  try {
    const found = await idp.send(
      new ListUsersCommand({ UserPoolId: POOL_ID, Filter: `email = "${email}"`, Limit: 1 }),
    );
    const user = found.Users?.[0];
    // No existe o está deshabilitado → no-op (respuesta genérica).
    if (!user || !user.Username || user.Enabled === false) return resp(200, GENERIC);

    const status = user.UserStatus;
    if (status === "FORCE_CHANGE_PASSWORD") {
      // Invitado cuya temporal caducó (o nunca la usó): reenvía invitación con
      // nueva temporal + reinicia el reloj. RESEND solo es válido en este estado.
      await idp.send(
        new AdminCreateUserCommand({
          UserPoolId: POOL_ID,
          Username: user.Username,
          MessageAction: "RESEND",
          DesiredDeliveryMediums: ["EMAIL"],
        }),
      );
    } else if (status === "RESET_REQUIRED" || status === "CONFIRMED") {
      // Usuario ya activo (o en reset): mándale un código para fijar su clave.
      await idp.send(
        new AdminResetUserPasswordCommand({ UserPoolId: POOL_ID, Username: user.Username }),
      );
    }
    // Cualquier otro estado → no-op silencioso.
  } catch (e) {
    // Nunca propagamos el error al cliente (anti-enumeración). Log interno.
    console.error("recover-access error:", e);
  }
  return resp(200, GENERIC);
};
