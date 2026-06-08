import type { Handler } from "aws-lambda";
import {
  ConnectClient,
  ListQueuesCommand,
  DescribeQueueCommand,
  ListUsersCommand,
  DescribeUserCommand,
  ListRoutingProfileQueuesCommand,
  AssociateRoutingProfileQueuesCommand,
  DisassociateRoutingProfileQueuesCommand,
  CreateQueueCommand,
  UpdateQueueNameCommand,
  UpdateQueueStatusCommand,
  UpdateQueueMaxContactsCommand,
  UpdateQueueHoursOfOperationCommand,
  ListHoursOfOperationsCommand,
} from "@aws-sdk/client-connect";
import { resolveConnect } from "../_shared/tenantConnect";
import { getIdentity } from "../_shared/cognitoAuth";

/**
 * list-queues — el endpoint de COLAS del tenant. Empezó como GET (lista) y ahora
 * es el gestor completo (Configuración → Colas):
 *
 *   GET                      → lista de colas STANDARD (lo que usa useQueues).
 *   GET ?detail=<queueId>    → detalle (estado, máx contactos, horario, descr.)
 *                              + los AGENTES que la atienden (resueltos por su
 *                              perfil de enrutamiento) + horario legible.
 *   POST {action}            → escrituras (SOLO Admin):
 *      action=create         crea una cola (Name + HoursOfOperationId + máx/descr)
 *      action=update         edita (nombre/descr, estado, máx contactos, horario)
 *      action=addAgent       suma una cola al perfil de enrutamiento del agente
 *      action=removeAgent    la quita del perfil (afecta a TODO el perfil — ojo)
 *      action=hoursOfOperations  helper para el form de crear (lista de horarios)
 *
 * Tenant-scoped vía resolveConnect (rol cross-account). Las escrituras requieren
 * los permisos connect:CreateQueue / UpdateQueue* en el rol (plantilla #queues).
 *
 * Nota Connect: los agentes NO se asignan a colas directo — se asignan vía
 * perfiles de enrutamiento. "Sumar agente a cola" = sumar la cola a SU perfil.
 */
const legacyConnect = new ConnectClient({ maxAttempts: 1 });
const INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || "";
const JSON_HEADERS = { "Content-Type": "application/json" };

function resp(statusCode: number, body: unknown) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

/** ¿El perfil de enrutamiento atiende esta cola? (paginado) */
async function routingProfileHasQueue(
  connect: ConnectClient,
  instanceId: string,
  routingProfileId: string,
  queueId: string
): Promise<boolean> {
  let token: string | undefined;
  do {
    const r = await connect.send(
      new ListRoutingProfileQueuesCommand({
        InstanceId: instanceId,
        RoutingProfileId: routingProfileId,
        NextToken: token,
        MaxResults: 100,
      })
    );
    if ((r.RoutingProfileQueueConfigSummaryList || []).some((q) => q.QueueId === queueId)) {
      return true;
    }
    token = r.NextToken;
  } while (token);
  return false;
}

interface AgentRow {
  userId: string;
  username: string;
  name: string;
  routingProfileId: string;
  servesQueue: boolean;
}

