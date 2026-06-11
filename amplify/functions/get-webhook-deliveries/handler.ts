/**
 * get-webhook-deliveries — visibilidad de las entregas de webhooks (#17).
 *
 * GET  → lista las entregas recientes (scoped al tenant del JWT; novasys ve las
 *        pooled). Para el panel de Integraciones / Automatizaciones.
 * POST { deliveryId } → "reintentar ahora": marca la fila como retrying con
 *        nextAttemptAt = now, para que el próximo tick del dispatcher la re-encole.
 *
 * Function URL pública (auth NONE a nivel infra); la identidad se valida acá con
 * el ID token de Cognito (mismo patrón que el resto de endpoints).
 */
import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { resolveTenantId, isLegacyTenant } from "../_shared/cognitoAuth";

const dynamo = new DynamoDBClient({});
const TABLE = process.env.DELIVERIES_TABLE || "connectview-webhook-deliveries";

const HDRS = { "Content-Type": "application/json" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = async (event: any) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  const tenantId = await resolveTenantId(event?.headers);
  if (!tenantId) {
    return { statusCode: 401, headers: HDRS, body: JSON.stringify({ error: "no autenticado" }) };
  }
  const legacy = isLegacyTenant(tenantId);

  try {
    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const deliveryId = String(body.deliveryId || "");
      if (!deliveryId) return { statusCode: 400, headers: HDRS, body: JSON.stringify({ error: "deliveryId requerido" }) };

      // Verificar pertenencia (un tenant real solo reintenta lo suyo).
      const cur = await dynamo.send(new GetItemCommand({ TableName: TABLE, Key: { deliveryId: { S: deliveryId } } }));
      if (!cur.Item) return { statusCode: 404, headers: HDRS, body: JSON.stringify({ error: "no existe" }) };
      const row = unmarshall(cur.Item);
      if (!legacy && row.tenantId !== tenantId) {
        return { statusCode: 403, headers: HDRS, body: JSON.stringify({ error: "ajeno" }) };
      }
      if (row.status === "delivered") {
        return { statusCode: 409, headers: HDRS, body: JSON.stringify({ error: "ya entregado" }) };
      }
      await dynamo.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: { deliveryId: { S: deliveryId } },
          UpdateExpression: "SET #s = :r, nextAttemptAt = :now, #u = :now REMOVE #ttl",
          ExpressionAttributeNames: { "#s": "status", "#u": "updatedAt", "#ttl": "ttl" },
          ExpressionAttributeValues: marshall({ ":r": "retrying", ":now": new Date().toISOString() }),
        })
      );
      return { statusCode: 200, headers: HDRS, body: JSON.stringify({ ok: true, deliveryId }) };
    }

    // GET — lista (Scan acotado; la tabla se mantiene chica por TTL). v1: para
    // volumen alto, migrar a un GSI byTenantCreated.
    const limit = Math.min(500, Number(event.queryStringParameters?.limit) || 200);
    const scan = await dynamo.send(new ScanCommand({ TableName: TABLE, Limit: limit }));
    let rows = (scan.Items || []).map((i) => unmarshall(i));
    if (!legacy) rows = rows.filter((r) => r.tenantId === tenantId);
    rows.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    // No devolvemos el payload completo (puede ser grande / sensible); solo un flag.
    const deliveries = rows.map((r) => ({
      deliveryId: r.deliveryId,
      url: r.url,
      ruleName: r.ruleName,
      status: r.status,
      attempts: r.attempts,
      lastError: r.lastError,
      lastStatusCode: r.lastStatusCode,
      nextAttemptAt: r.nextAttemptAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deliveredAt: r.deliveredAt,
    }));
    const stats = deliveries.reduce(
      (acc: Record<string, number>, d) => {
        acc[d.status] = (acc[d.status] || 0) + 1;
        return acc;
      },
      {}
    );
    return { statusCode: 200, headers: HDRS, body: JSON.stringify({ deliveries, stats }) };
  } catch (err) {
    console.error("get-webhook-deliveries error:", err);
    return { statusCode: 500, headers: HDRS, body: JSON.stringify({ error: err instanceof Error ? err.message : "error" }) };
  }
};
