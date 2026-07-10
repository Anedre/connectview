/**
 * provision-tenant — crea la organización (tenant) del usuario en su PRIMER login.
 *
 * El front lo llama (con el ID token) cuando detecta un usuario sin tenantId.
 * Flujo: verifica el token → si ya tiene tenantId, no hace nada → si no, crea
 * un tenant en connectview-tenants, setea custom:tenantId en el usuario y lo
 * hace Admin de su org. El front refresca el token (que ahora trae el tenantId).
 *
 * Requiere (policy aparte): dynamodb sobre connectview-tenants +
 * cognito-idp:AdminUpdateUserAttributes / AdminAddUserToGroup sobre el pool.
 */
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { getIdentity } from "../_shared/cognitoAuth";

const REGION = process.env.AWS_REGION || "us-east-1";
const POOL_ID = process.env.COGNITO_USER_POOL_ID || "us-east-1_csLvANyZo";
const TENANTS = process.env.TENANTS_TABLE || "connectview-tenants";
const ddb = new DynamoDBClient({ region: REGION });
const idp = new CognitoIdentityProviderClient({ region: REGION });

const CORS: Record<string, string> = {
  // CORS lo provee la Function URL (config de AWS). NO setear Access-Control-*
  // aquí: duplicaría Allow-Origin (uno del código + uno de AWS) y el browser
  // rechaza la respuesta con "Failed to fetch" (mismo quirk que web-form-capture).
  "Content-Type": "application/json",
};

interface FnEvent {
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
}

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
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
  if (!id) return resp(401, { error: "No autorizado" });
  if (id.tenantId) return resp(200, { ok: true, tenantId: id.tenantId, already: true });

  const username = id.username || id.sub;
  const tenantId = `t_${crypto.randomUUID()}`;
  // El nombre de la org = la empresa que el fundador puso en el registro
  // (custom:companyName). Fallback al dominio del email para usuarios viejos
  // que se registraron sin ese campo.
  const orgName =
    id.companyName?.trim() || id.email?.split("@")[1] || id.email || "Mi organización";

  try {
    await ddb.send(
      new PutItemCommand({
        TableName: TENANTS,
        Item: {
          tenantId: { S: tenantId },
          name: { S: orgName },
          ownerSub: { S: id.sub || "" },
          ownerEmail: { S: id.email || "" },
          plan: { S: "trial" },
          createdAt: { S: new Date().toISOString() },
        },
        ConditionExpression: "attribute_not_exists(tenantId)",
      }),
    );

    await idp.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: POOL_ID,
        Username: username,
        UserAttributes: [{ Name: "custom:tenantId", Value: tenantId }],
      }),
    );

    // El creador de la org es Admin.
    try {
      await idp.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: POOL_ID,
          Username: username,
          GroupName: "Admins",
        }),
      );
    } catch {
      /* el grupo podría no existir o ya estar — no es crítico */
    }

    return resp(200, { ok: true, tenantId, orgName });
  } catch (e) {
    console.error("provision-tenant error:", e);
    return resp(500, { error: e instanceof Error ? e.message : "error" });
  }
};