/** Todos los agentes de la instancia + si atienden `queueId` (vía su perfil). */
async function agentsForQueue(
  connect: ConnectClient,
  instanceId: string,
  queueId: string
): Promise<{ serving: AgentRow[]; others: AgentRow[] }> {
  // 1. Todos los usuarios (cap 300 por seguridad de runtime).
  const users: { id: string; username: string }[] = [];
  let token: string | undefined;
  do {
    const r = await connect.send(
      new ListUsersCommand({ InstanceId: instanceId, MaxResults: 100, NextToken: token })
    );
    for (const u of r.UserSummaryList || []) if (u.Id) users.push({ id: u.Id, username: u.Username || "" });
    token = r.NextToken;
    if (users.length >= 300) break;
  } while (token);

  // 2. DescribeUser concurrente → nombre + perfil de enrutamiento.
  const enriched = await Promise.all(
    users.map(async (u) => {
      try {
        const d = await connect.send(new DescribeUserCommand({ InstanceId: instanceId, UserId: u.id }));
        const fn = d.User?.IdentityInfo?.FirstName || "";
        const ln = d.User?.IdentityInfo?.LastName || "";
        return {
          userId: u.id,
          username: u.username,
          name: `${fn} ${ln}`.trim() || u.username,
          routingProfileId: d.User?.RoutingProfileId || "",
          servesQueue: false,
        } as AgentRow;
      } catch {
        return { userId: u.id, username: u.username, name: u.username, routingProfileId: "", servesQueue: false } as AgentRow;
      }
    })
  );

  // 3. Perfiles distintos → ¿atienden la cola? (una vez por perfil, no por agente).
  const rpIds = [...new Set(enriched.map((u) => u.routingProfileId).filter(Boolean))];
  const rpServes = new Map<string, boolean>();
  await Promise.all(
    rpIds.map(async (rp) => {
      rpServes.set(rp, await routingProfileHasQueue(connect, instanceId, rp, queueId));
    })
  );
  for (const u of enriched) u.servesQueue = !!u.routingProfileId && !!rpServes.get(u.routingProfileId);

  const byName = (a: AgentRow, b: AgentRow) => a.name.localeCompare(b.name);
  return {
    serving: enriched.filter((u) => u.servesQueue).sort(byName),
    others: enriched.filter((u) => !u.servesQueue).sort(byName),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler = async (event: any) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || "GET";
  if (method === "OPTIONS") return resp(200, {});

  try {
    const { client: connect, instanceId } = await resolveConnect(
      event?.headers,
      legacyConnect,
      INSTANCE_ID
    );

    // ───────────────────────── POST: escrituras (Admin) ─────────────────────
    if (method === "POST") {
      const identity = await getIdentity(event?.headers);
      if (!identity?.groups?.includes("Admins")) {
        return resp(403, { error: "Solo un Admin puede gestionar colas." });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let body: any = {};
      try { body = JSON.parse(event?.body || "{}"); } catch { /* 400 abajo */ }
      const action = body.action;

      // Helper para el form de crear: horarios de atención disponibles.
      if (action === "hoursOfOperations") {
        const out: { id: string; name: string }[] = [];
        let t: string | undefined;
        do {
          const r = await connect.send(new ListHoursOfOperationsCommand({ InstanceId: instanceId, NextToken: t, MaxResults: 100 }));
          for (const h of r.HoursOfOperationSummaryList || []) if (h.Id && h.Name) out.push({ id: h.Id, name: h.Name });
          t = r.NextToken;
        } while (t);
        return resp(200, { hoursOfOperations: out });
      }

      if (action === "create") {
        const name = String(body.name || "").trim();
        const hoursOfOperationId = String(body.hoursOfOperationId || "");
        if (!name || !hoursOfOperationId) {
          return resp(400, { error: "Se requieren nombre y horario de atención (hoursOfOperationId)." });
        }
        const r = await connect.send(
          new CreateQueueCommand({
            InstanceId: instanceId,
            Name: name.slice(0, 127),
            Description: body.description ? String(body.description).slice(0, 250) : undefined,
            HoursOfOperationId: hoursOfOperationId,
            MaxContacts: typeof body.maxContacts === "number" ? body.maxContacts : undefined,
          })
        );
        return resp(200, { ok: true, queueId: r.QueueId, queueArn: r.QueueArn });
      }

      if (action === "update") {
        const queueId = String(body.queueId || "");
        if (!queueId) return resp(400, { error: "queueId requerido" });
        const done: string[] = [];
        if (typeof body.name === "string" || typeof body.description === "string") {
          await connect.send(new UpdateQueueNameCommand({ InstanceId: instanceId, QueueId: queueId, Name: body.name ? String(body.name).slice(0, 127) : undefined, Description: body.description !== undefined ? String(body.description).slice(0, 250) : undefined }));
          done.push("nombre/descripción");
        }
        if (body.status === "ENABLED" || body.status === "DISABLED") {
          await connect.send(new UpdateQueueStatusCommand({ InstanceId: instanceId, QueueId: queueId, Status: body.status }));
          done.push("estado");
        }
        if (typeof body.maxContacts === "number") {
          await connect.send(new UpdateQueueMaxContactsCommand({ InstanceId: instanceId, QueueId: queueId, MaxContacts: body.maxContacts }));
          done.push("máx. contactos");
        }
        if (typeof body.hoursOfOperationId === "string" && body.hoursOfOperationId) {
          await connect.send(new UpdateQueueHoursOfOperationCommand({ InstanceId: instanceId, QueueId: queueId, HoursOfOperationId: body.hoursOfOperationId }));
          done.push("horario");
        }
        if (done.length === 0) return resp(400, { error: "Nada para actualizar." });
        return resp(200, { ok: true, updated: done });
      }

      if (action === "addAgent" || action === "removeAgent") {
        const userId = String(body.userId || "");
        const queueId = String(body.queueId || "");
        if (!userId || !queueId) return resp(400, { error: "userId y queueId requeridos" });
        const d = await connect.send(new DescribeUserCommand({ InstanceId: instanceId, UserId: userId }));
        const rp = d.User?.RoutingProfileId;
        if (!rp) return resp(400, { error: "El agente no tiene perfil de enrutamiento." });
        if (action === "addAgent") {
          const has = await routingProfileHasQueue(connect, instanceId, rp, queueId);
          if (!has) {
            await connect.send(new AssociateRoutingProfileQueuesCommand({
              InstanceId: instanceId,
              RoutingProfileId: rp,
              QueueConfigs: [{ QueueReference: { QueueId: queueId, Channel: "VOICE" }, Priority: Number(body.priority) || 5, Delay: Number(body.delay) || 0 }],
            }));
          }
          return resp(200, { ok: true, routingProfileId: rp });
        } else {
          await connect.send(new DisassociateRoutingProfileQueuesCommand({
            InstanceId: instanceId,
            RoutingProfileId: rp,
            QueueReferences: [{ QueueId: queueId, Channel: "VOICE" }],
          }));
          return resp(200, { ok: true, routingProfileId: rp, note: "Quitada del perfil — afecta a todos los agentes de ese perfil." });
        }
      }

      return resp(400, { error: `Acción desconocida: ${action}` });
    }

    // ───────────────────────── GET ?detail=<queueId>: detalle + agentes ──────
    const qs = event?.queryStringParameters || {};
    if (qs.detail) {
      const queueId = String(qs.detail);
      const d = await connect.send(new DescribeQueueCommand({ InstanceId: instanceId, QueueId: queueId }));
      const q = d.Queue;
      const agents = await agentsForQueue(connect, instanceId, queueId);
      return resp(200, {
        queue: {
          id: q?.QueueId || queueId,
          name: q?.Name || "",
          description: q?.Description || "",
          status: q?.Status || "",
          maxContacts: q?.MaxContacts ?? null,
          hoursOfOperationId: q?.HoursOfOperationId || "",
          outboundCallerName: q?.OutboundCallerConfig?.OutboundCallerIdName || "",
          arn: q?.QueueArn || "",
        },
        agentsServing: agents.serving,
        agentsAvailable: agents.others,
      });
    }

    // ───────────────────────── GET: lista (comportamiento original) ──────────
    const queues: Array<{ id: string; name: string; type: string; arn: string }> = [];
    let nextToken: string | undefined;
    do {
      const res = await connect.send(
        new ListQueuesCommand({ InstanceId: instanceId, QueueTypes: ["STANDARD"], NextToken: nextToken, MaxResults: 100 })
      );
      for (const q of res.QueueSummaryList || []) {
        queues.push({ id: q.Id || "", name: q.Name || "", type: q.QueueType || "STANDARD", arn: q.Arn || "" });
      }
      nextToken = res.NextToken;
    } while (nextToken);
    queues.sort((a, b) => a.name.localeCompare(b.name));
    return resp(200, { queues, total: queues.length });
  } catch (err) {
    console.error("list-queues error", err);
    return resp(500, { error: "Failed", message: err instanceof Error ? err.message : String(err) });
  }
};
