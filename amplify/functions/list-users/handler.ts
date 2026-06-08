import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  ListUsersCommand,
  DescribeUserCommand,
  DescribeSecurityProfileCommand,
  ListSecurityProfilesCommand,
  UpdateUserSecurityProfilesCommand,
} from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";
import { getIdentity } from "../_shared/cognitoAuth";

const legacyClient = new ConnectClient({});
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const JSON_HEADERS = { "Content-Type": "application/json" };

// Cache de nombres de perfil — keyed por instancia+perfil para no mezclar tenants.
const profileNameCache = new Map<string, string>();

async function getProfileName(
  profileId: string,
  client: ConnectClient,
  instanceId: string
): Promise<string> {
  const key = `${instanceId}:${profileId}`;
  if (profileNameCache.has(key)) return profileNameCache.get(key)!;
  try {
    const res = await client.send(
      new DescribeSecurityProfileCommand({
        InstanceId: instanceId,
        SecurityProfileId: profileId,
      })
    );
    const name = res.SecurityProfile?.SecurityProfileName || profileId;
    profileNameCache.set(key, name);
    return name;
  } catch {
    return profileId;
  }
}

// Lista TODOS los perfiles de seguridad de la instancia (id + nombre). El front
// los usa como opciones al editar el rol de un agente; de paso calienta el cache
// de nombres para que el GET no Describe perfil por perfil.
async function listAllProfiles(
  client: ConnectClient,
  instanceId: string
): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let token: string | undefined = undefined;
  try {
    do {
      const res = await client.send(
        new ListSecurityProfilesCommand({
          InstanceId: instanceId,
          MaxResults: 100,
          NextToken: token,
        })
      );
      for (const p of res.SecurityProfileSummaryList || []) {
        if (p.Id && p.Name) {
          out.push({ id: p.Id, name: p.Name });
          profileNameCache.set(`${instanceId}:${p.Id}`, p.Name);
        }
      }
      token = res.NextToken;
    } while (token);
  } catch {
    /* sin permiso ListSecurityProfiles → lista vacía (el front oculta la edición) */
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method =
    event.httpMethod || event.requestContext?.http?.method || "GET";

  try {
    // Connect del tenant (o legacy de Vox si no está configurado / sin token).
    const { client, instanceId } = await resolveConnect(
      event?.headers,
      legacyClient,
      INSTANCE_ID
    );

    // ── PUT/POST: cambiar los perfiles de seguridad de un agente de Connect ──
    // Acción PRIVILEGIADA (cambia quién es admin) → exige que el que llama sea
    // Admin (defensa en profundidad: el nav ya lo gatea en el front).
    if (method === "PUT" || method === "POST") {
      const identity = await getIdentity(event?.headers);
      if (!identity?.groups?.includes("Admin")) {
        return {
          statusCode: 403,
          headers: JSON_HEADERS,
          body: JSON.stringify({ error: "Solo un Admin puede cambiar roles." }),
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let body: any = {};
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        /* body inválido → cae al 400 */
      }
      const userId: string = body.userId || "";
      const securityProfileIds: string[] = Array.isArray(body.securityProfileIds)
        ? body.securityProfileIds.filter((x: unknown) => typeof x === "string")
        : [];
      // Connect exige >=1 perfil de seguridad por usuario.
      if (!userId || securityProfileIds.length === 0) {
        return {
          statusCode: 400,
          headers: JSON_HEADERS,
          body: JSON.stringify({
            error: "Se requieren userId y al menos un perfil de seguridad.",
          }),
        };
      }
      await client.send(
        new UpdateUserSecurityProfilesCommand({
          InstanceId: instanceId,
          UserId: userId,
          SecurityProfileIds: securityProfileIds,
        })
      );
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: true }),
      };
    }

    if (method !== "GET") {
      return {
        statusCode: 405,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    // ── GET: usuarios de Connect + perfiles de seguridad disponibles ──
    const summariesRes = await client.send(
      new ListUsersCommand({ InstanceId: instanceId, MaxResults: 100 })
    );
    const summaries = summariesRes.UserSummaryList || [];

    // Opciones de edición para el front + calienta el cache de nombres.
    const availableProfiles = await listAllProfiles(client, instanceId);

    const users = await Promise.all(
      summaries.map(async (summary) => {
        try {
          const userRes = await client.send(
            new DescribeUserCommand({
              InstanceId: instanceId,
              UserId: summary.Id!,
            })
          );
          const user = userRes.User;
          const profileIds = user?.SecurityProfileIds || [];
          const profileNames = await Promise.all(
            profileIds.map((id) => getProfileName(id, client, instanceId))
          );
          return {
            // userId: el front lo usa para el PUT de cambio de rol.
            userId: summary.Id || "",
            username: summary.Username || "",
            email: user?.IdentityInfo?.Email || "",
            firstName: user?.IdentityInfo?.FirstName || "",
            lastName: user?.IdentityInfo?.LastName || "",
            status: "CONFIRMED",
            enabled: true,
            created: "",
            groups: profileNames,
            groupIds: profileIds,
          };
        } catch {
          return {
            userId: summary.Id || "",
            username: summary.Username || "",
            email: "",
            firstName: "",
            lastName: "",
            status: "UNKNOWN",
            enabled: true,
            created: "",
            groups: [],
            groupIds: [],
          };
        }
      })
    );

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ users, availableProfiles }),
    };
  } catch (error) {
    console.error("Error in list-users:", error);
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: "Failed to list users",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
